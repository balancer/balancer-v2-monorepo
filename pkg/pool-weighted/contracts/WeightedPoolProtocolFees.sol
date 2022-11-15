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

import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProviderPool.sol";
import "@balancer-labs/v2-pool-utils/contracts/external-fees/ProtocolFeeCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/external-fees/InvariantGrowthProtocolSwapFees.sol";

import "./BaseWeightedPool.sol";

abstract contract WeightedPoolProtocolFees is BaseWeightedPool, ProtocolFeeCache, IRateProviderPool {
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    // Rate providers are used only for computing yield fees; they do not inform swap/join/exit.
    IRateProvider internal immutable _rateProvider0;
    IRateProvider internal immutable _rateProvider1;
    IRateProvider internal immutable _rateProvider2;
    IRateProvider internal immutable _rateProvider3;
    IRateProvider internal immutable _rateProvider4;
    IRateProvider internal immutable _rateProvider5;
    IRateProvider internal immutable _rateProvider6;
    IRateProvider internal immutable _rateProvider7;

    bool internal immutable _exemptFromYieldFees;

    // All-time high value of the weighted product of the pool's token rates. Comparing such weighted products across
    // time provides a measure of the pool's growth resulting from rate changes. The pool also grows due to swap fees,
    // but that growth is captured in the invariant; rate growth is not.
    uint256 private _athRateProduct;

    // This Pool pays protocol fees by measuring the growth of the invariant between joins and exits. Since weights are
    // immutable, the invariant only changes due to accumulated swap fees, which saves gas by freeing the Pool
    // from performing any computation or accounting associated with protocol fees during swaps.
    // This mechanism requires keeping track of the invariant after the last join or exit.
    //
    // The maximum value of the invariant is the maximum allowable balance in the Vault (2**112) multiplied by the
    // largest possible scaling factor (10**18 for a zero decimals token). The largest invariant is then
    // 2**112 * 10**18 ~= 2**172, which means that to save gas we can place this in BasePool's `_miscData`.
    uint256 private constant _LAST_POST_JOINEXIT_INVARIANT_OFFSET = 0;
    uint256 private constant _LAST_POST_JOINEXIT_INVARIANT_BIT_LENGTH = 192;

    constructor(uint256 numTokens, IRateProvider[] memory rateProviders) {
        _require(numTokens <= 8, Errors.MAX_TOKENS);
        InputHelpers.ensureInputLengthMatch(numTokens, rateProviders.length);

        _exemptFromYieldFees = _getYieldFeeExemption(rateProviders);

        _rateProvider0 = rateProviders[0];
        _rateProvider1 = rateProviders[1];
        _rateProvider2 = numTokens > 2 ? rateProviders[2] : IRateProvider(0);
        _rateProvider3 = numTokens > 3 ? rateProviders[3] : IRateProvider(0);
        _rateProvider4 = numTokens > 4 ? rateProviders[4] : IRateProvider(0);
        _rateProvider5 = numTokens > 5 ? rateProviders[5] : IRateProvider(0);
        _rateProvider6 = numTokens > 6 ? rateProviders[6] : IRateProvider(0);
        _rateProvider7 = numTokens > 7 ? rateProviders[7] : IRateProvider(0);
    }

    function _getYieldFeeExemption(IRateProvider[] memory rateProviders) internal pure returns (bool) {
        // If we know that no rate providers are set then we can skip yield fees logic.
        // If any tokens have rate providers, then set `_exemptFromYieldFees` to false, otherwise leave it true.
        for (uint256 i = 0; i < rateProviders.length; i++) {
            if (rateProviders[i] != IRateProvider(0)) {
                return false;
            }
        }
        return true;
    }

    /**
     * @dev Returns whether the pool is exempt from protocol fees on yield.
     */
    function _isExemptFromYieldProtocolFees() internal view returns (bool) {
        return _exemptFromYieldFees;
    }

    /**
     * @notice Returns the value of the invariant after the last join or exit operation.
     */
    function getLastPostJoinExitInvariant() public view returns (uint256) {
        return
            _getMiscData().decodeUint(_LAST_POST_JOINEXIT_INVARIANT_OFFSET, _LAST_POST_JOINEXIT_INVARIANT_BIT_LENGTH);
    }

    /**
     * @notice Returns the all time high value for the weighted product of the Pool's tokens' rates.
     * @dev Yield protocol fees are only charged when this value is exceeded.
     */
    function getATHRateProduct() public view returns (uint256) {
        return _athRateProduct;
    }

    function getRateProviders() external view override returns (IRateProvider[] memory) {
        uint256 totalTokens = _getTotalTokens();
        IRateProvider[] memory providers = new IRateProvider[](totalTokens);

        // prettier-ignore
        {
            providers[0] = _rateProvider0;
            providers[1] = _rateProvider1;
            if (totalTokens > 2) { providers[2] = _rateProvider2; } else { return providers; }
            if (totalTokens > 3) { providers[3] = _rateProvider3; } else { return providers; }
            if (totalTokens > 4) { providers[4] = _rateProvider4; } else { return providers; }
            if (totalTokens > 5) { providers[5] = _rateProvider5; } else { return providers; }
            if (totalTokens > 6) { providers[6] = _rateProvider6; } else { return providers; }
            if (totalTokens > 7) { providers[7] = _rateProvider7; } else { return providers; }
        }

        return providers;
    }

    // Protocol Fees

    /**
     * @dev Returns the percentage of the Pool's supply which corresponds to protocol fees on swaps accrued by the Pool.
     * @param preJoinExitInvariant - The Pool's invariant prior to the join/exit *before* minting protocol fees.
     * @param protocolSwapFeePercentage - The percentage of swap fees which are paid to the protocol.
     * @return swapProtocolFeesPercentage - The percentage of the Pool which corresponds to protocol fees on swaps.
     */
    function _getSwapProtocolFeesPoolPercentage(uint256 preJoinExitInvariant, uint256 protocolSwapFeePercentage)
        internal
        view
        returns (uint256)
    {
        // Before joins and exits, we measure the growth of the invariant compared to the invariant after the last join
        // or exit, which will have been caused by swap fees, and use it to mint BPT as protocol fees. This dilutes all
        // LPs, which means that new LPs will join the pool debt-free, and exiting LPs will pay any amounts due
        // before leaving.

        return
            InvariantGrowthProtocolSwapFees.getProtocolOwnershipPercentage(
                preJoinExitInvariant.divDown(getLastPostJoinExitInvariant()),
                FixedPoint.ONE, // Supply has not changed so supplyGrowthRatio = 1
                protocolSwapFeePercentage
            );
    }

    /**
     * @dev Returns the percentage of the Pool's supply which corresponds to protocol fees on yield accrued by the Pool.
     * @param normalizedWeights - The Pool's normalized token weights.
     * @return yieldProtocolFeesPercentage - The percentage of the Pool which corresponds to protocol fees on yield.
     * @return athRateProduct - The new all-time-high rate product if it has increased, otherwise zero.
     */
    function _getYieldProtocolFeesPoolPercentage(uint256[] memory normalizedWeights)
        internal
        view
        returns (uint256, uint256)
    {
        if (_isExemptFromYieldProtocolFees()) return (0, 0);

        // Yield manifests in the Pool by individual tokens becoming more valuable, we convert this into comparable
        // units by applying a rate to get the equivalent balance of non-yield-bearing tokens
        //
        // non-yield-bearing balance = rate * yield-bearing balance
        //                       x'i = ri * xi
        //
        // To measure the amount of fees to pay due to yield, we take advantage of the fact that scaling the
        // Pool's balances results in a scaling factor being applied to the original invariant.
        //
        // I(r1 * x1, r2 * x2) = (r1 * x1)^w1 * (r2 * x2)^w2
        //                     = (r1)^w1 * (r2)^w2 * (x1)^w1 * (x2)^w2
        //                     = I(r1, r2) * I(x1, x2)
        //
        // We then only need to measure the growth of this scaling factor to measure how the value of the BPT token
        // increases due to yield; we can ignore the invariant calculated from the Pool's balances as these cancel.
        // We then have the result:
        //
        // invariantGrowthRatio = I(r1_new, r2_new) / I(r1_old, r2_old) = rateProduct / athRateProduct

        uint256 athRateProduct = _athRateProduct;
        uint256 rateProduct = _getRateProduct(normalizedWeights);

        // Only charge yield fees if we've exceeded the all time high of Pool value generated through yield.
        // i.e. if the Pool makes a loss through the yield strategies then it shouldn't charge fees until it's
        // been recovered.
        if (rateProduct <= athRateProduct) return (0, 0);

        return (
            InvariantGrowthProtocolSwapFees.getProtocolOwnershipPercentage(
                rateProduct.divDown(athRateProduct),
                FixedPoint.ONE, // Supply has not changed so supplyGrowthRatio = 1
                getProtocolFeePercentageCache(ProtocolFeeType.YIELD)
            ),
            rateProduct
        );
    }

    function _updateATHRateProduct(uint256 rateProduct) internal {
        _athRateProduct = rateProduct;
    }

    /**
     * @dev Returns the amount of BPT to be minted as protocol fees prior to processing a join/exit.
     * Note that this isn't a view function. This function automatically updates `_athRateProduct`  to ensure that
     * proper accounting is performed to prevent charging duplicate protocol fees.
     * @param preJoinExitInvariant - The Pool's invariant prior to the join/exit.
     * @param normalizedWeights - The Pool's normalized token weights.
     * @param preJoinExitSupply - The Pool's total supply prior to the join/exit *before* minting protocol fees.
     * @return protocolFeesToBeMinted -  The amount of BPT to be minted as protocol fees.
     * @return athRateProduct - The new all-time-high rate product if it has increased, otherwise zero.
     */
    function _getPreJoinExitProtocolFees(
        uint256 preJoinExitInvariant,
        uint256[] memory normalizedWeights,
        uint256 preJoinExitSupply
    ) internal view returns (uint256, uint256) {
        uint256 protocolSwapFeesPoolPercentage = _getSwapProtocolFeesPoolPercentage(
            preJoinExitInvariant,
            getProtocolFeePercentageCache(ProtocolFeeType.SWAP)
        );
        (uint256 protocolYieldFeesPoolPercentage, uint256 athRateProduct) = _getYieldProtocolFeesPoolPercentage(
            normalizedWeights
        );

        return (
            ExternalFees.bptForPoolOwnershipPercentage(
                preJoinExitSupply,
                protocolSwapFeesPoolPercentage + protocolYieldFeesPoolPercentage
            ),
            athRateProduct
        );
    }

    /**
     * @dev Returns the amount of BPT to be minted to pay protocol fees on swap fees accrued during a join/exit.
     * Note that this isn't a view function. This function automatically updates `_lastPostJoinExitInvariant` to
     * ensure that proper accounting is performed to prevent charging duplicate protocol fees.
     * @param preJoinExitInvariant - The Pool's invariant prior to the join/exit.
     * @param preBalances - The Pool's balances prior to the join/exit.
     * @param balanceDeltas - The changes to the Pool's balances due to the join/exit.
     * @param normalizedWeights - The Pool's normalized token weights.
     * @param preJoinExitSupply - The Pool's total supply prior to the join/exit *after* minting protocol fees.
     * @param postJoinExitSupply - The Pool's total supply after the join/exit.
     */
    function _getPostJoinExitProtocolFees(
        uint256 preJoinExitInvariant,
        uint256[] memory preBalances,
        uint256[] memory balanceDeltas,
        uint256[] memory normalizedWeights,
        uint256 preJoinExitSupply,
        uint256 postJoinExitSupply
    ) internal returns (uint256) {
        bool isJoin = postJoinExitSupply >= preJoinExitSupply;

        // Compute the post balances by adding or removing the deltas.
        for (uint256 i = 0; i < preBalances.length; ++i) {
            preBalances[i] = isJoin
                ? SafeMath.add(preBalances[i], balanceDeltas[i])
                : SafeMath.sub(preBalances[i], balanceDeltas[i]);
        }

        // preBalances have now been mutated to reflect the postJoinExit balances.
        uint256 postJoinExitInvariant = WeightedMath._calculateInvariant(normalizedWeights, preBalances);
        uint256 protocolSwapFeePercentage = getProtocolFeePercentageCache(ProtocolFeeType.SWAP);

        _updatePostJoinExit(postJoinExitInvariant);
        // We return immediately if the fee percentage is zero to avoid unnecessary computation.
        if (protocolSwapFeePercentage == 0) return 0;

        uint256 protocolFeeAmount = InvariantGrowthProtocolSwapFees.calcDueProtocolFees(
            postJoinExitInvariant.divDown(preJoinExitInvariant),
            preJoinExitSupply,
            postJoinExitSupply,
            protocolSwapFeePercentage
        );

        return protocolFeeAmount;
    }

    function _updatePostJoinExit(uint256 postJoinExitInvariant) internal virtual override {
        // After all joins and exits we store the post join/exit invariant in order to compute growth due to swap fees
        // in the next one.
        _setMiscData(
            _getMiscData().insertUint(
                postJoinExitInvariant,
                _LAST_POST_JOINEXIT_INVARIANT_OFFSET,
                _LAST_POST_JOINEXIT_INVARIANT_BIT_LENGTH
            )
        );
    }

    // Helper functions

    /**
     * @notice Returns the contribution to the total rate product from a token with the given weight and rate provider.
     */
    function _getRateFactor(uint256 normalizedWeight, IRateProvider provider) internal view returns (uint256) {
        return provider == IRateProvider(0) ? FixedPoint.ONE : provider.getRate().powDown(normalizedWeight);
    }

    /**
     * @dev Returns the weighted product of all the token rates.
     */
    function _getRateProduct(uint256[] memory normalizedWeights) internal view returns (uint256) {
        uint256 totalTokens = normalizedWeights.length;

        uint256 rateProduct = FixedPoint.mulDown(
            _getRateFactor(normalizedWeights[0], _rateProvider0),
            _getRateFactor(normalizedWeights[1], _rateProvider1)
        );

        if (totalTokens > 2) {
            rateProduct = rateProduct.mulDown(_getRateFactor(normalizedWeights[2], _rateProvider2));
        } else {
            return rateProduct;
        }
        if (totalTokens > 3) {
            rateProduct = rateProduct.mulDown(_getRateFactor(normalizedWeights[3], _rateProvider3));
        } else {
            return rateProduct;
        }
        if (totalTokens > 4) {
            rateProduct = rateProduct.mulDown(_getRateFactor(normalizedWeights[4], _rateProvider4));
        } else {
            return rateProduct;
        }
        if (totalTokens > 5) {
            rateProduct = rateProduct.mulDown(_getRateFactor(normalizedWeights[5], _rateProvider5));
        } else {
            return rateProduct;
        }
        if (totalTokens > 6) {
            rateProduct = rateProduct.mulDown(_getRateFactor(normalizedWeights[6], _rateProvider6));
        } else {
            return rateProduct;
        }
        if (totalTokens > 7) {
            rateProduct = rateProduct.mulDown(_getRateFactor(normalizedWeights[7], _rateProvider7));
        }

        return rateProduct;
    }

    function _isOwnerOnlyAction(bytes32 actionId)
        internal
        view
        virtual
        override(BasePool, BasePoolAuthorization)
        returns (bool)
    {
        return super._isOwnerOnlyAction(actionId);
    }
}
