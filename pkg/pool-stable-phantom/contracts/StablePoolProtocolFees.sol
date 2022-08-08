// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-pool-utils/contracts/ProtocolFeeCache.sol";

import "./StablePoolStorage.sol";
import "./StablePoolRates.sol";
import "./StableMath.sol";

abstract contract StablePoolProtocolFees is StablePoolStorage, StablePoolRates, ProtocolFeeCache {
    using FixedPoint for uint256;

    // To track protocol fees, we measure and store the value of the invariant after every join and exit.
    // All invariant growth that happens between join and exit events is due to swap fees and yield.
    // For selected tokens, we exclude the yield portion from the computation.
    uint256 private _postJoinExitInvariant;

    // Because the invariant depends on the amplification parameter, and this value may change over time, we should only
    // compare invariants that were computed using the same value. We therefore store `_postJoinExitAmp` whenever we
    // store `_postJoinExitInvariant`.
    uint256 private _postJoinExitAmp;

    /**
     * @dev Before joins or exits, calculate the invariant using the old rates for exempt tokens (i.e., the rates
     * at the time of the previous join or exit), in order to exclude the yield from the calculation for those tokens.
     * Calculate the (non-exempt) yield and swap fee growth separately, and apply the corresponding protocol fee
     * percentage to each type.
     */
    function _payProtocolFeesBeforeJoinExit(uint256[] memory balances) internal returns (uint256, uint256[] memory) {
        // Apply the rate adjustment to exempt tokens: multiply by oldRate / currentRate to "undo" the current scaling,
        // and apply the old rate. These functions copy `balances` to local storage, so they are not mutated and can
        // be reused.

        (uint256 virtualSupply, uint256[] memory balancesWithoutBpt) = _dropBptItemFromBalances(balances);

        // Do not ignore the exempt flags when calculating total growth = swap fees + non-exempt token yield.
        uint256[] memory totalGrowthBalances = _getAdjustedBalances(balancesWithoutBpt, false);
        // Ignore the exempt flags to use the oldRate for all tokens, corresponding to the growth from swap fees alone.
        uint256[] memory swapGrowthBalances = _getAdjustedBalances(balancesWithoutBpt, true);

        // Charge the protocol fee in BPT, using the growth in invariant between _postJoinExitInvariant
        // and adjusted versions of the current invariant. We have separate protocol fee percentages for growth based
        // on yield and growth based on swap fees, so we need to compute each type separately.

        // To convert each protocol fee to a BPT amount for each type of growth, we compute the relevant invariant
        // growth ratio, extract the portion due the protocol, and then compute the equivalent amount of BPT that
        // would cause such an increase.
        //
        // Invariant growth is related to new BPT and supply by: invariant ratio = (bpt amount + supply) / supply
        // With some manipulation, this becomes:                 (invariant ratio - 1) * supply = bpt amount
        //
        // However, a part of the invariant growth was due to non-protocol swap fees (i.e. value accrued by the
        // LPs), so we only mint a percentage of this BPT amount: that which corresponds to protocol fees.

        uint256 postJoinExitAmp = _postJoinExitAmp;

        uint256 totalGrowthInvariant = StableMath._calculateInvariant(postJoinExitAmp, totalGrowthBalances);
        uint256 swapGrowthInvariant = StableMath._calculateInvariant(postJoinExitAmp, swapGrowthBalances);

        // Total Growth = Invariant with old rates for exempt tokens / last invariant: swap fees + token yields
        // Swap Fee Growth = Invariant with old rates for all tokens / last invariant: swap fees alone
        // Growth due to yield = Total Growth / Swap Fee Growth
        //                     = Invariant with masked rates / Invariant with old rates.

        // If the "growth" is negative, set the ratio to ONE: multiplying by (ratio - 1) will then result in zero fees.
        uint256 yieldGrowthRatio = totalGrowthInvariant > swapGrowthInvariant
            ? totalGrowthInvariant.divDown(swapGrowthInvariant)
            : FixedPoint.ONE;

        uint256 postJoinExitInvariant = _postJoinExitInvariant;

        uint256 swapGrowthRatio = swapGrowthInvariant > postJoinExitInvariant
            ? swapGrowthInvariant.divDown(postJoinExitInvariant)
            : FixedPoint.ONE;

        // Apply separate protocol fee rates on yield and swap fee growth.
        // Total protocol fee rate = (FeeOnYield * (yieldGrowthRatio - 1) + FeeOnSwap * (swapGrowthRatio - 1))

        // We round down, favoring LP fees.
        uint256 protocolFeeAmount = getProtocolFeePercentageCache(ProtocolFeeType.YIELD)
            .mulDown(yieldGrowthRatio.sub(FixedPoint.ONE))
            .add(getProtocolFeePercentageCache(ProtocolFeeType.SWAP).mulDown(swapGrowthRatio.sub(FixedPoint.ONE)))
            .mulDown(virtualSupply);

        if (protocolFeeAmount > 0) {
            _payProtocolFees(protocolFeeAmount);
        }

        // We pay fees before a join or exit to ensure the pool is debt-free, so that swap fee and quote calculations
        // based on the virtual supply reflect only the current user's transaction. We have just increased the virtual
        // supply by minting the protocol fee tokens, so those are included in the return value.
        //
        // For this addition to overflow, the actual total supply would have already overflowed.
        return (virtualSupply + protocolFeeAmount, balancesWithoutBpt);
    }

    // Store the latest invariant based on the adjusted balances after the join or exit, using current rates.
    // Also cache the amp factor, so that the invariant is not affected by amp updates between joins and exits.
    function _updateInvariantAfterJoinExit(
        uint256 currentAmp,
        uint256[] memory balancesWithoutBpt,
        uint256 preJoinExitInvariant,
        uint256 preJoinExitSupply,
        uint256 postJoinExitSupply
    ) internal {
        uint256 postJoinExitInvariant = StableMath._calculateInvariant(currentAmp, balancesWithoutBpt);

        // Compute the growth ratio between the pre- and post-join/exit balances.
        // Note that the pre-join/exit invariant is *not* the invariant from the last join,
        // but computed from the balances before this particular join/exit.

        uint256 protocolSwapFeePercentage = getProtocolFeePercentageCache(ProtocolFeeType.SWAP);

        if (protocolSwapFeePercentage > 0) {
            uint256 invariantGrowthRatio = (
                postJoinExitInvariant > preJoinExitInvariant
                    ? postJoinExitInvariant.sub(preJoinExitInvariant)
                    : preJoinExitInvariant.sub(postJoinExitInvariant)
            )
                .divDown(preJoinExitInvariant);

            // Compute the bpt ratio
            uint256 bptGrowthRatio = (
                postJoinExitSupply > preJoinExitInvariant
                    ? postJoinExitSupply.sub(preJoinExitSupply)
                    : preJoinExitSupply.sub(postJoinExitSupply)
            )
                .divDown(preJoinExitSupply);

            // The difference between the invariant growth and bpt increase rates must be due to the
            // balance change from this join/exit.
            // Protocol fees due = (invariant growth / bpt increase - 1) * virtual supply * protocol fee %
            // For instance, if the invariant growth is 1.05, and the bpt increase is 1.0475, with 1000 supply,
            // and a protocol fee of 50%, we would mint (1.05/1.0475 - 1) * 1000 * 0.5 = 1.193 BPT.

            if (invariantGrowthRatio > bptGrowthRatio) {
                uint256 protocolFeeAmount = invariantGrowthRatio
                    .divDown(bptGrowthRatio)
                    .sub(FixedPoint.ONE)
                    .mulDown(preJoinExitSupply)
                    .mulDown(protocolSwapFeePercentage);

                _payProtocolFees(protocolFeeAmount);
            }
        }

        _updatePostJoinExit(currentAmp, postJoinExitInvariant);
    }

    function _updatePostJoinExit(uint256 currentAmp, uint256 postJoinExitInvariant) internal {
        // Update the stored invariant and amp values, and copy the rates
        _postJoinExitAmp = currentAmp;
        _postJoinExitInvariant = postJoinExitInvariant;

        _updateOldRates();
    }

    /**
     * @dev Inheritance rules still require us to override this in the most derived contract, even though
     * it only calls super.
     */
    function _isOwnerOnlyAction(bytes32 actionId)
        internal
        view
        virtual
        override(
            // Our inheritance pattern creates a small diamond that requires explicitly listing the parents here.
            // Each parent calls the `super` version, so linearization ensures all implementations are called.
            BasePool,
            BasePoolAuthorization,
            StablePoolRates
        )
        returns (bool)
    {
        return super._isOwnerOnlyAction(actionId);
    }
}
