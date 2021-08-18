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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "@balancer-labs/v2-pool-utils/contracts/interfaces/IRateProvider.sol";
import "@balancer-labs/v2-pool-utils/contracts/BaseMinimalSwapInfoPool.sol";

import "./LinearMath.sol";

/**
 * @dev LinearPool suitable for assets with an equal underlying token with an exact and non-manipulable exchange rate.
 * Requires an external feed of these exchange rates.
 */
contract LinearPool is BaseMinimalSwapInfoPool, LinearMath, IRateProvider {
    uint256 private constant _TOTAL_TOKENS = 3; //Main token, wrapped token, BPT

    IVault private immutable _vault;

    IERC20 internal immutable _mainToken;
    IERC20 internal immutable _wrappedToken;

    IRateProvider private immutable _rateProvider;
    bytes32 private _priceRateCache;

    uint256 private constant _PRICE_RATE_CACHE_VALUE_OFFSET = 0;
    uint256 private constant _PRICE_RATE_CACHE_DURATION_OFFSET = 128;
    uint256 private constant _PRICE_RATE_CACHE_EXPIRES_OFFSET = 128 + 64;

    event PriceRateProviderSet(IERC20 indexed token, IRateProvider indexed provider, uint256 cacheDuration);
    event PriceRateCacheUpdated(IERC20 indexed token, uint256 rate);

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens, //Index 0 main token and index 1 wrapped token
        IRateProvider rateProvider,
        uint256 priceRateCacheDuration,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        BasePool(
            vault,
            IVault.PoolSpecialization.MINIMAL_SWAP_INFO,
            name,
            symbol,
            tokens,
            new address[](tokens.length),
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        _require(tokens.length == _TOTAL_TOKENS - 1, Errors.NOT_TWO_TOKENS);

        _mainToken = tokens[0];
        _wrappedToken = tokens[1];

        _vault = vault;

        // Set provider and initialise cache. We can't use `_setToken0PriceRateCache` as it relies on immutable
        // variables, which cannot be read from during construction.

        _require(rateProvider != IRateProvider(address(0)), Errors.ZERO_RATE_PROVIDER);
        _rateProvider = rateProvider;
        // (bytes32 cache, uint256 rate) = _getNewPriceRateCache(rateProvider, priceRateCacheDuration);
        // _priceRateCache = cache;
        // emit PriceRateCacheUpdated(tokens[1], rate);
        // emit PriceRateProviderSet(tokens[1], rateProvider, priceRateCacheDuration);
    }

    function onSwap(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) public override returns (uint256) {
        return 0;
    }

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal override returns (uint256) {
        return 0;
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal override returns (uint256) {
        return 0;
    }

    function _onJoinPool(
        bytes32,
        address,
        address,
        uint256[] memory balances,
        uint256,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    )
        internal
        virtual
        override
        whenNotPaused
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        revert();
    }

    function _onExitPool(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        uint256[] memory,
        bytes memory
    )
        internal
        virtual
        override
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        revert();
    }

    function _onInitializePool(
        bytes32,
        address,
        address,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal virtual override whenNotPaused returns (uint256, uint256[] memory) {
        revert();
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        return 0;
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory scalingFactors) {
        uint256[] memory scalingFactors = new uint256[](_TOTAL_TOKENS);
        //scalingFactors[0] = _getScalingFactor0();
        //scalingFactors[1] = _getScalingFactor1();
        return scalingFactors;
    }

    function getRate() public view override returns (uint256) {
        return 0;
    }

    // /*

    // /**
    //  * @dev Returns the rate providers configured for each token (in the same order as registered).
    //  */
    // function getRateProviders() external view returns (IRateProvider[] memory providers) {
    //     providers = new IRateProvider[](2);
    //     providers[0] = _getRateProvider0();
    //     providers[1] = _getRateProvider1();
    // }

    // /**
    //  * @dev Returns the cached value for token's rate
    //  */
    // function getPriceRateCache(IERC20 token)
    //     external
    //     view
    //     returns (
    //         uint256 rate,
    //         uint256 duration,
    //         uint256 expires
    //     )
    // {
    //     if (_isToken0(token)) return _getPriceRateCache(_getPriceRateCache0());
    //     if (_isToken1(token)) return _getPriceRateCache(_getPriceRateCache1());
    //     _revert(Errors.INVALID_TOKEN);
    // }

    // /**
    //  * @dev Sets a new duration for a token price rate cache. It reverts if there was no rate provider set initially.
    //  * Note this function also updates the current cached value.
    //  * @param duration Number of seconds until the current rate of token price is fetched again.
    //  */
    // function setPriceRateCacheDuration(IERC20 token, uint256 duration) external authenticate {
    //     if (_isToken0WithRateProvider(token)) {
    //         _updateToken0PriceRateCache(duration);
    //         emit PriceRateProviderSet(token, _getRateProvider0(), duration);
    //     } else if (_isToken1WithRateProvider(token)) {
    //         _updateToken1PriceRateCache(duration);
    //         emit PriceRateProviderSet(token, _getRateProvider1(), duration);
    //     } else {
    //         _revert(Errors.INVALID_TOKEN);
    //     }
    // }

    // function updatePriceRateCache(IERC20 token) external {
    //     if (_isToken0WithRateProvider(token)) {
    //         _updateToken0PriceRateCache();
    //     } else if (_isToken1WithRateProvider(token)) {
    //         _updateToken1PriceRateCache();
    //     } else {
    //         _revert(Errors.INVALID_TOKEN);
    //     }
    // }

    // /**
    //  * @dev Returns the price rate for token. All price rates are fixed-point values with 18 decimals.
    //  * In case there is no rate provider for the provided token it returns 1e18.
    //  */
    // function _priceRate(IERC20 token) internal view virtual returns (uint256) {
    //     // Given that this function is only used by `onSwap` which can only be called by the vault in the case of a
    //     // Meta Stable Pool, we can be sure the vault will not forward a call with an invalid `token` param.
    //     if (_isToken0WithRateProvider(token)) {
    //         return _getPriceRateCacheValue(_getPriceRateCache0());
    //     } else if (_isToken1WithRateProvider(token)) {
    //         return _getPriceRateCacheValue(_getPriceRateCache1());
    //     } else {
    //         return FixedPoint.ONE;
    //     }
    // }

    // function _cachePriceRatesIfNecessary() internal {
    //     _cachePriceRate0IfNecessary();
    //     _cachePriceRate1IfNecessary();
    // }

    // function _cachePriceRate0IfNecessary() private {
    //     if (_getRateProvider0() != IRateProvider(address(0))) {
    //         (uint256 duration, uint256 expires) = _getPriceRateCacheTimestamps(_getPriceRateCache0());
    //         if (block.timestamp > expires) {
    //             _updateToken0PriceRateCache(duration);
    //         }
    //     }
    // }

    // function _cachePriceRate1IfNecessary() private {
    //     if (_getRateProvider1() != IRateProvider(address(0))) {
    //         (uint256 duration, uint256 expires) = _getPriceRateCacheTimestamps(_getPriceRateCache1());
    //         if (block.timestamp > expires) {
    //             _updateToken1PriceRateCache(duration);
    //         }
    //     }
    // }

    // /**
    //  * @dev Decodes a price rate cache into rate value, duration and expiration time
    //  */
    // function _getPriceRateCache(bytes32 cache)
    //     private
    //     pure
    //     returns (
    //         uint256 rate,
    //         uint256 duration,
    //         uint256 expires
    //     )
    // {
    //     rate = _getPriceRateCacheValue(cache);
    //     (duration, expires) = _getPriceRateCacheTimestamps(cache);
    // }

    // /**
    //  * @dev Decodes the rate value for a price rate cache
    //  */
    // function _getPriceRateCacheValue(bytes32 cache) private pure returns (uint256) {
    //     return cache.decodeUint128(_PRICE_RATE_CACHE_VALUE_OFFSET);
    // }

    // /**
    //  * @dev Decodes the duration for a price rate cache
    //  */
    // function _getPriceRateCacheDuration(bytes32 cache) private pure returns (uint256) {
    //     return cache.decodeUint64(_PRICE_RATE_CACHE_DURATION_OFFSET);
    // }

    // /**
    //  * @dev Decodes the duration and expiration timestamp for a price rate cache
    //  */
    // function _getPriceRateCacheTimestamps(bytes32 cache) private pure returns (uint256 duration, uint256 expires) {
    //     duration = _getPriceRateCacheDuration(cache);
    //     expires = cache.decodeUint64(_PRICE_RATE_CACHE_EXPIRES_OFFSET);
    // }

    // function _updateToken0PriceRateCache() private {
    //     _updateToken0PriceRateCache(_getPriceRateCacheDuration(_getPriceRateCache0()));
    // }

    // function _updateToken0PriceRateCache(uint256 duration) private {
    //     (bytes32 cache, uint256 rate) = _getNewPriceRateCache(_getRateProvider0(), duration);
    //     _setToken0PriceRateCache(cache, rate);
    // }

    // function _updateToken1PriceRateCache() private {
    //     _updateToken1PriceRateCache(_getPriceRateCacheDuration(_getPriceRateCache1()));
    // }

    // function _updateToken1PriceRateCache(uint256 duration) private {
    //     (bytes32 cache, uint256 rate) = _getNewPriceRateCache(_getRateProvider1(), duration);
    //     _setToken1PriceRateCache(cache, rate);
    // }

    // function _setToken0PriceRateCache(bytes32 cache, uint256 rate) private {
    //     _priceRateCache0 = cache;
    //     emit PriceRateCacheUpdated(_token0, rate);
    // }

    // function _setToken1PriceRateCache(bytes32 cache, uint256 rate) private {
    //     _priceRateCache1 = cache;
    //     emit PriceRateCacheUpdated(_token1, rate);
    // }

    // /**
    //  * @dev Fetches the current price rate from a provider and builds a new price rate cache
    //  */
    // function _getNewPriceRateCache(IRateProvider provider, uint256 duration)
    //     private
    //     view
    //     returns (bytes32 cache, uint256 rate)
    // {
    //     rate = provider.getRate();
    //     _require(rate < 2**128, Errors.PRICE_RATE_OVERFLOW);

    //     cache =
    //         WordCodec.encodeUint(uint128(rate), _PRICE_RATE_CACHE_VALUE_OFFSET) |
    //         WordCodec.encodeUint(uint64(duration), _PRICE_RATE_CACHE_DURATION_OFFSET) |
    //         WordCodec.encodeUint(uint64(block.timestamp + duration), _PRICE_RATE_CACHE_EXPIRES_OFFSET);
    // }

    // function _isToken0WithRateProvider(IERC20 token) internal view returns (bool) {
    //     return _isToken0(token) && _getRateProvider0() != IRateProvider(address(0));
    // }

    // function _isToken1WithRateProvider(IERC20 token) internal view returns (bool) {
    //     return _isToken1(token) && _getRateProvider1() != IRateProvider(address(0));
    // }

    // function _getRateProvider0() internal view returns (IRateProvider) {
    //     return _rateProvider0;
    // }

    // function _getRateProvider1() internal view returns (IRateProvider) {
    //     return _rateProvider1;
    // }

    // function _getPriceRateCache0() internal view returns (bytes32) {
    //     return _priceRateCache0;
    // }

    // function _getPriceRateCache1() internal view returns (bytes32) {
    //     return _priceRateCache1;
    // }
}
