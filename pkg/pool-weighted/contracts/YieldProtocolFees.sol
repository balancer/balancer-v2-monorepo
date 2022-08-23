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

import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProvider.sol";
import "@balancer-labs/v2-pool-utils/contracts/ProtocolFeeCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/InvariantGrowthProtocolSwapFees.sol";

import "./BaseWeightedPool.sol";

abstract contract YieldProtocolFees is BaseWeightedPool, ProtocolFeeCache {
    using FixedPoint for uint256;

    // Rate providers are used only for computing yield fees; they do not inform swap/join/exit.
    IRateProvider internal immutable _rateProvider0;
    IRateProvider internal immutable _rateProvider1;
    IRateProvider internal immutable _rateProvider2;
    IRateProvider internal immutable _rateProvider3;
    IRateProvider internal immutable _rateProvider4;
    IRateProvider internal immutable _rateProvider5;
    IRateProvider internal immutable _rateProvider6;
    IRateProvider internal immutable _rateProvider7;

    // All-time high value of the weighted product of the pool's token rates. Comparing such weighted products across
    // time provides a measure of the pool's growth resulting from rate changes. The pool also grows due to swap fees,
    // but that growth is captured in the invariant; rate growth is not.
    uint256 private _athRateProduct;

    uint256 private constant NO_YIELD_FEES_SENTINEL = type(uint256).max;

    constructor(uint256 numTokens, IRateProvider[] memory rateProviders) {
        InputHelpers.ensureInputLengthMatch(numTokens, rateProviders.length);

        // If we know that no rate providers are set then we can skip yield fees logic.
        // If so then set _athRateProduct to the sentinel value, otherwise leave it as zero.
        for (uint256 i = 0; i < numTokens; i++) {
            if (rateProviders[i] != IRateProvider(0)) break;
            _athRateProduct = NO_YIELD_FEES_SENTINEL;
        }

        _rateProvider0 = rateProviders[0];
        _rateProvider1 = rateProviders[1];
        _rateProvider2 = numTokens > 2 ? rateProviders[2] : IRateProvider(0);
        _rateProvider3 = numTokens > 3 ? rateProviders[3] : IRateProvider(0);
        _rateProvider4 = numTokens > 4 ? rateProviders[4] : IRateProvider(0);
        _rateProvider5 = numTokens > 5 ? rateProviders[5] : IRateProvider(0);
        _rateProvider6 = numTokens > 6 ? rateProviders[6] : IRateProvider(0);
        _rateProvider7 = numTokens > 7 ? rateProviders[7] : IRateProvider(0);
    }

    /**
     * @dev Returns the rate providers configured for each token (in the same order as registered).
     */
    function getRateProviders() external view returns (IRateProvider[] memory providers) {
        uint256 totalTokens = _getTotalTokens();
        providers = new IRateProvider[](totalTokens);

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

    function _getYieldProtocolFee(uint256[] memory normalizedWeights, uint256 supply) internal returns (uint256) {
        uint256 athRateProduct = _athRateProduct;
        if (athRateProduct == NO_YIELD_FEES_SENTINEL) return 0;

        uint256 rateProduct = _getRateProduct(normalizedWeights);
        if (athRateProduct == 0) {
            // Initialise `_athRateProduct`. This will occur on the first join/exit after Pool initialisation.
            // Not initialising this here properly will cause all joins/exits to revert.
            _athRateProduct = rateProduct;
        } else if (rateProduct > athRateProduct) {
            // Only charge yield fees if we've exceeded the all time high of Pool value generated through yield.
            // i.e. if the Pool makes a loss through the yield strategies then it shouldn't charge fees until it's
            // been recovered.
            _athRateProduct = rateProduct;

            return
                InvariantGrowthProtocolSwapFees.calcDueProtocolFees(
                    rateProduct.divDown(athRateProduct),
                    supply,
                    supply,
                    getProtocolFeePercentageCache(ProtocolFeeType.YIELD)
                );
        }
        return 0;
    }
}
