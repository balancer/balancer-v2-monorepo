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

import "@balancer-labs/v2-pool-stable/contracts/StablePool.sol";
import "@balancer-labs/v2-pool-utils/contracts/rates/PriceRateCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/interfaces/IRateProvider.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";

contract StablePhantomPool is StablePool {
    using FixedPoint for uint256;
    using PriceRateCache for bytes32;
    using StablePoolUserDataHelpers for bytes;

    uint256 private constant _MIN_TOKENS = 2;
    uint256 private constant _MAX_TOKEN_BALANCE = 2**(112) - 1;

    uint256 private immutable _bptIndex;

    // Price rate caches are used to avoid querying the price rate for a token every time we need to work with it.
    // Data is stored with the following structure:
    //
    // [   expires   | duration | price rate value ]
    // [   uint64    |  uint64  |      uint128     ]

    mapping(IERC20 => bytes32) private _priceRateCaches;
    mapping(IERC20 => IRateProvider) private _rateProviders;

    uint256 private constant _PRICE_RATE_CACHE_VALUE_OFFSET = 0;
    uint256 private constant _PRICE_RATE_CACHE_DURATION_OFFSET = 128;
    uint256 private constant _PRICE_RATE_CACHE_EXPIRES_OFFSET = 128 + 64;

    event PriceRateCacheUpdated(IERC20 indexed token, uint256 rate);
    event PriceRateProviderSet(IERC20 indexed token, IRateProvider indexed provider, uint256 cacheDuration);

    // The constructor arguments are received in a struct to work around stack-too-deep issues
    struct NewPoolParams {
        IVault vault;
        string name;
        string symbol;
        IERC20[] tokens;
        IRateProvider[] rateProviders;
        uint256[] priceRateCacheDurations;
        uint256 amplificationParameter;
        uint256 swapFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        address owner;
    }

    constructor(NewPoolParams memory params)
        StablePool(
            params.vault,
            params.name,
            params.symbol,
            _insertSorted(params.tokens, IERC20(this)),
            params.amplificationParameter,
            params.swapFeePercentage,
            params.pauseWindowDuration,
            params.bufferPeriodDuration,
            params.owner
        )
    {
        _require(params.tokens.length >= _MIN_TOKENS, Errors.MIN_TOKENS);

        InputHelpers.ensureInputLengthMatch(
            params.tokens.length,
            params.rateProviders.length,
            params.priceRateCacheDurations.length
        );

        for (uint256 i = 0; i < params.tokens.length; i++) {
            _rateProviders[params.tokens[i]] = params.rateProviders[i];
            _updatePriceRateCache(params.tokens[i], params.rateProviders[i], params.priceRateCacheDurations[i]);
            emit PriceRateProviderSet(params.tokens[i], params.rateProviders[i], params.priceRateCacheDurations[i]);
        }

        uint256 bptIndex;
        for (bptIndex = params.tokens.length; bptIndex > 0 && params.tokens[bptIndex - 1] > IERC20(this); bptIndex--) {
            // solhint-disable-previous-line no-empty-blocks
        }
        _bptIndex = bptIndex;
    }

    function getBptIndex() external view returns (uint256) {
        return _bptIndex;
    }

    function getMinimumBpt() external pure returns (uint256) {
        return _getMinimumBpt();
    }

    /**
     * @dev Overrides to disallow minimal info swaps, although it should never trigger it due to min number of
     * tokens requested by the pool
     */
    function onSwap(
        SwapRequest memory,
        uint256,
        uint256
    ) public pure override returns (uint256) {
        _revert(Errors.UNHANDLED_BY_PHANTOM_POOL);
    }

    /**
     * Overrides to make sure sender is vault and cache price rates if necessary
     */
    function onSwap(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) public virtual override onlyVault(request.poolId) returns (uint256) {
        _cachePriceRatesIfNecessary();
        return super.onSwap(request, balances, indexIn, indexOut);
    }

    /**
     * @dev Overrides to allow join/exit
     */
    function _onSwapGivenIn(
        SwapRequest memory request,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override returns (uint256) {
        uint256[] memory balances = _dropBptItem(balancesIncludingBpt); // Avoid BPT balance for stable pool math
        if (request.tokenIn == IERC20(this)) {
            return _onSwapTokenGivenBptIn(request.amount, _skipBptIndex(indexOut), balances);
        } else if (request.tokenOut == IERC20(this)) {
            return _onSwapBptGivenTokenIn(request.amount, _skipBptIndex(indexIn), balances);
        } else {
            return super._onSwapGivenIn(request, balances, _skipBptIndex(indexIn), _skipBptIndex(indexOut));
        }
    }

    /**
     * @dev Overrides to allow join/exit
     */
    function _onSwapGivenOut(
        SwapRequest memory request,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override returns (uint256) {
        uint256[] memory balances = _dropBptItem(balancesIncludingBpt); // Avoid BPT balance for stable pool math
        if (request.tokenIn == IERC20(this)) {
            return _onSwapBptGivenTokenOut(request.amount, _skipBptIndex(indexOut), balances);
        } else if (request.tokenOut == IERC20(this)) {
            return _onSwapTokenGivenBptOut(request.amount, _skipBptIndex(indexIn), balances);
        } else {
            return super._onSwapGivenOut(request, balances, _skipBptIndex(indexIn), _skipBptIndex(indexOut));
        }
    }

    /**
     * @dev Calculate token out for exact BPT in (exit)
     */
    function _onSwapTokenGivenBptIn(
        uint256 bptIn,
        uint256 tokenIndex,
        uint256[] memory balances
    ) internal view returns (uint256) {
        // TODO: calc due protocol fees
        uint256 swapFee = getSwapFeePercentage();
        (uint256 currentAmp, ) = _getAmplificationParameter();
        return _calcTokenOutGivenExactBptIn(currentAmp, balances, tokenIndex, bptIn, totalSupply(), swapFee);
    }

    /**
     * @dev Calculate token in for exact BPT out (join)
     */
    function _onSwapTokenGivenBptOut(
        uint256 bptOut,
        uint256 tokenIndex,
        uint256[] memory balances
    ) internal view returns (uint256) {
        // TODO: calc due protocol fees
        uint256 swapFee = getSwapFeePercentage();
        (uint256 currentAmp, ) = _getAmplificationParameter();
        return _calcTokenInGivenExactBptOut(currentAmp, balances, tokenIndex, bptOut, totalSupply(), swapFee);
    }

    /**
     * @dev Calculate BPT in for exact token out (exit)
     */
    function _onSwapBptGivenTokenOut(
        uint256 amountOut,
        uint256 tokenIndex,
        uint256[] memory balances
    ) internal view returns (uint256) {
        // TODO: calc due protocol fees
        (uint256 currentAmp, ) = _getAmplificationParameter();
        uint256[] memory amountsOut = new uint256[](_getTotalTokens() - 1); // Avoid BPT balance for stable pool math
        amountsOut[tokenIndex] = amountOut;
        return _calcBptInGivenExactTokensOut(currentAmp, balances, amountsOut, totalSupply(), getSwapFeePercentage());
    }

    /**
     * @dev Calculate BPT out for exact token in (join)
     */
    function _onSwapBptGivenTokenIn(
        uint256 amountIn,
        uint256 tokenIndex,
        uint256[] memory balances
    ) internal view returns (uint256) {
        // TODO: calc due protocol fees
        uint256[] memory amountsIn = new uint256[](_getTotalTokens() - 1); // Avoid BPT balance for stable pool math
        amountsIn[tokenIndex] = amountIn;
        (uint256 currentAmp, ) = _getAmplificationParameter();
        return _calcBptOutGivenExactTokensIn(currentAmp, balances, amountsIn, totalSupply(), getSwapFeePercentage());
    }

    /**
     * @dev Due to how this pool works, all the BPT needs to be minted initially. On one hand, we cannot do that in the
     * constructor because the Vault would call back this contract. On the other hand, this pool also requires to be
     * initialized with a proportional join due to how the Stable math works.
     * Then, the approach followed is to mint the total amount of BPT to the sender initializing the pool so it can
     * be fetched by the Vault as part of the initialization process.
     */
    function _onInitializePool(
        bytes32,
        address sender,
        address,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override whenNotPaused returns (uint256, uint256[] memory) {
        StablePool.JoinKind kind = userData.joinKind();
        _require(kind == StablePool.JoinKind.INIT, Errors.UNINITIALIZED);

        uint256[] memory amountsIn = userData.initialAmountsIn();
        InputHelpers.ensureInputLengthMatch(amountsIn.length, _getTotalTokens());
        _upscaleArray(amountsIn, scalingFactors);

        (uint256 currentAmp, ) = _getAmplificationParameter();
        uint256 invariantAfterJoin = StableMath._calculateInvariant(currentAmp, _dropBptItem(amountsIn), true);

        // Set the initial BPT to the value of the invariant
        uint256 bptAmountOut = invariantAfterJoin;
        _updateLastInvariant(invariantAfterJoin, currentAmp);

        // Mint the total amount of BPT to the sender forcing the Vault to pull it
        uint256 initialBpt = _MAX_TOKEN_BALANCE.sub(bptAmountOut);
        _mintPoolTokens(sender, initialBpt);
        _approve(sender, address(getVault()), initialBpt);
        amountsIn[_bptIndex] = initialBpt;
        return (bptAmountOut, amountsIn);
    }

    /**
     * @dev Overrides to block traditional joins
     */
    function _onJoinPool(
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
        pure
        override
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        _revert(Errors.UNHANDLED_BY_PHANTOM_POOL);
    }

    /**
     * @dev Overrides to block traditional exits
     */
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
        pure
        override
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        _revert(Errors.UNHANDLED_BY_PHANTOM_POOL);
    }

    // Scaling factors

    /**
     * @dev Overrides scaling factor getter to introduce the tokens' price rate.
     */
    function _scalingFactors() internal view virtual override returns (uint256[] memory scalingFactors) {
        // There is no need to check the arrays length since both are based on `_getTotalTokens`
        uint256 totalTokens = _getTotalTokens();
        scalingFactors = super._scalingFactors();

        // Given there is no generic direction for this rounding, it follows the same strategy as the BasePool.
        // prettier-ignore
        {
            if (totalTokens > 0) { scalingFactors[0] = scalingFactors[0].mulDown(getPriceRate(_token0)); }
            if (totalTokens > 1) { scalingFactors[1] = scalingFactors[1].mulDown(getPriceRate(_token1)); }
            if (totalTokens > 2) { scalingFactors[2] = scalingFactors[2].mulDown(getPriceRate(_token2)); }
            if (totalTokens > 3) { scalingFactors[3] = scalingFactors[3].mulDown(getPriceRate(_token3)); }
            if (totalTokens > 4) { scalingFactors[4] = scalingFactors[4].mulDown(getPriceRate(_token4)); }
        }
    }

    /**
     * @dev Overrides scaling factor getter to introduce the token's price rate.
     */
    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        // Given there is no generic direction for this rounding, it follows the same strategy as the BasePool.
        uint256 baseScalingFactor = super._scalingFactor(token);
        return baseScalingFactor.mulDown(getPriceRate(token));
    }

    // Price rates

    /**
     * @dev Returns the rate providers configured for each token (in the same order as registered).
     */
    function getRateProviders() external view returns (IRateProvider[] memory providers) {
        uint256 totalTokens = _getTotalTokens();
        providers = new IRateProvider[](totalTokens);

        // prettier-ignore
        {
            if (totalTokens > 0) { providers[0] = _rateProviders[_token0]; } else { return providers; }
            if (totalTokens > 1) { providers[1] = _rateProviders[_token1]; } else { return providers; }
            if (totalTokens > 2) { providers[2] = _rateProviders[_token2]; } else { return providers; }
            if (totalTokens > 3) { providers[3] = _rateProviders[_token3]; } else { return providers; }
            if (totalTokens > 4) { providers[4] = _rateProviders[_token4]; } else { return providers; }
        }
    }

    /**
     * @dev Returns the price rate for token. All price rates are fixed-point values with 18 decimals.
     * In case there is no rate provider for the provided token it returns 1e18.
     */
    function getPriceRate(IERC20 token) public view virtual returns (uint256) {
        bytes32 priceRateCache = _priceRateCaches[token];
        return priceRateCache == bytes32(0) ? FixedPoint.ONE : priceRateCache.getValue();
    }

    /**
     * @dev Returns the cached value for token's rate.
     * Note it could return an empty value if the requested token does not have one or if the token does not belong
     * to the pool.
     */
    function getPriceRateCache(IERC20 token)
        external
        view
        returns (
            uint256 rate,
            uint256 duration,
            uint256 expires
        )
    {
        rate = _priceRateCaches[token].getValue();
        (duration, expires) = _priceRateCaches[token].getTimestamps();
    }

    /**
     * @dev Sets a new duration for a token price rate cache. It reverts if there was no rate provider set initially.
     * Note this function also updates the current cached value.
     * @param duration Number of seconds until the current rate of token price is fetched again.
     */
    function setPriceRateCacheDuration(IERC20 token, uint256 duration) external authenticate {
        IRateProvider provider = _rateProviders[token];
        _require(address(provider) != address(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);
        _updatePriceRateCache(token, provider, duration);
        emit PriceRateProviderSet(token, provider, duration);
    }

    /**
     * @dev Forces a rate cache hit for a token.
     * It will revert if the requested token does not have a rate provider associated.
     */
    function updatePriceRateCache(IERC20 token) external {
        IRateProvider provider = _rateProviders[token];
        _require(address(provider) != address(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);
        uint256 duration = _priceRateCaches[token].getDuration();
        _updatePriceRateCache(token, provider, duration);
    }

    /**
     * @dev Internal function to updates a token rate cache for a known provider and duration.
     * It trusts the given values, it does not perform any checks.
     */
    function _updatePriceRateCache(
        IERC20 token,
        IRateProvider provider,
        uint256 duration
    ) private {
        uint256 rate = provider.getRate();
        bytes32 cache = PriceRateCache.encode(rate, duration);
        _priceRateCaches[token] = cache;
        emit PriceRateCacheUpdated(token, rate);
    }

    /**
     * @dev Caches the rates of all tokens if necessary
     */
    function _cachePriceRatesIfNecessary() internal {
        uint256 totalTokens = _getTotalTokens();
        // prettier-ignore
        {
            if (totalTokens > 0) { _cachePriceRateIfNecessary(_token0); } else { return; }
            if (totalTokens > 1) { _cachePriceRateIfNecessary(_token1); } else { return; }
            if (totalTokens > 2) { _cachePriceRateIfNecessary(_token2); } else { return; }
            if (totalTokens > 3) { _cachePriceRateIfNecessary(_token3); } else { return; }
            if (totalTokens > 4) { _cachePriceRateIfNecessary(_token4); } else { return; }
        }
    }

    /**
     * @dev Caches the rate for a token if necessary. It ignores the call if theres is no provider set.
     */
    function _cachePriceRateIfNecessary(IERC20 token) private {
        IRateProvider provider = _rateProviders[token];
        if (address(provider) != address(0)) {
            (uint256 duration, uint256 expires) = _priceRateCaches[token].getTimestamps();
            if (block.timestamp > expires) {
                // solhint-disable-previous-line not-rely-on-time
                _updatePriceRateCache(token, provider, duration);
            }
        }
    }

    /**
     * @dev Fetches the current price rate from a provider and builds a new price rate cache
     */
    function _getNewWrappedTokenRateCache(IRateProvider provider, uint256 duration)
        private
        view
        returns (bytes32 cache, uint256 rate)
    {
        rate = provider.getRate();
        cache = PriceRateCache.encode(rate, duration);
    }

    function _skipBptIndex(uint256 index) internal view returns (uint256) {
        return index < _bptIndex ? index : index + 1;
    }

    function _dropBptItem(uint256[] memory _balances) internal view returns (uint256[] memory balances) {
        balances = new uint256[](_balances.length - 1);
        for (uint256 i = 0; i < balances.length; i++) {
            balances[i] = _balances[_skipBptIndex(i)];
        }
    }
}
