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
    using FixedPoint for uint256;
    using WordCodec for bytes32;
    using WeightCompression for uint256;

    uint256 private constant _MAX_LBP_TOKENS = 4;

    // State variables

    // All swaps fail while this is false
    bool public swapEnabled;

    // For gas optimization, store start/end weights and timestamps in one bytes32
    // Start weights need to be high precision, since restarting the update resets them to "spot"
    // values. Target end weights do not need as much precision.
    // [     32 bits   |     32 bits     |      64 bits     |      128 bits      |
    // [ end timestamp | start timestamp | 4x16 end weights | 4x32 start weights |
    // |MSB                                                                   LSB|

    bytes32 private _poolState;

    // Offsets for data elements in _poolState
    // Start weights begin at offset 0
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
        _require(totalTokens <= _MAX_LBP_TOKENS, Errors.MAX_TOKENS);

        InputHelpers.ensureInputLengthMatch(totalTokens, normalizedWeights.length);

        bytes32 poolState;

        // Ensure valid weights
        uint256 normalizedSum = 0;
        for (uint8 i = 0; i < totalTokens; i++) {
            uint256 normalizedWeight = normalizedWeights[i];
            _require(normalizedWeight >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

            // Insert "start weights" and "end weights" into poolState
            // Before the first update, start=end, which avoids initialization edge cases
            poolState = poolState.insertUint32(normalizedWeight.compress32(), i * 32);
            poolState = poolState.insertUint16(normalizedWeight.compress16(), _END_WEIGHT_OFFSET + i * 16);

            normalizedSum = normalizedSum.add(normalizedWeight);
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        // Write initial pool state - all zeros except for the start weights
        _poolState = poolState;

        // If false, the pool will start in the paused state (prevents front-running the unpause transaction)
        _setSwapEnabled(swapEnabledOnStart);
    }

    // External functions

    /**
     * @dev Return start time, end time, and endWeights as an array
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

        // prettier-ignore
        {
            if (totalTokens > 0) { endWeights[0] = poolState.decodeUint16(_END_WEIGHT_OFFSET).uncompress16(); }
            if (totalTokens > 1) { endWeights[1] = poolState.decodeUint16(_END_WEIGHT_OFFSET + 16).uncompress16(); }
            if (totalTokens > 2) { endWeights[2] = poolState.decodeUint16(_END_WEIGHT_OFFSET + 32).uncompress16(); }
            if (totalTokens > 3) { endWeights[3] = poolState.decodeUint16(_END_WEIGHT_OFFSET + 48).uncompress16(); }
        }
    }

    /**
     * @dev Can pause/unpause trading
     */
    function setSwapEnabled(bool _swapEnabled) external authenticate whenNotPaused nonReentrant {
        _setSwapEnabled(_swapEnabled);
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
        // solhint-disable-next-line not-rely-on-time
        uint256 currentTime = block.timestamp;

        // Must specify normalized weights for all tokens
        uint256 totalTokens = _getTotalTokens();
        InputHelpers.ensureInputLengthMatch(totalTokens, endWeights.length);

        // If the start time is in the past, "fast forward" to start now
        // This avoids discontinuities in the weight curve. Otherwise, if you set the start/end times with
        // only 10% of the period in the future, the weights would immediately jump 90%
        uint256 effectiveStartTime = currentTime > startTime ? currentTime : startTime;

        _require(effectiveStartTime <= endTime, Errors.GRADUAL_UPDATE_TIME_TRAVEL);

        // If called while a current weight change is ongoing, set starting point to current weights
        // Initialize the memory variable that will be written to storage at the end
        // This has the current state, with the start time set, and (if applicable), the start weights adjusted
        // This reads the poolState from storage, makes changes, and returns it as newPoolState
        (bytes32 newPoolState, uint256[] memory startWeights) = _initializeGradualWeightUpdate(
            totalTokens,
            effectiveStartTime,
            endTime
        );

        // Validate and fill in the end weights
        uint256 sumWeights = 0;

        for (uint8 i = 0; i < totalTokens; i++) {
            _require(endWeights[i] >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

            // update the end weights in memory
            newPoolState = newPoolState.insertUint16(endWeights[i].compress16(), _END_WEIGHT_OFFSET + i * 16);

            sumWeights = sumWeights.add(endWeights[i]);
        }

        _require(sumWeights == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _poolState = newPoolState;

        emit GradualWeightUpdateScheduled(effectiveStartTime, endTime, startWeights, endWeights);
    }

    // Internal functions

    function _getNormalizedWeight(IERC20 token) internal view override returns (uint256) {
        uint8 i;

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

    function _getNormalizedWeightByIndex(uint8 i, bytes32 poolState) internal view returns (uint256) {
        uint256 startWeight = poolState.decodeUint32(i * 32).uncompress32();
        uint256 endWeight = poolState.decodeUint16(_END_WEIGHT_OFFSET + i * 16).uncompress16();

        // Return 0 - 1 value representing how much of the period has elapsed
        // Will return 0 if it hasn't started, and 1 if it's past the end
        uint256 pctProgress = _calculateProgress(poolState);

        return _interpolateWeight(startWeight, endWeight, pctProgress);
    }

    function _getNormalizedWeights() internal view override returns (uint256[] memory) {
        uint256 totalTokens = _getTotalTokens();
        uint256[] memory normalizedWeights = new uint256[](totalTokens);

        bytes32 poolState = _poolState;

        // prettier-ignore
        {
            if (totalTokens > 0) { normalizedWeights[0] = _getNormalizedWeightByIndex(0, poolState);
            } else { return normalizedWeights; }
            if (totalTokens > 1) { normalizedWeights[1] = _getNormalizedWeightByIndex(1, poolState);
            } else { return normalizedWeights; }
            if (totalTokens > 2) { normalizedWeights[2] = _getNormalizedWeightByIndex(2, poolState);
            } else { return normalizedWeights; }
            if (totalTokens > 3) { normalizedWeights[3] = _getNormalizedWeightByIndex(3, poolState);
            } else { return normalizedWeights; }
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

        for (uint8 i = 0; i < normalizedWeights.length; i++) {
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
        bytes memory userData
    ) internal override whenNotPaused returns (uint256, uint256[] memory) {
        // Only the owner can initialize the pool
        _require(sender == getOwner(), Errors.SENDER_NOT_ALLOWED);

        return super._onInitializePool(poolId, sender, recipient, userData);
    }

    function _onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        internal
        override
        whenNotPaused
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        // Only the owner can add liquidity; block public LPs
        _require(sender == getOwner(), Errors.SENDER_NOT_ALLOWED);

        return
            super._onJoinPool(
                poolId,
                sender,
                recipient,
                balances,
                lastChangeBlock,
                protocolSwapFeePercentage,
                userData
            );
    }

    // Swap overrides - revert unless swaps are enabled

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view override whenNotPaused returns (uint256) {
        _require(swapEnabled, Errors.SWAPS_PAUSED);

        return super._onSwapGivenIn(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view override whenNotPaused returns (uint256) {
        _require(swapEnabled, Errors.SWAPS_PAUSED);

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

    // What proportion of the total weight change duration has elapsed?
    function _calculateProgress(bytes32 poolState) private view returns (uint256) {
        // solhint-disable-next-line not-rely-on-time
        uint256 currentTime = block.timestamp;
        uint256 startTime = poolState.decodeUint32(_START_TIME_OFFSET);
        uint256 endTime = poolState.decodeUint32(_END_TIME_OFFSET);

        // Ensure current time is always between startTime and endTime, so the computation will always work
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
     * if necessary. Since it is called from a view function, read from storage and call in memory
     */
    function _initializeGradualWeightUpdate(
        uint256 totalTokens,
        uint256 startTime,
        uint256 endTime
    ) private view returns (bytes32, uint256[] memory) {
        // A weight change is (or was) in progress, we need to nodify the start weights
        bytes32 poolState = _poolState;

        uint256[] memory normalizedWeights = _getNormalizedWeights();

        // Copy current weights to start weights
        for (uint8 i = 0; i < totalTokens; i++) {
            poolState = poolState.insertUint32(normalizedWeights[i].compress32(), i * 32);
        }

        // Reset the timestamps
        poolState = poolState.insertUint32(startTime, _START_TIME_OFFSET);
        return (poolState.insertUint32(endTime, _END_TIME_OFFSET), normalizedWeights);
    }

    function _interpolateWeight(
        uint256 startWeight,
        uint256 endWeight,
        uint256 pctProgress
    ) private pure returns (uint256) {
        if (pctProgress == 0) return startWeight;
        if (pctProgress == FixedPoint.ONE) return endWeight;

        uint256 totalWeightChange = endWeight < startWeight ? startWeight.sub(endWeight) : endWeight.sub(startWeight);
        uint256 weightDelta = pctProgress.mulDown(totalWeightChange);

        return endWeight < startWeight ? startWeight.sub(weightDelta) : startWeight.add(weightDelta);
    }

    function _setSwapEnabled(bool _swapEnabled) private {
        swapEnabled = _swapEnabled;

        emit SwapEnabledSet(_swapEnabled);
    }
}
