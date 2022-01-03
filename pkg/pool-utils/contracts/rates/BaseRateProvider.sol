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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "./PriceRateCache.sol";
import "../interfaces/IRateProvider.sol";

/**
 * @title BaseRateProvider
 * @notice Factor out RateProvider functionality, to make it available in all Stable-like pools.
 * @dev Stores packed data for each token - the duration and expiration of the cache, and the cached rate itself.
 * Also store the token set, to allow quickly validating tokens without iteration.
 */
abstract contract BaseRateProvider is IRateProvider {
    using EnumerableSet for EnumerableSet.AddressSet;
    using WordCodec for bytes32;

    // Price rate caches are used to avoid querying the price rate for a token every time we need to work with it.
    // Data is stored with the following structure:
    //
    // [   expires   | duration | price rate value ]
    // [   uint64    |  uint64  |      uint128     ]

    mapping(IERC20 => bytes32) private _priceRateCaches;

    uint256 private constant _PRICE_RATE_CACHE_VALUE_OFFSET = 0;
    uint256 private constant _PRICE_RATE_CACHE_DURATION_OFFSET = 128;
    uint256 private constant _PRICE_RATE_CACHE_EXPIRES_OFFSET = 128 + 64;

    EnumerableSet.AddressSet private _validTokens;

    event TokenRateProviderSet(IERC20 indexed token, IRateProvider indexed provider, uint256 cacheDuration);
    event PriceRateCacheUpdated(IERC20 indexed token, uint256 rate);

    constructor(
        IERC20[] memory tokens,
        IRateProvider[] memory rateProviders,
        uint256[] memory priceRateCacheDurations
    ) {
        uint256 totalTokens = tokens.length;

        InputHelpers.ensureInputLengthMatch(totalTokens, rateProviders.length, priceRateCacheDurations.length);

        for (uint256 i = 0; i < totalTokens; i++) {
            _validTokens.add(address(tokens[i]));

            if (rateProviders[i] != IRateProvider(0)) {
                _updatePriceRateCache(tokens[i], rateProviders[i], priceRateCacheDurations[i]);
                // Note that the rateProvider storage is deferred, so the rate provider itself cannot
                // be stored until the most derived constructor.
                emit TokenRateProviderSet(tokens[i], rateProviders[i], priceRateCacheDurations[i]);
            }
        }
    }

    /**
     * @dev Getter for RateProviders. Virtual, since storage is deferred to derived contracts.
     */
    function getRateProviders() external view virtual returns (IRateProvider[] memory);

    /**
     * @dev Returns the cached value for a token's rate
     */
    function getPriceRateCache(IERC20 token)
        external
        view
        virtual
        returns (
            uint256 rate,
            uint256 duration,
            uint256 expires
        )
    {
        return _getPriceRateCache(_getPriceRateCache(token));
    }

    /**
     * @dev Get the cached duration for the given token, and update the price rate cache.
     */
    function updatePriceRateCache(IERC20 token) external {
        // _indexOf will revert with INVALID_TOKEN unless the token is in the pool
        _require(_getRateProvider(_indexOf(token)) != IRateProvider(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);

        uint256 duration = _getPriceRateCacheDuration(_getPriceRateCache(token));

        _updatePriceRateCache(token, duration);
    }

    /**
     * @dev Force update of the caches (if any are out-of-date). Used for testing, but might be generally useful.
     */
    function cachePriceRatesIfNecessary() external {
        _cachePriceRatesIfNecessary();
    }

    /**
     * @dev Return the cached rate value (or 1 if there is no provider for the token).
     */
    function getTokenRate(IERC20 token) public view virtual returns (uint256) {
        // Given that this function is only used by `onSwap` which can only be called by the vault in the case of a
        // Meta Stable Pool, we can be sure the vault will not forward a call with an invalid `token` param.

        bytes32 cache = _getPriceRateCache(token);

        return cache == bytes32(0) ? FixedPoint.ONE : _getPriceRateCacheValue(cache);
    }

    // Storage deferred to derived contracts
    function _getRateProvider(uint256 index) internal view virtual returns (IRateProvider);

    function _cachePriceRatesIfNecessary() internal {
        IRateProvider provider;

        for (uint256 i = 0; i < _validTokens.length(); i++) {
            provider = _getRateProvider(i);
            if (provider != IRateProvider(0)) {
                IERC20 token = IERC20(_validTokens.unchecked_at(i));

                _cachePriceRateIfNecessaryInternal(token, provider);
            }
        }
    }

    function _cachePriceRateIfNecessary(IERC20 token) internal {
        IRateProvider provider = _getRateProvider(_indexOf(token));

        if (provider != IRateProvider(0)) {
            _cachePriceRateIfNecessaryInternal(token, provider);
        }
    }

    /**
     * @dev Internal function to update a token rate cache for a known provider and duration.
     * It trusts the given values, and does not perform any checks.
     */
    function _updatePriceRateCache(
        IERC20 token,
        IRateProvider provider,
        uint256 duration
    ) internal {
        uint256 rate = provider.getRate();
        bytes32 cache = PriceRateCache.encode(rate, duration);
        _priceRateCaches[token] = cache;

        emit TokenRateProviderSet(token, provider, duration);
        emit PriceRateCacheUpdated(token, rate);
    }

    function _updatePriceRateCache(IERC20 token, uint256 duration) internal {
        IRateProvider provider = _getRateProvider(_validTokens.rawIndexOf(address(token)));
        if (provider == IRateProvider(0)) {
            _revert(Errors.INVALID_TOKEN);
        }

        _updatePriceRateCache(token, provider, duration);
    }

    /**
     * @dev Decodes a price rate cache into rate value, duration and expiration time
     */
    function _getPriceRateCache(bytes32 cache)
        internal
        pure
        returns (
            uint256 rate,
            uint256 duration,
            uint256 expires
        )
    {
        rate = _getPriceRateCacheValue(cache);
        (duration, expires) = _getPriceRateCacheTimestamps(cache);
    }

    function _getPriceRateCache(IERC20 token) internal view returns (bytes32) {
        if (_isValidToken(token)) {
            return _priceRateCaches[token];
        }

        _revert(Errors.INVALID_TOKEN);
    }

    /**
     * @dev Decodes the duration and expiration timestamp for a price rate cache
     */
    function _getPriceRateCacheTimestamps(bytes32 cache) internal pure returns (uint256 duration, uint256 expires) {
        duration = _getPriceRateCacheDuration(cache);
        expires = cache.decodeUint64(_PRICE_RATE_CACHE_EXPIRES_OFFSET);
    }

    function _isValidToken(IERC20 token) internal view virtual returns (bool) {
        return _validTokens.contains(address(token));
    }

    function _indexOf(IERC20 token) internal view returns (uint256) {
        if (_isValidToken(token)) {
            return _validTokens.rawIndexOf(address(token));
        }

        _revert(Errors.INVALID_TOKEN);
    }

    function _cachePriceRateIfNecessaryInternal(IERC20 token, IRateProvider provider) private {
        (uint256 duration, uint256 expires) = _getPriceRateCacheTimestamps(_getPriceRateCache(token));
        // solhint-disable-next-line not-rely-on-time
        if (block.timestamp > expires) {
            _updatePriceRateCache(token, provider, duration);
        }
    }

    /**
     * @dev Decodes the rate value for a price rate cache
     */
    function _getPriceRateCacheValue(bytes32 cache) private pure returns (uint256) {
        return cache.decodeUint128(_PRICE_RATE_CACHE_VALUE_OFFSET);
    }

    /**
     * @dev Decodes the duration for a price rate cache
     */
    function _getPriceRateCacheDuration(bytes32 cache) private pure returns (uint256) {
        return cache.decodeUint64(_PRICE_RATE_CACHE_DURATION_OFFSET);
    }
}
