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
contract MetaStablePool is BaseStablePool, StableOracleMath, PoolPriceOracle {
    using WordCodec for bytes32;
    using FixedPoint for uint256;
    using OracleMiscData for bytes32;

    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;

    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;

    IRateProvider internal immutable _rateProvider0;
    IRateProvider internal immutable _rateProvider1;

    event OracleEnabledChanged(bool enabled);

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
        bool oracleEnabled;
        address owner;
    }

    constructor(NewPoolParams memory params)
        BaseStablePool(
            params.vault,
            params.name,
            params.symbol,
            params.tokens,
            params.rateProviders,
            params.priceRateCacheDurations,
            params.amplificationParameter,
            params.swapFeePercentage,
            params.pauseWindowDuration,
            params.bufferPeriodDuration,
            params.owner
        )
    {
        _require(params.tokens.length == 2, Errors.NOT_TWO_TOKENS);

        _token0 = params.tokens[0];
        _token1 = params.tokens[1];

        _scalingFactor0 = _computeScalingFactor(params.tokens[0]);
        _scalingFactor1 = _computeScalingFactor(params.tokens[1]);

        _rateProvider0 = params.rateProviders[0];
        _rateProvider1 = params.rateProviders[1];

        _setOracleEnabled(params.oracleEnabled);
    }

    function _getScalingFactor0() private view returns (uint256) {
        return _scalingFactor0;
    }

    function _getScalingFactor1() private view returns (uint256) {
        return _scalingFactor1;
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return 2;
    }

    /**
     * @dev Returns the rate providers configured for each token (in the same order as registered).
     */
    function getRateProviders() public view virtual override returns (IRateProvider[] memory) {
        IRateProvider[] memory providers = new IRateProvider[](_getTotalTokens());

        providers[0] = _rateProvider0;
        providers[1] = _rateProvider1;

        return providers;
    }

    // Swap

    function onSwap(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) public virtual override returns (uint256) {
        _cachePriceRatesIfNecessary();
        return super.onSwap(request, balances, indexIn, indexOut);
    }

    function onSwap(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) public virtual override returns (uint256) {
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
     * Note that this function relies on the base class to perform any safety checks on joins.
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
     * Note that this function relies on the base class to perform any safety checks on exits.
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

    /**
     * @dev Sets a new duration for a token price rate cache. It reverts if there was no rate provider set initially.
     * Note this function also updates the current cached value.
     * @param duration Number of seconds until the current rate of token price is fetched again.
     */
    function setPriceRateCacheDuration(IERC20 token, uint256 duration) external authenticate {
        _updatePriceRateCache(token, duration);
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

    function _getOracleIndex() internal view override returns (uint256) {
        return _getMiscData().oracleIndex();
    }

    // Scaling factors

    /**
     * @dev Overrides scaling factor getter to introduce the token's price rate
     * Note that it may update the price rate cache if necessary.
     */
    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        //uint256 baseScalingFactor = super._scalingFactor(token);
        return _priceRate(token);
    }

    /**
     * @dev Overrides scaling factor getter to introduce the tokens' price rate.
     * Note that it may update the price rate cache if necessary.
     */
    function _scalingFactors() internal view virtual override returns (uint256[] memory scalingFactors) {
        // There is no need to check the arrays length since both are based on `_getTotalTokens`
        // Given there is no generic direction for this rounding, it simply follows the same strategy as the BasePool.
        //scalingFactors = super._scalingFactors();
        scalingFactors[0] = _scalingFactor0.mulDown(_priceRate(_token0));
        scalingFactors[1] = _scalingFactor1.mulDown(_priceRate(_token1));
    }

    function _cachePriceRatesIfNecessary() internal {
        _cachePriceRate0IfNecessary();
        _cachePriceRate1IfNecessary();
    }

    function _cachePriceRate0IfNecessary() private {
        if (_getRateProvider0() != IRateProvider(address(0))) {
            (uint256 duration, uint256 expires) = _getPriceRateCacheTimestamps(_getPriceRateCache(_token0));
            if (block.timestamp > expires) {
                _updatePriceRateCache(_token0, _getRateProvider0(), duration);
            }
        }
    }

    function _cachePriceRate1IfNecessary() private {
        if (_getRateProvider1() != IRateProvider(address(0))) {
            (uint256 duration, uint256 expires) = _getPriceRateCacheTimestamps(_getPriceRateCache(_token1));
            if (block.timestamp > expires) {
                _updatePriceRateCache(_token1, _getRateProvider1(), duration);
            }
        }
    }

    function _isToken0(IERC20 token) internal view override returns (bool) {
        return token == _token0;
    }

    function _getRateProvider0() private view returns (IRateProvider) {
        return _rateProvider0;
    }

    function _getRateProvider1() private view returns (IRateProvider) {
        return _rateProvider1;
    }

    function _getRateProvider(uint256 index) internal view virtual override returns (IRateProvider) {
        if (index == 0) {
            return _getRateProvider0();
        }
        else if (index == 1) {
            return _getRateProvider1();
        }

        _revert(Errors.OUT_OF_BOUNDS);
    }
}
