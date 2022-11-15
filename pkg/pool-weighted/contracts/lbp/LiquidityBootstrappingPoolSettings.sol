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

import "@balancer-labs/v2-interfaces/contracts/vault/IMinimalSwapInfoPool.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ScalingHelpers.sol";

import "@balancer-labs/v2-pool-utils/contracts/NewBasePool.sol";

import "../lib/GradualValueChange.sol";
import "../lib/ValueCompression.sol";
import "../WeightedMath.sol";

/**
 * @dev Weighted Pool with mutable weights, designed to support V2 Liquidity Bootstrapping.
 */
abstract contract LiquidityBootstrappingPoolSettings is IMinimalSwapInfoPool, NewBasePool {
    // LiquidityBootstrappingPools change their weights over time: these periods are expected to be long enough (e.g.
    // days) that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using WordCodec for bytes32;
    using ValueCompression for uint256;

    // LBPs often involve only two tokens - we support up to four since we're able to pack the entire config in a single
    // storage slot.
    uint256 private constant _MIN_TOKENS = 2;
    uint256 private constant _MAX_LBP_TOKENS = 4;

    // 1e18 corresponds to 1.0, or a 100% fee
    uint256 private constant _MIN_SWAP_FEE_PERCENTAGE = 1e12; // 0.0001%
    uint256 private constant _MAX_SWAP_FEE_PERCENTAGE = 1e17; // 10%

    uint256 private immutable _totalTokens;

    uint256 private _swapFeePercentage;

    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;
    IERC20 internal immutable _token2;
    IERC20 internal immutable _token3;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.

    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;
    uint256 internal immutable _scalingFactor2;
    uint256 internal immutable _scalingFactor3;

    // For gas optimization, store start/end weights and timestamps in one bytes32
    // Start weights need to be high precision, since restarting the update resets them to "spot"
    // values. Target end weights do not need as much precision.
    // [     32 bits   |     32 bits     |      64 bits     |      124 bits      |  2 bits  |  1 bit   |     1 bit    ]
    // [ end timestamp | start timestamp | 4x16 end weights | 4x31 start weights | not used | recovery | swap enabled ]
    // |MSB                                                                                                        LSB|

    bytes32 private _poolState;

    // Offsets for data elements in _poolState
    uint256 private constant _SWAP_ENABLED_OFFSET = 0;
    uint256 private constant _RECOVERY_MODE_BIT_OFFSET = 1;
    uint256 private constant _START_WEIGHT_OFFSET = _RECOVERY_MODE_BIT_OFFSET + 3;
    uint256 private constant _END_WEIGHT_OFFSET = _START_WEIGHT_OFFSET + _MAX_LBP_TOKENS * _START_WEIGHT_BIT_LENGTH;
    uint256 private constant _START_TIME_OFFSET = _END_WEIGHT_OFFSET + _MAX_LBP_TOKENS * _END_WEIGHT_BIT_LENGTH;
    uint256 private constant _END_TIME_OFFSET = _START_TIME_OFFSET + _TIMESTAMP_BIT_LENGTH;

    uint256 private constant _START_WEIGHT_BIT_LENGTH = 31;
    uint256 private constant _END_WEIGHT_BIT_LENGTH = 16;
    uint256 private constant _TIMESTAMP_BIT_LENGTH = 32;

    // Event declarations

    event SwapFeePercentageChanged(uint256 swapFeePercentage);
    event SwapEnabledSet(bool swapEnabled);
    event GradualWeightUpdateScheduled(
        uint256 startTime,
        uint256 endTime,
        uint256[] startWeights,
        uint256[] endWeights
    );

    constructor(
        IVault vault,
        bytes32 poolId,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory normalizedWeights,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner,
        bool swapEnabledOnStart
    ) NewBasePool(vault, poolId, name, symbol, pauseWindowDuration, bufferPeriodDuration, owner) {
        uint256 totalTokens = tokens.length;
        InputHelpers.ensureInputLengthMatch(totalTokens, normalizedWeights.length);
        _require(tokens.length >= _MIN_TOKENS, Errors.MIN_TOKENS);
        _require(tokens.length <= _MAX_LBP_TOKENS, Errors.MAX_TOKENS);

        _totalTokens = totalTokens;

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _token0 = tokens[0];
        _token1 = tokens[1];
        _token2 = totalTokens > 2 ? tokens[2] : IERC20(0);
        _token3 = totalTokens > 3 ? tokens[3] : IERC20(0);

        _scalingFactor0 = _computeScalingFactor(tokens[0]);
        _scalingFactor1 = _computeScalingFactor(tokens[1]);
        _scalingFactor2 = totalTokens > 2 ? _computeScalingFactor(tokens[2]) : 0;
        _scalingFactor3 = totalTokens > 3 ? _computeScalingFactor(tokens[3]) : 0;

        uint256 currentTime = block.timestamp;

        _startGradualWeightChange(currentTime, currentTime, normalizedWeights, normalizedWeights);

        _setSwapFeePercentage(swapFeePercentage);

        // If false, the pool will start in the disabled state (prevents front-running the enable swaps transaction)
        _setSwapEnabled(swapEnabledOnStart);
    }

    // External functions

    /**
     * @notice Return whether swaps are enabled or not for the given pool.
     */
    function getSwapEnabled() public view returns (bool) {
        return _poolState.decodeBool(_SWAP_ENABLED_OFFSET);
    }

    /**
     * @notice Return the current value of the swap fee percentage.
     * @dev This is stored separately, as there is no more room in `_poolState`.
     */
    function getSwapFeePercentage() public view virtual override returns (uint256) {
        return _swapFeePercentage;
    }

    /**
     * @notice Return the current token weights.
     */
    function getNormalizedWeights() external view returns (uint256[] memory) {
        return _getNormalizedWeights();
    }

    /**
     * @dev Return start time, end time, and endWeights as an array.
     * Current weights should be retrieved via `getNormalizedWeights()`.
     */
    function getGradualWeightUpdateParams()
        external
        view
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256[] memory endWeights
        )
    {
        // Load current pool state from storage
        bytes32 poolState = _poolState;

        startTime = poolState.decodeUint(_START_TIME_OFFSET, _TIMESTAMP_BIT_LENGTH);
        endTime = poolState.decodeUint(_END_TIME_OFFSET, _TIMESTAMP_BIT_LENGTH);
        uint256 totalTokens = _getTotalTokens();
        endWeights = new uint256[](totalTokens);

        for (uint256 i = 0; i < totalTokens; i++) {
            endWeights[i] = poolState
                .decodeUint(_END_WEIGHT_OFFSET + i * _END_WEIGHT_BIT_LENGTH, _END_WEIGHT_BIT_LENGTH)
                .decompress(_END_WEIGHT_BIT_LENGTH);
        }
    }

    /**
     * @notice Pause/unpause trading.
     */
    function setSwapEnabled(bool swapEnabled) external authenticate whenNotPaused {
        _setSwapEnabled(swapEnabled);
    }

    /**
     * @notice Schedule a gradual weight change.
     * @dev Weights will change from the current weights to the given endWeights, over startTime to endTime.
     */
    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory endWeights
    ) external authenticate whenNotPaused {
        InputHelpers.ensureInputLengthMatch(_getTotalTokens(), endWeights.length);

        startTime = GradualValueChange.resolveStartTime(startTime, endTime);
        _startGradualWeightChange(startTime, endTime, _getNormalizedWeights(), endWeights);
    }

    // Internal functions

    function _getNormalizedWeight(IERC20 token) internal view returns (uint256) {
        uint256 i;

        // First, convert token address to a token index

        // prettier-ignore
        if (token == _token0) { i = 0; }
        else if (token == _token1) { i = 1; }
        else if (token == _token2) { i = 2; }
        else if (token == _token3) { i = 3; }
        else {
            _revert(Errors.INVALID_TOKEN);
        }

        return _getNormalizedWeightByIndex(i, _poolState);
    }

    function _getNormalizedWeightByIndex(uint256 i, bytes32 poolState) internal view returns (uint256) {
        uint256 startWeight = poolState
            .decodeUint(_START_WEIGHT_OFFSET + i * _START_WEIGHT_BIT_LENGTH, _START_WEIGHT_BIT_LENGTH)
            .decompress(_START_WEIGHT_BIT_LENGTH);
        uint256 endWeight = poolState
            .decodeUint(_END_WEIGHT_OFFSET + i * _END_WEIGHT_BIT_LENGTH, _END_WEIGHT_BIT_LENGTH)
            .decompress(_END_WEIGHT_BIT_LENGTH);
        uint256 startTime = poolState.decodeUint(_START_TIME_OFFSET, _TIMESTAMP_BIT_LENGTH);
        uint256 endTime = poolState.decodeUint(_END_TIME_OFFSET, _TIMESTAMP_BIT_LENGTH);

        return GradualValueChange.getInterpolatedValue(startWeight, endWeight, startTime, endTime);
    }

    function _getNormalizedWeights() internal view returns (uint256[] memory) {
        uint256 totalTokens = _getTotalTokens();
        uint256[] memory normalizedWeights = new uint256[](totalTokens);

        bytes32 poolState = _poolState;

        // prettier-ignore
        {
            normalizedWeights[0] = _getNormalizedWeightByIndex(0, poolState);
            normalizedWeights[1] = _getNormalizedWeightByIndex(1, poolState);
            if (totalTokens == 2) return normalizedWeights;
            normalizedWeights[2] = _getNormalizedWeightByIndex(2, poolState);
            if (totalTokens == 3) return normalizedWeights;
            normalizedWeights[3] = _getNormalizedWeightByIndex(3, poolState);
        }

        return normalizedWeights;
    }

    // Swap Fees

    /**
     * @notice Set the swap fee percentage.
     * @dev This is a permissioned function, and disabled if the pool is paused. The swap fee must be within the
     * bounds set by MIN_SWAP_FEE_PERCENTAGE/MAX_SWAP_FEE_PERCENTAGE. Emits the SwapFeePercentageChanged event.
     */
    function setSwapFeePercentage(uint256 swapFeePercentage) public virtual authenticate whenNotPaused {
        _setSwapFeePercentage(swapFeePercentage);
    }

    function _setSwapFeePercentage(uint256 swapFeePercentage) internal virtual {
        _require(swapFeePercentage >= _MIN_SWAP_FEE_PERCENTAGE, Errors.MIN_SWAP_FEE_PERCENTAGE);
        _require(swapFeePercentage <= _MAX_SWAP_FEE_PERCENTAGE, Errors.MAX_SWAP_FEE_PERCENTAGE);

        _swapFeePercentage = swapFeePercentage;

        emit SwapFeePercentageChanged(swapFeePercentage);
    }

    // Gradual weight change

    /**
     * @dev When calling updateWeightsGradually again during an update, reset the start weights to the current weights,
     * if necessary.
     */
    function _startGradualWeightChange(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory startWeights,
        uint256[] memory endWeights
    ) internal virtual {
        bytes32 newPoolState = _poolState;

        uint256 normalizedSum = 0;
        for (uint256 i = 0; i < endWeights.length; i++) {
            uint256 endWeight = endWeights[i];
            _require(endWeight >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);

            newPoolState = newPoolState
                .insertUint(
                startWeights[i].compress(_START_WEIGHT_BIT_LENGTH),
                _START_WEIGHT_OFFSET + i * _START_WEIGHT_BIT_LENGTH,
                _START_WEIGHT_BIT_LENGTH
            )
                .insertUint(
                endWeight.compress(_END_WEIGHT_BIT_LENGTH),
                _END_WEIGHT_OFFSET + i * _END_WEIGHT_BIT_LENGTH,
                _END_WEIGHT_BIT_LENGTH
            );

            normalizedSum = normalizedSum.add(endWeight);
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _poolState = newPoolState.insertUint(startTime, _START_TIME_OFFSET, _TIMESTAMP_BIT_LENGTH).insertUint(
            endTime,
            _END_TIME_OFFSET,
            _TIMESTAMP_BIT_LENGTH
        );

        emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);
    }

    function _getTotalTokens() internal view returns (uint256) {
        return _totalTokens;
    }

    function _setSwapEnabled(bool swapEnabled) private {
        _poolState = _poolState.insertBool(swapEnabled, _SWAP_ENABLED_OFFSET);
        emit SwapEnabledSet(swapEnabled);
    }

    // Scaling factors

    function _scalingFactor(IERC20 token) internal view returns (uint256) {
        // prettier-ignore
        if (token == _token0) { return _scalingFactor0; }
        else if (token == _token1) { return _scalingFactor1; }
        else if (token == _token2) { return _scalingFactor2; }
        else if (token == _token3) { return _scalingFactor3; }
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function getScalingFactors() public view virtual override returns (uint256[] memory) {
        uint256 totalTokens = _getTotalTokens();
        uint256[] memory scalingFactors = new uint256[](totalTokens);

        // prettier-ignore
        {
            scalingFactors[0] = _scalingFactor0;
            scalingFactors[1] = _scalingFactor1;
            if (totalTokens > 2) { scalingFactors[2] = _scalingFactor2; } else { return scalingFactors; }
            if (totalTokens > 3) { scalingFactors[3] = _scalingFactor3; } else { return scalingFactors; }
        }

        return scalingFactors;
    }

    // Recovery Mode

    /**
     * @notice Returns whether the pool is in Recovery Mode.
     */
    function inRecoveryMode() public view override returns (bool) {
        return _poolState.decodeBool(_RECOVERY_MODE_BIT_OFFSET);
    }

    /**
     * @dev Sets the recoveryMode state. The RecoveryModeStateChanged event is emitted in the RecoveryMode
     * base contract, in `enableRecoveryMode` or `disabledRecoveryMode`, before calling this hook.
     */
    function _setRecoveryMode(bool enabled) internal virtual override {
        _poolState = _poolState.insertBool(enabled, _RECOVERY_MODE_BIT_OFFSET);
    }

    // Misc

    /**
     * @dev Extend ownerOnly functions to include the LBP control functions
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view override returns (bool) {
        return
            (actionId == getActionId(this.setSwapFeePercentage.selector)) ||
            (actionId == getActionId(LiquidityBootstrappingPoolSettings.setSwapEnabled.selector)) ||
            (actionId == getActionId(LiquidityBootstrappingPoolSettings.updateWeightsGradually.selector));
    }
}
