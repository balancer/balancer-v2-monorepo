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

import "@balancer-labs/v2-pool-utils/contracts/ProtocolFeeCache.sol";

import "./BaseWeightedPool.sol";

abstract contract InvariantGrowthProtocolFees is BaseWeightedPool, ProtocolFeeCache {
    using FixedPoint for uint256;

    // This Pool pays protocol fees by measuring the growth of the invariant between joins and exits. Since weights are
    // immutable, the invariant only changes due to accumulated swap fees, which saves gas by freeing the Pool
    // from performing any computation or accounting associated with protocol fees during swaps.
    // This mechanism requires keeping track of the invariant after the last join or exit.
    uint256 private _lastPostJoinExitInvariant;

    /**
     * @dev Returns the value of the invariant after the last join or exit operation.
     */
    function getLastInvariant() public view returns (uint256) {
        return _lastPostJoinExitInvariant;
    }

    function _beforeJoinExit(
        uint256[] memory preBalances,
        uint256[] memory normalizedWeights,
        uint256 protocolSwapFeePercentage
    ) internal virtual override {
        // Before joins and exits, we measure the growth of the invariant compared to the invariant after the last join
        // or exit, which will have been caused by swap fees, and use it to mint BPT as protocol fees. This dilutes all
        // LPs, which means that new LPs will join the pool debt-free, and exiting LPs will pay any amounts due
        // before leaving.

        // We return immediately if the fee percentage is zero to avoid unnecessary computation.
        if (protocolSwapFeePercentage == 0) {
            return;
        }

        uint256 preJoinExitInvariant = WeightedMath._calculateInvariant(normalizedWeights, preBalances);

        uint256 toMint = WeightedMath._calcDueProtocolSwapFeeBptAmount(
            totalSupply(),
            _lastPostJoinExitInvariant,
            preJoinExitInvariant,
            protocolSwapFeePercentage
        );

        _payProtocolFees(toMint);
    }

    function _afterJoinExit(
        bool isJoin,
        bool isExemptFromProtocolFees,
        uint256[] memory preBalances,
        uint256[] memory balanceDeltas,
        uint256[] memory normalizedWeights,
        uint256 preJoinExitSupply,
        uint256 postJoinExitSupply
    ) internal virtual override {
        // After all joins and exits we store the post join/exit invariant in order to compute growth due to swap fees
        // in the next one.
        uint256 protocolSwapFeePercentage;
        uint256 preJoinExitInvariant;

        if (!isExemptFromProtocolFees) {
            protocolSwapFeePercentage = getProtocolFeePercentageCache(ProtocolFeeType.SWAP);
            preJoinExitInvariant = WeightedMath._calculateInvariant(normalizedWeights, preBalances);
        }

        // Compute the post balances by adding or removing the deltas. Note that we're allowed to mutate preBalances.
        for (uint256 i = 0; i < preBalances.length; ++i) {
            preBalances[i] = isJoin
                ? SafeMath.add(preBalances[i], balanceDeltas[i])
                : SafeMath.sub(preBalances[i], balanceDeltas[i]);
        }

        uint256 postJoinExitInvariant = WeightedMath._calculateInvariant(normalizedWeights, preBalances);
        _lastPostJoinExitInvariant = postJoinExitInvariant;

        // Stop here if we know there are no protocol fees due (e.g., initialization, or proportional join/exit)
        if (isExemptFromProtocolFees || protocolSwapFeePercentage == 0) {
            return;
        }

        // Compute the growth ratio between the pre- and post-join/exit balances.
        // `_beforeJoinExit` paid protocol fees accumulated between the previous and current join or exit,
        // while this code pays any protocol fees due on the current join or exit.

        // Joins and exits are symmetrical; for simplicity, we consider a join, where the invariant and supply
        // both increase.

        // |-------------------------|-- postJoinExitInvariant
        // |   increase from fees    |
        // |-------------------------|-- original invariant * supply growth ratio (fee-less invariant)
        // |                         |
        // | increase from balances  |
        // |-------------------------|-- preJoinExitInvariant
        // |                         |
        // |                         |  |------------------|-- postJoinExitSupply
        // |                         |  |    BPT minted    |
        // |                         |  |------------------|-- preJoinExitSupply
        // |   original invariant    |  |  original supply |
        // |_________________________|  |__________________|
        //
        // If the join is proportional, the invariant and supply will likewise increase proportionally,
        // so the growth ratios (postJoinExit / preJoinExit) will be equal. In this case, we do not charge
        // any protocol fees.
        //
        // If the join is non-proportional, the supply increase will be proportionally less than the invariant increase,
        // since the BPT minted will be based on fewer tokens (because swap fees are not included). So the supply growth
        // is due entirely to the balance changes, while the invariant growth also includes swap fees.
        //
        // To isolate the amount of increase by fees then, we multiply the original invariant by the supply growth
        // ratio to get the "feeless invariant". The difference between the final invariant and this value is then
        // the amount of the invariant due to fees, which we convert to a percentage by normalizing against the
        // final (postJoinExit) invariant.
        //
        // Compute the portion of the invariant increase due to fees
        uint256 supplyGrowthRatio = postJoinExitSupply.divDown(preJoinExitSupply);
        uint256 feelessInvariant = preJoinExitInvariant.mulDown(supplyGrowthRatio);

        uint256 invariantDeltaFromFees = postJoinExitInvariant - feelessInvariant;

        // To convert to a percentage of pool ownership, multiply by the rate,
        // then normalize against the final invariant
        uint256 protocolOwnershipPercentage = invariantDeltaFromFees.divDown(postJoinExitInvariant).mulDown(
            protocolSwapFeePercentage
        );

        if (protocolOwnershipPercentage > 0) {
            uint256 protocolFeeAmount = _calculateAdjustedProtocolFeeAmount(
                postJoinExitSupply,
                protocolOwnershipPercentage
            );

            _payProtocolFees(protocolFeeAmount);
        }
    }
}
