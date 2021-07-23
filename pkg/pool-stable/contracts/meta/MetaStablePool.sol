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

import "@balancer-labs/v2-pool-utils/contracts/interfaces/IPriceOracle.sol";
import "@balancer-labs/v2-pool-utils/contracts/oracle/PoolPriceOracle.sol";
import "@balancer-labs/v2-pool-utils/contracts/interfaces/IRateProvider.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/LogCompression.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "../StablePool.sol";
import "./OracleMiscData.sol";
import "./StableOracleMath.sol";

/**
 * @dev StablePool suitable for assets with proportional prices (i.e. with slow-changing exchange rates between them).
 * Requires an external feed of these exchange rates.
 *
 * It additionally features a price oracle.
 */
contract MetaStablePool is StablePool, StableOracleMath, PoolPriceOracle, IPriceOracle {
    using WordCodec for bytes32;
    using FixedPoint for uint256;
    using OracleMiscData for bytes32;

    IRateProvider private immutable _rateProvider0;
    IRateProvider private immutable _rateProvider1;

    // Price rate caches are used to avoid querying the price rate for a token every time we need to work with it.
    // Data is stored with the following structure:
    //
    // [   expires   | duration | price rate value ]
    // [   uint64    |  uint64  |      uint128     ]

    bytes32 private _priceRateCache0;
    bytes32 private _priceRateCache1;

    uint256 private constant _PRICE_RATE_CACHE_VALUE_OFFSET = 0;
    uint256 private constant _PRICE_RATE_CACHE_DURATION_OFFSET = 128;
    uint256 private constant _PRICE_RATE_CACHE_EXPIRES_OFFSET = 128 + 64;

    event OracleEnabledChanged(bool enabled);
    event PriceRateProviderSet(IERC20 token, IRateProvider provider, uint256 cacheDuration);

    // The constructor arguments are received in a struct to work around stack-too-deep issues
    struct NewPoolParams {
        IVault vault;
        string name;
        string symbol;
        IERC20[] tokens;
        IRateProvider[] rateProviders;
        uint256[] priceRateCacheDuration;
        uint256 amplificationParameter;
        uint256 swapFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        bool oracleEnabled;
        address owner;
    }

    constructor(NewPoolParams memory params)
        StablePool(
            params.vault,
            params.name,
            params.symbol,
            params.tokens,
            params.amplificationParameter,
            params.swapFeePercentage,
            params.pauseWindowDuration,
            params.bufferPeriodDuration,
            params.owner
        )
    {
        _require(params.tokens.length == 2, Errors.NOT_TWO_TOKENS);

        InputHelpers.ensureInputLengthMatch(
            params.tokens.length,
            params.rateProviders.length,
            params.priceRateCacheDuration.length
        );

        IRateProvider rateProvider0 = params.rateProviders[0];
        _rateProvider0 = rateProvider0;
        if (rateProvider0 != IRateProvider(address(0))) {
            _priceRateCache0 = _getNewPriceRateCache(rateProvider0, params.priceRateCacheDuration[0]);
            emit PriceRateProviderSet(params.tokens[0], rateProvider0, params.priceRateCacheDuration[0]);
        }

        IRateProvider rateProvider1 = params.rateProviders[1];
        _rateProvider1 = rateProvider1;
        if (rateProvider1 != IRateProvider(address(0))) {
            _priceRateCache1 = _getNewPriceRateCache(rateProvider1, params.priceRateCacheDuration[1]);
            emit PriceRateProviderSet(params.tokens[1], rateProvider1, params.priceRateCacheDuration[1]);
        }

        _setOracleEnabled(params.oracleEnabled);
    }

    // Swap

    /**
     * Override to make sure sender is vault
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
     * Override to make sure sender is vault
     */
    function onSwap(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) public virtual override onlyVault(request.poolId) returns (uint256) {
        _cachePriceRatesIfNecessary();
        return super.onSwap(request, balanceTokenIn, balanceTokenOut);
    }

    /**
     * Update price oracle with the pre-swap balances
     */
    function _onSwapGivenIn(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override returns (uint256) {
        _updateOracle(request.lastChangeBlock, balances[0], balances[1]);
        return super._onSwapGivenIn(request, balances, indexIn, indexOut);
    }

    /**
     * Update price oracle with the pre-swap balances
     */
    function _onSwapGivenOut(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override returns (uint256) {
        _updateOracle(request.lastChangeBlock, balances[0], balances[1]);
        return super._onSwapGivenOut(request, balances, indexIn, indexOut);
    }

    // Join

    /**
     * @dev Update cached total supply and invariant using the results after the join that will be used for
     * future oracle updates.
     * Note this function does not perform any safety checks about joins, it relies on upper implementations for that.
     */
    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public virtual override returns (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) {
        _cachePriceRatesIfNecessary();

        (amountsIn, dueProtocolFeeAmounts) = super.onJoinPool(
            poolId,
            sender,
            recipient,
            balances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            userData
        );

        _cacheInvariantAndSupply();
    }

    /**
     * @dev Update price oracle with the pre-join balances
     */
    function _onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
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
        _updateOracle(lastChangeBlock, balances[0], balances[1]);

        return
            super._onJoinPool(
                poolId,
                sender,
                recipient,
                balances,
                lastChangeBlock,
                protocolSwapFeePercentage,
                scalingFactors,
                userData
            );
    }

    // Exit

    /**
     * @dev Update cached total supply and invariant using the results after the exit that will be used for
     * future oracle updates.
     * Note this function does not perform any safety checks about exits, it relies on upper implementations for that.
     */
    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public virtual override returns (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) {
        _cachePriceRatesIfNecessary();

        (amountsOut, dueProtocolFeeAmounts) = super.onExitPool(
            poolId,
            sender,
            recipient,
            balances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            userData
        );

        // If the contract is paused, the oracle is not updated to avoid extra calculations and reduce potential errors.
        if (_isNotPaused()) {
            _cacheInvariantAndSupply();
        }
    }

    /**
     * @dev Update price oracle with the pre-exit balances
     */
    function _onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    )
        internal
        virtual
        override
        returns (
            uint256 bptAmountIn,
            uint256[] memory amountsOut,
            uint256[] memory dueProtocolFeeAmounts
        )
    {
        // If the contract is paused, the oracle is not updated to avoid extra calculations and reduce potential errors.
        if (_isNotPaused()) {
            _updateOracle(lastChangeBlock, balances[0], balances[1]);
        }

        return
            super._onExitPool(
                poolId,
                sender,
                recipient,
                balances,
                lastChangeBlock,
                protocolSwapFeePercentage,
                scalingFactors,
                userData
            );
    }

    // Oracle

    function getOracleMiscData()
        external
        view
        returns (
            int256 logInvariant,
            int256 logTotalSupply,
            uint256 oracleSampleCreationTimestamp,
            uint256 oracleIndex,
            bool oracleEnabled
        )
    {
        bytes32 miscData = _getMiscData();
        logInvariant = miscData.logInvariant();
        logTotalSupply = miscData.logTotalSupply();
        oracleSampleCreationTimestamp = miscData.oracleSampleCreationTimestamp();
        oracleIndex = miscData.oracleIndex();
        oracleEnabled = miscData.oracleEnabled();
    }

    /**
     * @dev Balancer Governance can always enable the Oracle, even if it was originally not enabled. This allows for
     * Pools that unexpectedly drive much more volume and liquidity than expected to serve as Price Oracles.
     *
     * Note that the Oracle can only be enabled - it can never be disabled.
     */
    function enableOracle() external whenNotPaused authenticate {
        _setOracleEnabled(true);

        // Cache log invariant and supply only if the pool was initialized
        if (totalSupply() > 0) {
            _cacheInvariantAndSupply();
        }
    }

    function _setOracleEnabled(bool enabled) internal {
        _setMiscData(_getMiscData().setOracleEnabled(enabled));
        emit OracleEnabledChanged(enabled);
    }

    function getLargestSafeQueryWindow() external pure override returns (uint256) {
        return 34 hours;
    }

    function getLatest(Variable variable) external view override returns (uint256) {
        int256 instantValue = _getInstantValue(variable, _getMiscData().oracleIndex());
        return LogCompression.fromLowResLog(instantValue);
    }

    function getTimeWeightedAverage(OracleAverageQuery[] memory queries)
        external
        view
        override
        returns (uint256[] memory results)
    {
        results = new uint256[](queries.length);
        uint256 oracleIndex = _getMiscData().oracleIndex();

        OracleAverageQuery memory query;
        for (uint256 i = 0; i < queries.length; ++i) {
            query = queries[i];
            _require(query.secs != 0, Errors.ORACLE_BAD_SECS);

            int256 beginAccumulator = _getPastAccumulator(query.variable, oracleIndex, query.ago + query.secs);
            int256 endAccumulator = _getPastAccumulator(query.variable, oracleIndex, query.ago);
            results[i] = LogCompression.fromLowResLog((endAccumulator - beginAccumulator) / int256(query.secs));
        }
    }

    function getPastAccumulators(OracleAccumulatorQuery[] memory queries)
        external
        view
        override
        returns (int256[] memory results)
    {
        results = new int256[](queries.length);
        uint256 oracleIndex = _getMiscData().oracleIndex();

        OracleAccumulatorQuery memory query;
        for (uint256 i = 0; i < queries.length; ++i) {
            query = queries[i];
            results[i] = _getPastAccumulator(query.variable, oracleIndex, query.ago);
        }
    }

    /**
     * @dev Updates the Price Oracle based on the Pool's current state (balances, BPT supply and invariant). Must be
     * called on *all* state-changing functions with the balances *before* the state change happens, and with
     * `lastChangeBlock` as the number of the block in which any of the balances last changed.
     */
    function _updateOracle(
        uint256 lastChangeBlock,
        uint256 balance0,
        uint256 balance1
    ) internal {
        bytes32 miscData = _getMiscData();
        (uint256 currentAmp, ) = _getAmplificationParameter();

        if (miscData.oracleEnabled() && block.number > lastChangeBlock) {
            (int256 logSpotPrice, int256 logBptPrice) = StableOracleMath._calcLogPrices(
                currentAmp,
                balance0,
                balance1,
                miscData.logTotalSupply()
            );

            uint256 oracleCurrentIndex = miscData.oracleIndex();
            uint256 oracleCurrentSampleInitialTimestamp = miscData.oracleSampleCreationTimestamp();
            uint256 oracleUpdatedIndex = _processPriceData(
                oracleCurrentSampleInitialTimestamp,
                oracleCurrentIndex,
                logSpotPrice,
                logBptPrice,
                miscData.logInvariant()
            );

            if (oracleCurrentIndex != oracleUpdatedIndex) {
                // solhint-disable not-rely-on-time
                miscData = miscData.setOracleIndex(oracleUpdatedIndex);
                miscData = miscData.setOracleSampleCreationTimestamp(block.timestamp);
                _setMiscData(miscData);
            }
        }
    }

    /**
     * @dev Stores the logarithm of the invariant and BPT total supply, to be later used in each oracle update. Because
     * it is stored in miscData, which is read in all operations (including swaps), this saves gas by not requiring to
     * compute or read these values when updating the oracle.
     *
     * This function must be called by all actions that update the invariant and BPT supply (joins and exits). Swaps
     * also alter the invariant due to collected swap fees, but this growth is considered negligible and not accounted
     * for.
     */
    function _cacheInvariantAndSupply() internal {
        bytes32 miscData = _getMiscData();
        if (miscData.oracleEnabled()) {
            miscData = miscData.setLogInvariant(LogCompression.toLowResLog(_lastInvariant));
            miscData = miscData.setLogTotalSupply(LogCompression.toLowResLog(totalSupply()));
            _setMiscData(miscData);
        }
    }

    // Scaling factors

    /**
     * @dev Overrides scaling factor getter to introduce the token's price rate
     * Note that it may update the price rate cache if necessary.
     */
    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        uint256 baseScalingFactor = super._scalingFactor(token);
        uint256 priceRate = _priceRate(token);
        // Given there is no generic direction for this rounding, it simply follows the same strategy as the BasePool.
        return baseScalingFactor.mulDown(priceRate);
    }

    /**
     * @dev Overrides scaling factor getter to introduce the tokens' price rate.
     * Note that it may update the price rate cache if necessary.
     */
    function _scalingFactors() internal view virtual override returns (uint256[] memory scalingFactors) {
        // There is no need to check the arrays length since both are based on `_getTotalTokens`
        // Given there is no generic direction for this rounding, it simply follows the same strategy as the BasePool.
        scalingFactors = super._scalingFactors();
        scalingFactors[0] = scalingFactors[0].mulDown(_priceRate(_token0));
        scalingFactors[1] = scalingFactors[1].mulDown(_priceRate(_token1));
    }

    // Price rates

    /**
     * @dev Returns the rate providers configured for each token (in the same order as registered).
     */
    function getRateProviders() external view returns (IRateProvider[] memory providers) {
        providers = new IRateProvider[](2);
        providers[0] = _getRateProvider0();
        providers[1] = _getRateProvider1();
    }

    /**
     * @dev Returns the cached value for token's rate
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
        if (_isToken0(token)) return _getPriceRateCache(_priceRateCache0);
        if (_isToken1(token)) return _getPriceRateCache(_priceRateCache1);
        _revert(Errors.INVALID_TOKEN);
    }

    /**
     * @dev Sets a new duration for a token price rate cache. It reverts if there was no rate provider set initially.
     * Note this function also updates the current cached value.
     * @param duration Number of seconds until the current rate of token price is fetched again.
     */
    function setPriceRateCacheDuration(IERC20 token, uint256 duration) external authenticate {
        if (_isToken0WithRateProvider(token)) {
            _priceRateCache0 = _getNewPriceRateCache(_getRateProvider0(), duration);
            emit PriceRateProviderSet(token, _getRateProvider0(), duration);
        } else if (_isToken1WithRateProvider(token)) {
            _priceRateCache1 = _getNewPriceRateCache(_getRateProvider1(), duration);
            emit PriceRateProviderSet(token, _getRateProvider1(), duration);
        } else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function updatePriceRateCache(IERC20 token) external {
        if (_isToken0WithRateProvider(token)) {
            _priceRateCache0 = _getNewPriceRateCache(_getRateProvider0(), _getPriceRateCacheDuration(_priceRateCache0));
        } else if (_isToken1WithRateProvider(token)) {
            _priceRateCache1 = _getNewPriceRateCache(_getRateProvider1(), _getPriceRateCacheDuration(_priceRateCache1));
        } else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    /**
     * @dev Returns the list of price rates for each token. All price rates are fixed-point values with 18 decimals.
     * In case there is no rate provider for a token it returns 1e18.
     */
    function _priceRate(IERC20 token) internal view virtual returns (uint256) {
        // Given that this function is only used by `onSwap` which can only be called by the vault in the case of a
        // Meta Stable Pool, we can be sure the vault will not forward a call with an invalid `token` param.
        if (_isToken0WithRateProvider(token)) {
            return _getPriceRateCacheValue(_priceRateCache0);
        } else if (_isToken1WithRateProvider(token)) {
            return _getPriceRateCacheValue(_priceRateCache1);
        } else {
            return FixedPoint.ONE;
        }
    }

    function _cachePriceRatesIfNecessary() internal {
        _cachePriceRate0IfNecessary();
        _cachePriceRate1IfNecessary();
    }

    function _cachePriceRate0IfNecessary() private {
        if (_getRateProvider0() != IRateProvider(address(0))) {
            (uint256 duration, uint256 expires) = _getPriceRateCacheTimestamps(_priceRateCache0);
            if (block.timestamp > expires) {
                _priceRateCache0 = _getNewPriceRateCache(_getRateProvider0(), duration);
            }
        }
    }

    function _cachePriceRate1IfNecessary() private {
        if (_getRateProvider1() != IRateProvider(address(0))) {
            (uint256 duration, uint256 expires) = _getPriceRateCacheTimestamps(_priceRateCache1);
            if (block.timestamp > expires) {
                _priceRateCache1 = _getNewPriceRateCache(_getRateProvider1(), duration);
            }
        }
    }

    /**
     * @dev Decodes a price rate cache into rate value, duration and expiration time
     */
    function _getPriceRateCache(bytes32 cache)
        private
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

    /**
     * @dev Decodes the duration and expiration timestamp for a price rate cache
     */
    function _getPriceRateCacheTimestamps(bytes32 cache) private pure returns (uint256 duration, uint256 expires) {
        duration = _getPriceRateCacheDuration(cache);
        expires = cache.decodeUint64(_PRICE_RATE_CACHE_EXPIRES_OFFSET);
    }

    /**
     * @dev Fetches the current price rate from a provider and builds a new price rate cache
     */
    function _getNewPriceRateCache(IRateProvider provider, uint256 duration) private view returns (bytes32) {
        uint256 rate = provider.getRate();
        _require(rate < 2**128, Errors.PRICE_RATE_OVERFLOW);

        return
            WordCodec.encodeUint(uint128(rate), _PRICE_RATE_CACHE_VALUE_OFFSET) |
            WordCodec.encodeUint(uint64(duration), _PRICE_RATE_CACHE_DURATION_OFFSET) |
            WordCodec.encodeUint(uint64(block.timestamp + duration), _PRICE_RATE_CACHE_EXPIRES_OFFSET);
    }

    function _isToken0WithRateProvider(IERC20 token) internal view returns (bool) {
        return _isToken0(token) && _getRateProvider0() != IRateProvider(address(0));
    }

    function _isToken1WithRateProvider(IERC20 token) internal view returns (bool) {
        return _isToken1(token) && _getRateProvider1() != IRateProvider(address(0));
    }

    function _getRateProvider0() internal view returns (IRateProvider) {
        return _rateProvider0;
    }

    function _getRateProvider1() internal view returns (IRateProvider) {
        return _rateProvider1;
    }
}
