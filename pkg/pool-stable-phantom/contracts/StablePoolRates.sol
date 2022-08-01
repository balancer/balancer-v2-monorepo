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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProvider.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-pool-utils/contracts/rates/PriceRateCache.sol";

import "./StablePoolStorage.sol";

abstract contract StablePoolRates is StablePoolStorage {
    using PriceRateCache for bytes32;

    struct RatesParams {
        IERC20[] tokens;
        IRateProvider[] rateProviders;
        uint256[] tokenRateCacheDurations;
    }

    // This contract uses timestamps to slowly update its Amplification parameter over time. These changes must occur
    // over a minimum time period much larger than the blocktime, making timestamp manipulation a non-issue.
    // solhint-disable not-rely-on-time

    // Token rate caches are used to avoid querying the price rate for a token every time we need to work with it.
    // The "old rate" field is used for precise protocol fee calculation, to ensure that token yield is only
    // "taxed" once. The data structure is as follows:
    //
    // [ expires | duration | old rate | current rate ]
    // [ uint32  |  uint32  |  uint96  |   uint96     ]

    mapping(IERC20 => bytes32) internal _tokenRateCaches;

    event TokenRateCacheUpdated(IERC20 indexed token, uint256 rate);
    event TokenRateProviderSet(IERC20 indexed token, IRateProvider indexed provider, uint256 cacheDuration);

    constructor(StablePoolStorage.StorageParams memory storageParams, RatesParams memory rateParams)
        StablePoolStorage(storageParams)
    {
        InputHelpers.ensureInputLengthMatch(
            rateParams.tokens.length,
            rateParams.rateProviders.length,
            rateParams.tokenRateCacheDurations.length
        );

        for (uint256 i = 0; i < rateParams.tokens.length; i++) {
            if (rateParams.rateProviders[i] != IRateProvider(0)) {
                _updateTokenRateCache(
                    rateParams.tokens[i],
                    rateParams.rateProviders[i],
                    rateParams.tokenRateCacheDurations[i]
                );

                emit TokenRateProviderSet(
                    rateParams.tokens[i],
                    rateParams.rateProviders[i],
                    rateParams.tokenRateCacheDurations[i]
                );

                // Initialize the old rates as well, in case they are referenced before the first join.
                _updateOldRate(rateParams.tokens[i]);
            }
        }
    }

    // This assumes the token has been validated elsewhere, and is a valid non-BPT token.
    function _updateOldRate(IERC20 token) internal {
        bytes32 cache = _tokenRateCaches[token];
        _tokenRateCaches[token] = cache.updateOldRate();
    }

    /**
     * @dev Returns the rate for a given token. All token rates are fixed-point values with 18 decimals.
     * If there is no rate provider for the provided token, it returns FixedPoint.ONE.
     */
    function getTokenRate(IERC20 token) public view virtual returns (uint256) {
        // We optimize for the scenario where all tokens have rate providers, except the BPT (which never has a rate
        // provider). Therefore, we return early if `token` is the BPT, and otherwise optimistically read the cache
        // expecting that it will not be empty (instead of e.g. fetching the provider to avoid a cache read, since
        // we don't need the provider at all).

        if (token == this) {
            return FixedPoint.ONE;
        }

        bytes32 tokenRateCache = _tokenRateCaches[token];
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
            uint256 duration,
            uint256 expires
        )
    {
        _require(_getRateProvider(token) != IRateProvider(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);

        rate = _tokenRateCaches[token].getCurrentRate();
        (duration, expires) = _tokenRateCaches[token].getTimestamps();
    }

    /**
     * @dev Sets a new duration for a token rate cache. It reverts if there was no rate provider set initially.
     * Note this function also updates the current cached value.
     * @param duration Number of seconds until the current token rate is fetched again.
     */
    function setTokenRateCacheDuration(IERC20 token, uint256 duration) external authenticate {
        IRateProvider provider = _getRateProvider(token);
        _require(address(provider) != address(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);
        _updateTokenRateCache(token, provider, duration);
        emit TokenRateProviderSet(token, provider, duration);
    }

    /**
     * @dev Forces a rate cache hit for a token.
     * It will revert if the requested token does not have an associated rate provider.
     */
    function updateTokenRateCache(IERC20 token) public virtual {
        IRateProvider provider = _getRateProvider(token);
        _require(address(provider) != address(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);
        uint256 duration = _tokenRateCaches[token].getDuration();
        _updateTokenRateCache(token, provider, duration);
    }

    /**
     * @dev Internal function to update a token rate cache for a known provider and duration.
     * It trusts the given values, and does not perform any checks.
     */
    function _updateTokenRateCache(
        IERC20 token,
        IRateProvider provider,
        uint256 duration
    ) internal {
        uint256 rate = provider.getRate();
        bytes32 cache = _tokenRateCaches[token];

        _tokenRateCaches[token] = cache.updateRateAndDuration(rate, duration);

        emit TokenRateCacheUpdated(token, rate);
    }

    /**
     * @dev Caches the rates of all tokens if necessary
     */
    function _cacheTokenRatesIfNecessary() internal {
        uint256 totalTokens = _getTotalTokens();

        // The Pool will always have at least 3 tokens so we always try to update these three caches.
        _cacheTokenRateIfNecessary(_getToken0());
        _cacheTokenRateIfNecessary(_getToken1());
        _cacheTokenRateIfNecessary(_getToken2());

        // Before we update the remaining caches we must check that the Pool contains enough tokens.
        if (totalTokens == 3) return;
        _cacheTokenRateIfNecessary(_getToken3());

        if (totalTokens == 4) return;
        _cacheTokenRateIfNecessary(_getToken4());

        if (totalTokens == 5) return;
        _cacheTokenRateIfNecessary(_getToken5());
    }

    /**
     * @dev Caches the rate for a token if necessary. It ignores the call if there is no provider set.
     */
    function _cacheTokenRateIfNecessary(IERC20 token) internal virtual {
        // We optimize for the scenario where all tokens have rate providers, except the BPT (which never has a rate
        // provider). Therefore, we return early if token is BPT, and otherwise optimistically read the cache expecting
        // that it will not be empty (instead of e.g. fetching the provider to avoid a cache read in situations where
        // we might not need the provider if the cache is still valid).

        if (token == this) return;

        bytes32 cache = _tokenRateCaches[token];
        if (cache != bytes32(0)) {
            (uint256 duration, uint256 expires) = _tokenRateCaches[token].getTimestamps();
            if (block.timestamp > expires) {
                // solhint-disable-previous-line not-rely-on-time
                _updateTokenRateCache(token, _getRateProvider(token), duration);
            }
        }
    }
}
