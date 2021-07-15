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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "../BaseWeightedPool.sol";
import "./WeightCompression.sol";

/**
 * @dev Weighted Pool with mutable weights, designed to support V2 Liquidity Bootstrapping
 */
contract LiquidityBootstrappingPool is BaseWeightedPool, ReentrancyGuard {
    // The Pause Window and Buffer Period are timestamp-based: they should not be relied upon for sub-minute accuracy.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using WordCodec for bytes32;
    using WeightCompression for uint256;

    // LBPs often involve only two tokens - we support up to four since we're able to pack the entire config in a single
    // storage slot.
    uint256 private constant _MAX_LBP_TOKENS = 4;

    // State variables

    uint256 private immutable _totalTokens;

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

    // All swaps fail while this is false
    bool private _swapEnabled;

    // For gas optimization, store start/end weights and timestamps in one bytes32
    // Start weights need to be high precision, since restarting the update resets them to "spot"
    // values. Target end weights do not need as much precision.
    // [     32 bits   |     32 bits     |      64 bits     |      128 bits      |
    // [ end timestamp | start timestamp | 4x16 end weights | 4x32 start weights |
    // |MSB                                                                   LSB|

    bytes32 private _poolState;

    // Offsets for data elements in _poolState
    uint256 private constant _START_WEIGHT_OFFSET = 0;
    uint256 private constant _END_WEIGHT_OFFSET = 128;
    uint256 private constant _START_TIME_OFFSET = 192;
    uint256 private constant _END_TIME_OFFSET = 224;

    // Event declarations

    event SwapEnabledSet(bool swapEnabled);
    event GradualWeightUpdateScheduled(
        uint256 startTime,
        uint256 endTime,
        uint256[] startWeights,
        uint256[] endWeights
    );

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory normalizedWeights,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner,
        bool swapEnabledOnStart
    )
        BaseWeightedPool(
            vault,
            name,
            symbol,
            tokens,
            new address[](tokens.length), // Pass the zero address: LBPs can't have asset managers
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        uint256 totalTokens = tokens.length;
        InputHelpers.ensureInputLengthMatch(totalTokens, normalizedWeights.length);

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

        // If false, the pool will start in the disabled state (prevents front-running the enable swaps transaction)
        _setSwapEnabled(swapEnabledOnStart);
    }

    // External functions

    /**
     * @dev Getter for _swapEnabled. If false, trading is disabled.
     */
    function getSwapEnabled() external view returns (bool) {
        return _swapEnabled;
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

        startTime = poolState.decodeUint32(_START_TIME_OFFSET);
        endTime = poolState.decodeUint32(_END_TIME_OFFSET);
        uint256 totalTokens = _getTotalTokens();
        endWeights = new uint256[](totalTokens);

        for (uint256 i = 0; i < totalTokens; i++) {
            endWeights[i] = poolState.decodeUint16(_END_WEIGHT_OFFSET + i * 16).uncompress16();
        }
    }

    /**
     * @dev Can pause/unpause trading
     */
    function setSwapEnabled(bool swapEnabled) external authenticate whenNotPaused nonReentrant {
        _setSwapEnabled(swapEnabled);
    }

    /**
     * @dev Schedule a gradual weight change, from the current weights to the given endWeights,
     * over startTime to endTime
     */
    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory endWeights
    ) external authenticate whenNotPaused nonReentrant {
        InputHelpers.ensureInputLengthMatch(_getTotalTokens(), endWeights.length);

        // If the start time is in the past, "fast forward" to start now
        // This avoids discontinuities in the weight curve. Otherwise, if you set the start/end times with
        // only 10% of the period in the future, the weights would immediately jump 90%
        uint256 currentTime = block.timestamp;
        startTime = currentTime > startTime ? currentTime : startTime;

        _require(startTime <= endTime, Errors.GRADUAL_UPDATE_TIME_TRAVEL);

        _startGradualWeightChange(startTime, endTime, _getNormalizedWeights(), endWeights);
    }

    // Internal functions

    function _getNormalizedWeight(IERC20 token) internal view override returns (uint256) {
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

        bytes32 poolState = _poolState;

        return _getNormalizedWeightByIndex(i, poolState);
    }

    function _getNormalizedWeightByIndex(uint256 i, bytes32 poolState) internal view returns (uint256) {
        uint256 startWeight = poolState.decodeUint32(_START_WEIGHT_OFFSET + i * 32).uncompress32();
        uint256 endWeight = poolState.decodeUint16(_END_WEIGHT_OFFSET + i * 16).uncompress16();

        uint256 pctProgress = _calculateWeightChangeProgress(poolState);

        return _interpolateWeight(startWeight, endWeight, pctProgress);
    }

    function _getNormalizedWeights() internal view override returns (uint256[] memory) {
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

    function _getNormalizedWeightsAndMaxWeightIndex()
        internal
        view
        override
        returns (uint256[] memory normalizedWeights, uint256 maxWeightTokenIndex)
    {
        normalizedWeights = _getNormalizedWeights();

        uint256 maxNormalizedWeight = 0;

        for (uint256 i = 0; i < normalizedWeights.length; i++) {
            if (normalizedWeights[i] > maxNormalizedWeight) {
                maxWeightTokenIndex = i;
                maxNormalizedWeight = normalizedWeights[i];
            }
        }
    }

    // Pool callback functions

    // Prevent any account other than the owner from joining the pool

    function _onInitializePool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        // Only the owner can initialize the pool
        _require(sender == getOwner(), Errors.CALLER_IS_NOT_LBP_OWNER);

        return super._onInitializePool(poolId, sender, recipient, scalingFactors, userData);
    }

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
        override
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        // Only the owner can add liquidity; block public LPs
        _require(sender == getOwner(), Errors.CALLER_IS_NOT_LBP_OWNER);

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

    // Swap overrides - revert unless swaps are enabled

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view override returns (uint256) {
        _require(_swapEnabled, Errors.SWAPS_DISABLED);

        return super._onSwapGivenIn(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view override returns (uint256) {
        _require(_swapEnabled, Errors.SWAPS_DISABLED);

        return super._onSwapGivenOut(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
    }

    /**
     * @dev Extend ownerOnly functions to include the LBP control functions
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view override returns (bool) {
        return
            (actionId == getActionId(LiquidityBootstrappingPool.setSwapEnabled.selector)) ||
            (actionId == getActionId(LiquidityBootstrappingPool.updateWeightsGradually.selector)) ||
            super._isOwnerOnlyAction(actionId);
    }

    // Private functions

    /**
     * @dev Returns a fixed-point number representing how far along the current weight change is, where 0 means the
     * change has not yet started, and FixedPoint.ONE means it has fully completed.
     */
    function _calculateWeightChangeProgress(bytes32 poolState) private view returns (uint256) {
        uint256 currentTime = block.timestamp;
        uint256 startTime = poolState.decodeUint32(_START_TIME_OFFSET);
        uint256 endTime = poolState.decodeUint32(_END_TIME_OFFSET);

        if (currentTime > endTime) {
            return FixedPoint.ONE;
        } else if (currentTime < startTime) {
            return 0;
        }

        uint256 totalSeconds = endTime.sub(startTime);
        uint256 secondsElapsed = currentTime.sub(startTime);

        // In the degenerate case of a zero duration change, consider it completed (and avoid division by zero)
        return totalSeconds == 0 ? FixedPoint.ONE : secondsElapsed.divDown(totalSeconds);
    }

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
            _require(endWeight >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

            newPoolState = newPoolState.insertUint32(startWeights[i].compress32(), _START_WEIGHT_OFFSET + i * 32);
            newPoolState = newPoolState.insertUint16(endWeight.compress16(), _END_WEIGHT_OFFSET + i * 16);

            normalizedSum = normalizedSum.add(endWeight);
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        newPoolState = newPoolState.insertUint32(startTime, _START_TIME_OFFSET);
        newPoolState = newPoolState.insertUint32(endTime, _END_TIME_OFFSET);

        _poolState = newPoolState;

        emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);
    }

    function _interpolateWeight(
        uint256 startWeight,
        uint256 endWeight,
        uint256 pctProgress
    ) private pure returns (uint256 finalWeight) {
        if (pctProgress == 0) return startWeight;
        if (pctProgress >= FixedPoint.ONE) return endWeight;

        if (endWeight < startWeight) {
            uint256 weightDelta = pctProgress.mulDown(startWeight.sub(endWeight));
            finalWeight = startWeight.sub(weightDelta);
        } else {
            uint256 weightDelta = pctProgress.mulDown(endWeight.sub(startWeight));
            finalWeight = startWeight.add(weightDelta);
        }
    }

    function _setSwapEnabled(bool swapEnabled) private {
        _swapEnabled = swapEnabled;

        emit SwapEnabledSet(swapEnabled);
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return _MAX_LBP_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _totalTokens;
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        // prettier-ignore
        if (token == _token0) { return _scalingFactor0; }
        else if (token == _token1) { return _scalingFactor1; }
        else if (token == _token2) { return _scalingFactor2; }
        else if (token == _token3) { return _scalingFactor3; }
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        uint256 totalTokens = _getTotalTokens();
        uint256[] memory scalingFactors = new uint256[](totalTokens);

        // prettier-ignore
        {
            if (totalTokens > 0) { scalingFactors[0] = _scalingFactor0; } else { return scalingFactors; }
            if (totalTokens > 1) { scalingFactors[1] = _scalingFactor1; } else { return scalingFactors; }
            if (totalTokens > 2) { scalingFactors[2] = _scalingFactor2; } else { return scalingFactors; }
            if (totalTokens > 3) { scalingFactors[3] = _scalingFactor3; } else { return scalingFactors; }
        }

        return scalingFactors;
    }
}
