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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/LogCompression.sol";

import "@balancer-labs/v2-pool-utils/contracts/oracle/PoolPriceOracle.sol";

import "../BaseWeightedPool.sol";
import "./OracleWeightedMath.sol";
import "./OracleWeightedPoolMiscData.sol";

contract OracleWeightedPool is BaseWeightedPool, PoolPriceOracle {
    using FixedPoint for uint256;
    using OracleWeightedPoolMiscData for bytes32;

    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;

    uint256 private immutable _normalizedWeight0;
    uint256 private immutable _normalizedWeight1;

    // The protocol fees will always be charged using the token associated with the max weight in the pool.
    // Since these Pools will register tokens only once, we can assume this index will be constant.
    uint256 private immutable _maxWeightTokenIndex;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.
    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;

    event OracleEnabledChanged(bool enabled);

    struct NewPoolParams {
        IVault vault;
        string name;
        string symbol;
        IERC20[] tokens;
        uint256 normalizedWeight0;
        uint256 normalizedWeight1;
        uint256 swapFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        bool oracleEnabled;
        address owner;
    }

    constructor(NewPoolParams memory params)
        BaseWeightedPool(
            params.vault,
            params.name,
            params.symbol,
            params.tokens,
            new address[](2), // No asset managers
            params.swapFeePercentage,
            params.pauseWindowDuration,
            params.bufferPeriodDuration,
            params.owner
        )
    {
        _require(params.tokens.length == 2, Errors.TOKENS_LENGTH_MUST_BE_2);
        // Ensure each normalized weight is above the minimum, and find the token index of the maximum weight
        _require(params.normalizedWeight0 >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);
        _require(params.normalizedWeight1 >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);

        // Ensure that the normalized weights sum to ONE
        uint256 normalizedSum = params.normalizedWeight0.add(params.normalizedWeight1);
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _token0 = params.tokens[0];
        _token1 = params.tokens[1];

        _scalingFactor0 = _computeScalingFactor(params.tokens[0]);
        _scalingFactor1 = _computeScalingFactor(params.tokens[1]);

        _normalizedWeight0 = params.normalizedWeight0;
        _normalizedWeight1 = params.normalizedWeight1;

        _maxWeightTokenIndex = params.normalizedWeight0 >= params.normalizedWeight1 ? 0 : 1;

        _setOracleEnabled(params.oracleEnabled);
    }

    // Getters / Setters

    function getMiscData()
        external
        view
        returns (
            int256 logInvariant,
            int256 logTotalSupply,
            uint256 oracleSampleCreationTimestamp,
            uint256 oracleIndex,
            bool oracleEnabled,
            uint256 swapFeePercentage
        )
    {
        bytes32 miscData = _getMiscData();
        logInvariant = miscData.logInvariant();
        logTotalSupply = miscData.logTotalSupply();
        oracleSampleCreationTimestamp = miscData.oracleSampleCreationTimestamp();
        oracleIndex = miscData.oracleIndex();
        oracleEnabled = miscData.oracleEnabled();

        swapFeePercentage = getSwapFeePercentage();
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

    function _getNormalizedWeights() internal view virtual override returns (uint256[] memory) {
        uint256[] memory normalizedWeights = new uint256[](2);
        normalizedWeights[0] = _normalizedWeight0;
        normalizedWeights[1] = _normalizedWeight1;
        return normalizedWeights;
    }

    function _getNormalizedWeightsAndMaxWeightIndex()
        internal
        view
        virtual
        override
        returns (uint256[] memory, uint256)
    {
        return (_getNormalizedWeights(), _maxWeightTokenIndex);
    }

    // Swaps remain the same, except we need to update the oracle with the pre-swap balances (after these have been
    // upscaled, but before we return). A good place to do this is at the beginning of BaseMinimalSwapInfoPool's
    // _onSwapGivenIn and _onSwapGivenOut.

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal virtual override returns (uint256) {
        bool tokenInIsToken0 = swapRequest.tokenIn == _token0;

        // Update price oracle with the pre-swap balances
        _updateOracle(
            swapRequest.lastChangeBlock,
            tokenInIsToken0 ? currentBalanceTokenIn : currentBalanceTokenOut,
            tokenInIsToken0 ? currentBalanceTokenOut : currentBalanceTokenIn
        );

        return super._onSwapGivenIn(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal virtual override returns (uint256) {
        bool tokenInIsToken0 = swapRequest.tokenIn == _token0;

        // Update price oracle with the pre-swap balances
        _updateOracle(
            swapRequest.lastChangeBlock,
            tokenInIsToken0 ? currentBalanceTokenIn : currentBalanceTokenOut,
            tokenInIsToken0 ? currentBalanceTokenOut : currentBalanceTokenIn
        );

        return super._onSwapGivenOut(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
    }

    // Joins and exit also remain the same, except we need to update the oracle with the pre-join/exit balances (after
    // these have been upscaled, but before we subtract join/exits amounts from them), and we need to cache the
    // post-join/exit invariant and total supply.
    // The oracle update can be performed at the beginning of BasePool's _onJoinPool and _onExitPool, while the cache
    // update requires BPT to have been minted or burned already, so the most suitable place is at the end of
    // IBasePool's onJoinPool and onExitPool, immediately before returning to the Vault.

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
        // Update price oracle with the pre-join balances
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

    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public virtual override returns (uint256[] memory, uint256[] memory) {
        (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) = super.onJoinPool(
            poolId,
            sender,
            recipient,
            balances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            userData
        );

        // Update cached total supply and invariant using the results after the join that will be used for future
        // oracle updates.
        _cacheInvariantAndSupply();

        return (amountsIn, dueProtocolFeeAmounts);
    }

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
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        // The oracle is not updated if the Pool is paused to avoid extra calculations and reduce the potential for
        // errors.
        if (_isNotPaused()) {
            // Update price oracle with the pre-exit balances
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

    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public virtual override returns (uint256[] memory, uint256[] memory) {
        (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) = super.onExitPool(
            poolId,
            sender,
            recipient,
            balances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            userData
        );

        // Update cached total supply and invariant using the results after the exit that will be used for future
        // oracle updates, only if the pool was not paused (to minimize code paths taken while paused).
        if (_isNotPaused()) {
            _cacheInvariantAndSupply();
        }

        return (amountsOut, dueProtocolFeeAmounts);
    }

    // Oracle functions

    /**
     * @dev Updates the Price Oracle based on the Pool's current state (balances, BPT supply and invariant). Must be
     * called on *all* state-changing functions with the balances *before* the state change happens, and with
     * `lastChangeBlock` as the number of the block in which any of the balances last changed.
     */
    function _updateOracle(
        uint256 lastChangeBlock,
        uint256 balanceToken0,
        uint256 balanceToken1
    ) internal {
        if (block.number == lastChangeBlock) {
            return;
        }

        bytes32 miscData = _getMiscData();

        if (miscData.oracleEnabled()) {
            int256 logSpotPrice = OracleWeightedMath._calcLogSpotPrice(
                _normalizedWeight0,
                balanceToken0,
                _normalizedWeight1,
                balanceToken1
            );

            int256 logBPTPrice = OracleWeightedMath._calcLogBPTPrice(
                _normalizedWeight0,
                balanceToken0,
                miscData.logTotalSupply()
            );

            uint256 oracleCurrentIndex = miscData.oracleIndex();

            uint256 oracleUpdatedIndex = _processPriceData(
                miscData.oracleSampleCreationTimestamp(),
                oracleCurrentIndex,
                logSpotPrice,
                logBPTPrice,
                miscData.logInvariant()
            );

            if (oracleCurrentIndex != oracleUpdatedIndex) {
                _setMiscData(
                    // Oracle data is time-based: users should be careful to pick appropiate time windows
                    // solhint-disable-next-line not-rely-on-time
                    miscData.setOracleIndex(oracleUpdatedIndex).setOracleSampleCreationTimestamp(block.timestamp)
                );
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
            _setMiscData(
                miscData.setLogInvariant(LogCompression.toLowResLog(getLastInvariant())).setLogTotalSupply(
                    LogCompression.toLowResLog(totalSupply())
                )
            );
        }
    }

    function _getOracleIndex() internal view override returns (uint256) {
        return _getMiscData().oracleIndex();
    }

    // Scaling

    function _scalingFactor(bool token0) internal view returns (uint256) {
        return token0 ? _scalingFactor0 : _scalingFactor1;
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        return _scalingFactor(token == _token0);
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        uint256[] memory scalingFactors = new uint256[](2);
        scalingFactors[0] = _scalingFactor0;
        scalingFactors[1] = _scalingFactor1;
        return scalingFactors;
    }

    function _getMaxTokens() internal pure virtual override returns (uint256) {
        return 2;
    }

    function _getTotalTokens() internal pure virtual override returns (uint256) {
        return 2;
    }

    function _getNormalizedWeight(IERC20 token) internal view virtual override returns (uint256) {
        return token == _token0 ? _normalizedWeight0 : _normalizedWeight1;
    }
}
