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

import "./ComposableStablePoolStorage.sol";
import "./ComposableStablePoolRates.sol";
import "./StableMath.sol";

abstract contract ComposableStablePoolProtocolFees is
    ComposableStablePoolStorage,
    ComposableStablePoolRates,
    ProtocolFeeCache
{
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    // To track protocol fees, we measure and store the value of the invariant after every join and exit.
    // All invariant growth that happens between join and exit events is due to swap fees and yield.
    // For selected tokens, we exclude the yield portion from the computation.
    // Because the invariant depends on the amplification parameter, and this value may change over time, we should only
    // compare invariants that were computed using the same value. We therefore store both values together.
    //
    // These values reside in the same storage slot. The amplification factor is bound by _MAX_AMP * _AMP_PRECISION, or
    // 5e6, which fits in 23 bits. We use all remaining bits for the invariant: this is more than enough, as the
    // invariant is proportional to the total supply, which is capped at 112 bits.
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

    /**
     * @dev Calculates due protocol fees originating from accumulated swap fees and yield of non-exempt tokens, pays
     * them by minting BPT, and returns the updated virtual supply and current balances.
     */
    function _payProtocolFeesBeforeJoinExit(
        uint256[] memory registeredBalances,
        uint256 lastJoinExitAmp,
        uint256 lastPostJoinExitInvariant
    )
        internal
        returns (
            uint256,
            uint256[] memory,
            uint256
        )
    {
        (uint256 virtualSupply, uint256[] memory balances) = _dropBptItemFromBalances(registeredBalances);

        // First, we'll compute what percentage of the Pool the protocol should own due to charging protocol fees on
        // swap fees and yield.
        (
            uint256 expectedProtocolOwnershipPercentage,
            uint256 totalGrowthInvariant
        ) = _getProtocolPoolOwnershipPercentage(balances, lastJoinExitAmp, lastPostJoinExitInvariant);

        // Now that we know what percentage of the Pool's current value the protocol should own, we can compute how
        // much BPT we need to mint to get to this state. Since we're going to mint BPT for the protocol, the value
        // of each BPT is going to be reduced as all LPs get diluted.
        uint256 protocolFeeAmount = _calculateAdjustedProtocolFeeAmount(
            virtualSupply,
            expectedProtocolOwnershipPercentage
        );

        if (protocolFeeAmount > 0) {
            _payProtocolFees(protocolFeeAmount);
        }

        // We pay fees before a join or exit to ensure the pool is debt-free, so that swap fee and quote calculations
        // based on the virtual supply reflect only the current user's transaction. We have just increased the virtual
        // supply by minting the protocol fee tokens, so those are included in the return value.
        //
        // For this addition to overflow, the actual total supply would have already overflowed.
        return (virtualSupply + protocolFeeAmount, balances, totalGrowthInvariant);
    }

    function _getProtocolPoolOwnershipPercentage(
        uint256[] memory balances,
        uint256 lastJoinExitAmp,
        uint256 lastPostJoinExitInvariant
    ) internal view returns (uint256, uint256) {
        // We compute three invariants, adjusting the balances of tokens that have rate providers by undoing the current
        // rate adjustment and then applying the old rate. This is equivalent to multiplying by old rate / current rate.
        //
        // In all cases we compute invariants with the last join-exit amplification factor, so that changes to the
        // amplification are not translated into changes to the invariant. Since amplification factor changes are both
        // infrequent and slow, they should have little effect on the pool balances, making this a very good
        // approximation.
        //
        // With this technique we obtain an invariant that does not include yield at all, meaning any growth will be due
        // exclusively to swap fees. We call this the 'swap fee growth invariant'.
        // A second invariant will exclude the yield of exempt tokens, and therefore include both swap fees and
        // non-exempt yield. This is called the 'non exempt growth invariant'.
        // Finally, a third invariant includes the yield of all tokens by using only the current rates. We call this the
        // 'total growth invariant', since it includes both swap fee growth, non-exempt yield growth and exempt yield
        // growth. If the last join-exit amplification equals the current one, this invariant equals the current
        // invariant.

        (
            uint256 swapFeeGrowthInvariant,
            uint256 totalNonExemptGrowthInvariant,
            uint256 totalGrowthInvariant
        ) = _getGrowthInvariants(balances, lastJoinExitAmp);

        // By comparing the invariant increase attributable to each source of growth to the total growth invariant,
        // we can calculate how much of the current Pool value originates from that source, and then apply the
        // corresponding protocol fee percentage to that amount.

        // We have two sources of growth: swap fees, and non-exempt yield. As we illustrate graphically below:
        //
        // growth due to swap fees        = (swap fee growth invariant - last post join-exit invariant)
        // growth due to non-exempt yield = (non-exempt growth invariant - swap fee growth invariant)
        //
        // These can be converted to additive percentages by normalizing against the total growth invariant value:
        // growth due to swap fees / total growth invariant = % pool ownership due from swap fees
        // growth due to non-exempt yield / total growth invariant = % pool ownership due from non-exempt yield
        //
        //   ┌───────────────────────┐ ──┐
        //   │  exempt yield         │   │  total growth invariant
        //   ├───────────────────────┤   │ ──┐
        //   │  non-exempt yield     │   │   │  non-exempt growth invariant
        //   ├───────────────────────┤   │   │ ──┐
        //   │  swap fees            │   │   │   │  swap fee growth invariant
        //   ├───────────────────────┤   │   │   │ ──┐
        //   │   original value      │   │   │   │   │  last post join-exit invariant
        //   └───────────────────────┘ ──┘ ──┘ ──┘ ──┘
        //
        // Each invariant should be larger than its precedessor. In case any rounding error results in them being
        // smaller, we adjust the subtraction to equal 0.

        uint256 swapFeeGrowthInvariantDelta = (swapFeeGrowthInvariant > lastPostJoinExitInvariant)
            ? swapFeeGrowthInvariant - lastPostJoinExitInvariant
            : 0;
        uint256 nonExemptYieldGrowthInvariantDelta = (totalNonExemptGrowthInvariant > swapFeeGrowthInvariant)
            ? totalNonExemptGrowthInvariant - swapFeeGrowthInvariant
            : 0;

        // We can now derive what percentage of the Pool's total value each invariant delta represents by dividing by
        // the total growth invariant. These values, multiplied by the protocol fee percentage for each growth type,
        // represent the percentage of Pool ownership the protocol should have due to each source.

        uint256 protocolSwapFeePercentage = swapFeeGrowthInvariantDelta.divDown(totalGrowthInvariant).mulDown(
            getProtocolFeePercentageCache(ProtocolFeeType.SWAP)
        );

        uint256 protocolYieldPercentage = nonExemptYieldGrowthInvariantDelta.divDown(totalGrowthInvariant).mulDown(
            getProtocolFeePercentageCache(ProtocolFeeType.YIELD)
        );

        // These percentages can then be simply added to compute the total protocol Pool ownership percentage.
        // This is naturally bounded above by FixedPoint.ONE so this addition cannot overflow.
        return (protocolSwapFeePercentage + protocolYieldPercentage, totalGrowthInvariant);
    }

    function _getGrowthInvariants(uint256[] memory balances, uint256 lastJoinExitAmp)
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
            lastJoinExitAmp,
            _getAdjustedBalances(balances, true) // Adjust all balances
        );

        // For the other invariants, we can potentially skip some work. In the edge cases where none or all of the
        // tokens are exempt from yield, there's one fewer invariant to compute.

        if (_areNoTokensExempt()) {
            // If there are no tokens with fee-exempt yield, then the total non-exempt growth will equal the total
            // growth: all yield growth is non-exempt. There's also no point in adjusting balances, since we
            // already know none are exempt.

            totalNonExemptGrowthInvariant = StableMath._calculateInvariant(lastJoinExitAmp, balances);
            totalGrowthInvariant = totalNonExemptGrowthInvariant;
        } else if (_areAllTokensExempt()) {
            // If no tokens are charged fees on yield, then the non-exempt growth is equal to the swap fee growth - no
            // yield fees will be collected.

            totalNonExemptGrowthInvariant = swapFeeGrowthInvariant;
            totalGrowthInvariant = StableMath._calculateInvariant(lastJoinExitAmp, balances);
        } else {
            // In the general case, we need to calculate two invariants: one with some adjusted balances, and one with
            // the current balances.

            totalNonExemptGrowthInvariant = StableMath._calculateInvariant(
                lastJoinExitAmp,
                _getAdjustedBalances(balances, false) // Only adjust non-exempt balances
            );

            totalGrowthInvariant = StableMath._calculateInvariant(lastJoinExitAmp, balances);
        }
    }

    /**
     * @dev Store the latest invariant based on the adjusted balances after the join or exit, using current rates.
     * Also cache the amp factor, so that the invariant is not affected by amp updates between joins and exits.
     *
     * Pay protocol fees due on any current join or exit swap.
     */
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

        // `_payProtocolFeesBeforeJoinExit` paid protocol fees accumulated between the previous and current
        // join or exit, while this code pays any protocol fees due on the current join or exit.
        // The amp and rates are constant during a single transaction, so it doesn't matter if there
        // is an ongoing amp change, and we can ignore yield.

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
            getProtocolFeePercentageCache(ProtocolFeeType.SWAP)
        );

        if (protocolOwnershipPercentage > 0) {
            uint256 protocolFeeAmount = _calculateAdjustedProtocolFeeAmount(
                postJoinExitSupply,
                protocolOwnershipPercentage
            );

            _payProtocolFees(protocolFeeAmount);
        }

        _updatePostJoinExit(currentAmp, postJoinExitInvariant);
    }

    /**
     * @dev Update the stored values of the amp and final post-join/exit invariant, to reset the basis for protocol
     * swap fees. Also copy the current rates to the old rates, to establish the new protocol yield basis for protocol
     * yield fees.
     */
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

    /**
     * @dev Adjust a protocol fee percentage calculated before minting, to the equivalent value after minting.
     */
    function _calculateAdjustedProtocolFeeAmount(uint256 supply, uint256 basePercentage)
        internal
        pure
        returns (uint256)
    {
        // Since this fee amount will be minted as BPT, which increases the total supply, we need to mint
        // slightly more so that it reflects this percentage of the total supply after minting.
        //
        // The percentage of the Pool the protocol will own after minting is given by:
        // `protocol percentage = to mint / (current supply + to mint)`.
        // Solving for `to mint`, we arrive at:
        // `to mint = current supply * protocol percentage / (1 - protocol percentage)`.
        //
        return supply.mulDown(basePercentage).divDown(basePercentage.complement());
    }

    /**
     * @notice Return the amplification factor and invariant as of the most recent join or exit (including BPT swaps)
     */
    function getLastJoinExitData()
        public
        view
        returns (uint256 lastJoinExitAmplification, uint256 lastPostJoinExitInvariant)
    {
        bytes32 rawData = _lastJoinExitData;

        lastJoinExitAmplification = rawData.decodeUint(
            _LAST_JOIN_EXIT_AMPLIFICATION_OFFSET,
            _LAST_JOIN_EXIT_AMPLIFICATION_SIZE
        );

        lastPostJoinExitInvariant = rawData.decodeUint(
            _LAST_POST_JOIN_EXIT_INVARIANT_OFFSET,
            _LAST_POST_JOIN_EXIT_INVARIANT_SIZE
        );
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
            ComposableStablePoolRates
        )
        returns (bool)
    {
        return super._isOwnerOnlyAction(actionId);
    }
}
