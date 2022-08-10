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
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";
import "@balancer-labs/v2-pool-utils/contracts/ProtocolFeeCache.sol";

import "./StablePoolStorage.sol";
import "./StablePoolRates.sol";
import "./StableMath.sol";

abstract contract StablePoolProtocolFees is StablePoolStorage, StablePoolRates, ProtocolFeeCache {
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    // We store the invariant after the last join-exit, along with the amplification factor used to compute it. The
    // amplification factor is bound by _MAX_AMP * _AMP_PRECISION, or 5e6, which fits in 23 bits. We use all remaining
    // bits for the invariant: this is more than enough, as the invariant is proportional to the total supply, which is
    // capped at 112 bits.
    // The data structure is as follows:
    //
    // [ last join-exit amplification  | last post join-exit invariant ]
    // [           23 bits             |            233 bits           ]
    bytes32 private _lastJoinExitData;

    uint256 private constant _LAST_POST_JOIN_EXIT_INVARIANT_OFFSET = 0;
    uint256 private constant _LAST_POST_JOIN_EXIT_INVARIANT_SIZE = 233;
    uint256 private constant _LAST_JOIN_EXIT_AMPLIFICATION_OFFSET = _LAST_POST_JOIN_EXIT_INVARIANT_OFFSET +
        _LAST_POST_JOIN_EXIT_INVARIANT_SIZE;

    uint256 private constant _LAST_JOIN_EXIT_AMPLIFICATION_SIZE = 23;

    // To track protocol fees, we measure and store the value of the invariant after every join and exit.
    // All invariant growth that happens between join and exit events is due to swap fees and yield.
    // For selected tokens, we exclude the yield portion from the computation.
    uint256 private _lastPostJoinExitInvariant;

    // Because the invariant depends on the amplification parameter, and this value may change over time, we should only
    // compare invariants that were computed using the same value. We therefore store `_lastPostJoinExitAmp` whenever we
    // store `_lastPostJoinExitInvariant`.
    uint256 private _lastPostJoinExitAmp;

    /**
     * @dev Before joins or exits, calculate the invariant using the old rates for exempt tokens (i.e., the rates
     * at the time of the previous join or exit), in order to exclude the yield from the calculation for those tokens.
     * Calculate the (non-exempt) yield and swap fee growth separately, and apply the corresponding protocol fee
     * percentage to each type.
     */
    function _payProtocolFeesBeforeJoinExit(uint256[] memory registeredBalances)
        internal
        returns (uint256, uint256[] memory)
    {
        (uint256 virtualSupply, uint256[] memory balances) = _dropBptItemFromBalances(registeredBalances);

        // First, we'll compute what percentage of the Pool the protocol should own due to charging protocol fees on
        // swap fees and yield.
        uint256 expectedProtocolOwnershipPercentage = _getExpectedProtocolPoolOwnershipPercentage(balances);

        // Now that we know what percentage of the Pool's current value the protocol should own, we can compute how much
        // BPT we need to mint to get to this state. Since we're going to mint BPT for the protocol, the value of each
        // BPT is going to be reduced as all LPs get diluted. The percentage of the Pool the protocol will own after
        // minting is given by `protocol percentage = to mint / (current supply + to mint)`.
        // Solving for `to mint`, we arrive at:
        // `to mint = current supply * protocol percentage / (1 - protocol percentage)`.

        uint256 protocolFeeAmount = virtualSupply.mulDown(expectedProtocolOwnershipPercentage).divDown(
            expectedProtocolOwnershipPercentage.complement()
        );

        if (protocolFeeAmount > 0) {
            _payProtocolFees(protocolFeeAmount);
        }

        // We pay fees before a join or exit to ensure the pool is debt-free, so that swap fee and quote calculations
        // based on the virtual supply reflect only the current user's transaction. We have just increased the virtual
        // supply by minting the protocol fee tokens, so those are included in the return value.
        //
        // For this addition to overflow, the actual total supply would have already overflowed.
        return (virtualSupply + protocolFeeAmount, balances);
    }

    function _getExpectedProtocolPoolOwnershipPercentage(uint256[] memory balances) internal view returns (uint256) {
        // First, we adjust the current balances of tokens that have rate providers by undoing the current rate
        // adjustment, then applying the old rate. This is equivalent to multiplying by the ratio:
        // old rate / current rate.
        // This is done twice: first to *all* tokens that have a rate provider, and second only to tokens that are
        // exempt from yield fees.
        // By computing the balances with the old rates, we get a (very good) approximation of what the Pool state would
        // be if the token rates had not increased. We can then use this to compute the invariant growth relative to the
        // last post join-exit invariant, which will be exclusively due to swap fees. We call this the 'swap fee
        // growth'.
        // The second set of balances (using old rates only for tokens exempt from yield fees) can be used to compute
        // another invariant growth, which this time will include a combination of swap fees and yield (since the rate
        // of some non-exempt tokens will have increased). We call this the 'non exempt total growth'.
        // We also calculate the 'total growth', using the current balances (i.e. with all current rates). A part of
        // this growth will be exempt from protocol fees (that which corresponds to yield of exempt tokens), but we
        // still need this value in order to assess the total fees to charge.

        // In all cases we compute invariants with the last post join-exit amplification factor, so that changes to the
        // amplification are not translated into changes to the invariant. Since amplification factor changes are both
        // infrequent and slow, they should have little effect in the pool balances, making this a very good
        // approximation.

        (uint256 lastJoinExitAmp, uint256 lastPostJoinExitInvariant) = getLastJoinExitData();

(
            uint256 swapFeeGrowthInvariant,
            uint256 totalNonExemptGrowthInvariant,
            uint256 totalGrowthInvariant
        ) = _getGrowthInvariants(balances, lastJoinExitAmp);

        // All growth ratios should be greater or equal to one (since swap fees are positive and token rates are
        // expected to only increase) - in case any rounding error results in growth smaller than one (i.e. in the
        // invariant decreasing) we manually adjust the ratio to equal one.

        // The swap fee growth is easy to compute: we simply compare the swap fee growth invariant with the last post
        // join-exit invariant.

        uint256 swapFeeGrowthRatio = Math.max(
            swapFeeGrowthInvariant.divDown(lastPostJoinExitInvariant),
            FixedPoint.ONE
        );

        // The yield growth is not trivial to compute directly, but we can simply derive it from the swap and non exempt
        // total growths. Since the invariant only grows due to swap fees and yield, any growth not due to swap fees
        // must be caused by yield.
        uint256 totalNonExemptGrowth = Math.max(
            totalNonExemptGrowthInvariant.divDown(lastPostJoinExitInvariant),
            FixedPoint.ONE
        );
        uint256 yieldGrowthRatio = Math.max(totalNonExemptGrowth.divDown(swapFeeGrowthRatio), FixedPoint.ONE);

        // The total growth ratio simply uses the total growth invariant.
        uint256 totalGrowthRatio = Math.max(totalGrowthInvariant.divDown(lastPostJoinExitInvariant), FixedPoint.ONE);

        // With all three growths, we can now compute the total protocol fees.
        // For each growth type (swap fees and yield), the percentage that the growth represents of the current value
        // equals `(growth - 1) / total growth`. For example, if the total growth is 1.5 and swap fee growth is 1.3,
        // then the swap fee tokens (worth 30% of the Pool value at the last join-exit), now compose 20% of the Pool's
        // total value.

        uint256 poolSwapFeePercentage = (swapFeeGrowthRatio - FixedPoint.ONE).divDown(totalGrowthRatio);
        uint256 poolYieldPercentage = (yieldGrowthRatio - FixedPoint.ONE).divDown(totalGrowthRatio);

        // The protocol should own a percentage of the current Pool value due to each growth, according to the protocol
        // fee percentages. For example, if the swap fee growth corresponds to 20% of the current Pool's value, and the
        // protocol swap fee is 25%, then the protocol should own 5% of the current Pool's value. These percentages can
        // be added: the protocol should own some percentage of the Pool due to swap fees, plus some other percentage
        // due to yield fees.

        return
            poolSwapFeePercentage.mulDown(getProtocolFeePercentageCache(ProtocolFeeType.SWAP)).add(
                poolYieldPercentage.mulDown(getProtocolFeePercentageCache(ProtocolFeeType.YIELD))
            );
    }

    function _getGrowthInvariants(uint256[] memory balances, uint256 lastPostJoinExitAmp)
        internal
        view
        returns (
            uint256 swapFeeGrowthInvariant,
            uint256 totalNonExemptGrowthInvariant,
            uint256 totalGrowthInvariant
        )
    {
        // We always calculate the swap fee growth invariant, since we cannot easily know whether swap fees have
        // accumulated or not.

        swapFeeGrowthInvariant = StableMath._calculateInvariant(
            lastPostJoinExitAmp,
            _getAdjustedBalances(balances, true) // Adjust all balances
        );

        // For the other invariants, we can potentially skip some work. In the edge cases where none or all of the
        // tokens are exempt from yield, there's one fewer invariant to compute.

        if (_areNoTokensExempt()) {
            // If there are no tokens exempt of yield fee, then the total non exempt growth will equal the total growth
            // (because all yield growth is non exempt). There's also no point in adjusting balances to get the
            // non-exempt ones, as none are exempt and as such this equals the current balances.

            totalNonExemptGrowthInvariant = StableMath._calculateInvariant(lastPostJoinExitAmp, balances);
            totalGrowthInvariant = totalNonExemptGrowthInvariant;
        } else if (_areAllTokensExempt()) {
            // If all tokens are exempt of yield fee, then the non exempt growth is equal to the swap fee growth - no
            // yield fees will be collected.

            totalNonExemptGrowthInvariant = swapFeeGrowthInvariant;
            totalGrowthInvariant = StableMath._calculateInvariant(lastPostJoinExitAmp, balances);
        } else {
            // In the general case, we need to calculate two invariants: one with some adjusted balances, and one with
            // the current balances.

            totalNonExemptGrowthInvariant = StableMath._calculateInvariant(
                lastPostJoinExitAmp,
                _getAdjustedBalances(balances, false) // Only adjust non-exempt balances
            );

            totalGrowthInvariant = StableMath._calculateInvariant(lastPostJoinExitAmp, balances);
        }
    }

    // Store the latest invariant based on the adjusted balances after the join or exit, using current rates.
    // Also cache the amp factor, so that the invariant is not affected by amp updates between joins and exits.
    function _updateInvariantAfterJoinExit(
        uint256 currentAmp,
        uint256[] memory balances,
        uint256 preJoinExitInvariant,
        uint256 preJoinExitSupply,
        uint256 postJoinExitSupply
    ) internal {
        uint256 postJoinExitInvariant = StableMath._calculateInvariant(currentAmp, balances);

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
        _lastJoinExitData =
            WordCodec.encodeUint(currentAmp, _LAST_JOIN_EXIT_AMPLIFICATION_OFFSET, _LAST_JOIN_EXIT_AMPLIFICATION_SIZE) |
            WordCodec.encodeUint(
                postJoinExitInvariant,
                _LAST_POST_JOIN_EXIT_INVARIANT_OFFSET,
                _LAST_POST_JOIN_EXIT_INVARIANT_SIZE
            );

        _updateOldRates();
    }

    function getLastJoinExitData() public view returns (uint256, uint256) {
        bytes32 rawData = _lastJoinExitData;

        uint256 lastJoinExitAmplification = rawData.decodeUint(
            _LAST_JOIN_EXIT_AMPLIFICATION_OFFSET,
            _LAST_JOIN_EXIT_AMPLIFICATION_SIZE
        );

        uint256 lastPostJoinExitInvariant = rawData.decodeUint(
            _LAST_POST_JOIN_EXIT_INVARIANT_OFFSET,
            _LAST_POST_JOIN_EXIT_INVARIANT_SIZE
        );

        return (lastJoinExitAmplification, lastPostJoinExitInvariant);
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
