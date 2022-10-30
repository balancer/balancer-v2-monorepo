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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProvider.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-pool-utils/contracts/rates/PriceRateCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/PoolRegistrationLib.sol";

import "./ComposableStablePoolStorage.sol";

abstract contract ComposableStablePoolRates is ComposableStablePoolStorage {
    using PriceRateCache for bytes32;
    using FixedPoint for uint256;

    struct RatesParams {
        IERC20[] tokens;
        IRateProvider[] rateProviders;
        uint256[] tokenRateCacheDurations;
    }

    // Token rate caches are used to avoid querying the price rate for a token every time we need to work with it.
    // The "old rate" field is used for precise protocol fee calculation, to ensure that token yield is only
    // "taxed" once. The data structure is as follows:
    //
    // [ expires | duration | old rate | current rate ]
    // [ uint32  |  uint32  |  uint96  |   uint96     ]

    // Since we never need just one cache but all of them at once, instead of making the mapping go from token address
    // to cache, we go from token index (not including BPT), i.e. an array. We use a mapping however instead of a native
    // array to skip the extra read associated with the out-of-bounds check, as we have cheaper ways to guarantee the
    // indices are valid.
    mapping(uint256 => bytes32) internal _tokenRateCaches;

    event TokenRateCacheUpdated(uint256 indexed tokenIndex, uint256 rate);
    event TokenRateProviderSet(uint256 indexed tokenIndex, IRateProvider indexed provider, uint256 cacheDuration);

    constructor(RatesParams memory rateParams) {
        InputHelpers.ensureInputLengthMatch(
            rateParams.tokens.length,
            rateParams.rateProviders.length,
            rateParams.tokenRateCacheDurations.length
        );

        for (uint256 i = 0; i < rateParams.tokens.length; i++) {
            if (rateParams.rateProviders[i] != IRateProvider(0)) {
                _updateTokenRateCache(i, rateParams.rateProviders[i], rateParams.tokenRateCacheDurations[i]);

                emit TokenRateProviderSet(i, rateParams.rateProviders[i], rateParams.tokenRateCacheDurations[i]);

                // Initialize the old rates as well, in case they are referenced before the first join.
                _updateOldRate(i);
            }
        }
    }

    /**
     * @dev Updates the old rate for the token at `poolTokenIndex` (not including BPT). Assumes index is valid.
     */
    function _updateOldRate(uint256 poolTokenIndex) internal {
        bytes32 cache = _tokenRateCaches[poolTokenIndex];
        _tokenRateCaches[poolTokenIndex] = cache.updateOldRate();
    }

    /**
     * @dev Returns the rate for a given token. All token rates are fixed-point values with 18 decimals.
     * If there is no rate provider for the provided token, or this is called with the pool token, it
     * returns FixedPoint.ONE. It will revert if called with an invalid token.
     */
    function getTokenRate(IERC20 token) external view returns (uint256) {
        if (token == IERC20(this)) {
            return FixedPoint.ONE;
        }

        return _getTokenRate(_getPoolTokenIndex(token));
    }

    function _getTokenRate(uint256 poolTokenIndex) internal view virtual returns (uint256) {
        bytes32 tokenRateCache = _tokenRateCaches[poolTokenIndex];
        return tokenRateCache == bytes32(0) ? FixedPoint.ONE : tokenRateCache.getCurrentRate();
    }

    /**
     * @dev Returns the cached value for token's rate. Reverts if the token doesn't belong to the pool or has no rate
     * provider.
     */
    function getTokenRateCache(IERC20 token)
        external
        view
        returns (
            uint256 rate,
            uint256 oldRate,
            uint256 duration,
            uint256 expires
        )
    {
        bytes32 cache;

        if (token != IERC20(this)) {
            cache = _tokenRateCaches[_getPoolTokenIndex(token)];
        }

        // A zero cache indicates that the token doesn't have a rate provider associated with it.
        _require(cache != bytes32(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);

        rate = cache.getCurrentRate();
        oldRate = cache.getOldRate();
        (duration, expires) = cache.getTimestamps();
    }

    /**
     * @dev Sets a new duration for a token rate cache. It reverts if there was no rate provider set initially.
     * Note this function also updates the current cached value.
     * @param duration Number of seconds until the current token rate is fetched again.
     */
    function setTokenRateCacheDuration(IERC20 token, uint256 duration) external authenticate {
        (uint256 poolTokenIndex, IRateProvider provider) = _getTokenIndexAndRateProvider(token);

        _updateTokenRateCache(poolTokenIndex, provider, duration);
        emit TokenRateProviderSet(poolTokenIndex, provider, duration);
    }

    /**
     * @dev Forces a rate cache hit for a token.
     * It will revert if the requested token does not have an associated rate provider.
     */
    function updateTokenRateCache(IERC20 token) external {
        (uint256 poolTokenIndex, IRateProvider provider) = _getTokenIndexAndRateProvider(token);

        uint256 duration = _tokenRateCaches[poolTokenIndex].getDuration();
        _updateTokenRateCache(poolTokenIndex, provider, duration);
    }

    function _getTokenIndexAndRateProvider(IERC20 token) private view returns (uint256, IRateProvider) {
        uint256 poolTokenIndex;
        IRateProvider provider;

        if (token != IERC20(this)) {
            poolTokenIndex = _getPoolTokenIndex(token);
            provider = _getRateProvider(poolTokenIndex);
        }
        _require(address(provider) != address(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);

        return (poolTokenIndex, provider);
    }
    /**
     * @dev Internal function to update a token rate cache for a known provider and duration.
     * It trusts the given values, and does not perform any checks.
     */
    function _updateTokenRateCache(
        uint256 poolTokenIndex,
        IRateProvider provider,
        uint256 duration
    ) internal virtual {
        uint256 rate = provider.getRate();
        bytes32 cache = _tokenRateCaches[poolTokenIndex];

        _tokenRateCaches[poolTokenIndex] = cache.updateRateAndDuration(rate, duration);

        emit TokenRateCacheUpdated(poolTokenIndex, rate);
    }

    /**
     * @dev Caches the rates of all pool tokens, if necessary.
     */
    function _cacheTokenRatesIfNecessary() internal {
        uint256 totaPoollTokens = _getTotalPoolTokens();
        for (uint256 i = 0; i < totaPoollTokens; ++i) {
            _cacheTokenRateIfNecessary(i);
        }
    }

    /**
     * @dev Caches the rate for a token if necessary. It ignores the call if there is no provider set.
     */
    function _cacheTokenRateIfNecessary(uint256 poolTokenIndex) internal {
        bytes32 cache = _tokenRateCaches[poolTokenIndex];
        if (cache != bytes32(0)) {
            (uint256 duration, uint256 expires) = cache.getTimestamps();
            if (block.timestamp > expires) {
                // solhint-disable-previous-line not-rely-on-time
                _updateTokenRateCache(poolTokenIndex, _getRateProvider(poolTokenIndex), duration);
            }
        }
    }

    // To compute the yield protocol fees, we need the oldRate for all tokens, even if the exempt flag is not set.
    // We do need to ensure the token has a rate provider before updating; otherwise it will not be in the cache.
    function _updateOldRates() internal {
        uint256 totalPoolTokens = _getTotalPoolTokens();
        for (uint256 i = 0; i < totalPoolTokens; ++i) {
            if (_hasRateProvider(i)) _updateOldRate(i);
        }
    }

    /**
     * @dev Apply the token ratios to a set of balances, optionally adjusting for exempt yield tokens.
     * The `balances` array is assumed to not include BPT to ensure that token indices align.
     */
    function _getAdjustedBalances(uint256[] memory balances, bool ignoreExemptFlags)
        internal
        view
        returns (uint256[] memory)
    {
        uint256 totalPoolTokens = balances.length;
        uint256[] memory adjustedBalances = new uint256[](totalPoolTokens);

        for (uint256 i = 0; i < totalPoolTokens; ++i) {
            adjustedBalances[i] = _isTokenExemptFromYieldProtocolFee(i) || (ignoreExemptFlags && _hasRateProvider(i))
                ? _adjustedBalance(balances[i], _tokenRateCaches[i])
                : balances[i];
        }

        return adjustedBalances;
    }

    // Compute balance * oldRate/currentRate, doing division last to minimize rounding error.
    function _adjustedBalance(uint256 balance, bytes32 cache) private pure returns (uint256) {
        return Math.divDown(Math.mul(balance, cache.getOldRate()), cache.getCurrentRate());
    }

    // Scaling Factors

    /**
     * @dev Overrides scaling factor getter to compute the tokens' rates. This is the rare exception where we
     * need to include the BPT token.
     */
    function getScalingFactors() public view virtual override returns (uint256[] memory) {
        uint256 totalPoolTokens = _getTotalPoolTokens();
        uint256[] memory scalingFactors = new uint256[](totalPoolTokens + 1);
        // Set the BPT scaling factor to ONE.
        scalingFactors[PoolRegistrationLib.COMPOSABLE_BPT_INDEX] = FixedPoint.ONE;

        // Set the scaling factors of the pool tokens.
        for (uint256 i = 0; i < totalPoolTokens; ++i) {
            scalingFactors[i + 1] = _getScalingFactor(i).mulDown(_getTokenRate(i));
        }

        return scalingFactors;
    }

    /**
     * @dev Overrides only owner action to allow setting the cache duration for the token rates
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view virtual override returns (bool) {
        return (actionId == getActionId(this.setTokenRateCacheDuration.selector)) || super._isOwnerOnlyAction(actionId);
    }
}
