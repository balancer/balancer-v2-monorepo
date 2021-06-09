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

/**
 * @dev Weighted Pool with mutable weights, designed to support V2 Liquidity Bootstrapping
 */
contract LiquidityBootstrappingPool is BaseWeightedPool, ReentrancyGuard {
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    uint256 private constant _MAX_LBP_TOKENS = 4;
    // Offsets for data elements in _poolState
    // Start weights begin at offset 0
    uint256 private constant _END_WEIGHT_OFFSET = 128;
    uint256 private constant _START_TIME_OFFSET = 160;
    uint256 private constant _END_TIME_OFFSET = 192;

    // State variables

    // Minimum time over which to compute a gradual weight change (i.e., seconds between timestamps)
    uint256 public immutable minWeightChangeDuration;

    // Setting this to false pauses trading
    bool public swapEnabled;

    // For gas optimization, store start/end weights and timestamps in one bytes32
    // Start weights need to be high precision, since restarting the update resets them to "spot"
    // values. Target end weights do not need as much precision; ~0.5% should be enough.
    // Could go as high as 39 bits for start weights, but 32 is more natural.
    // <---     128 bits     ---|---     32 bits    ---|---    64 bits    ----|
    // 4 x 32bit start weights  | 4 x 8bit end weights | 2 x 32bit timestamps |
    bytes32 private _poolState;

    // Event declarations

    event PublicSwapSet(bool swapEnabled);
    event GradualUpdateScheduled(uint256 startTime, uint256 endTime);

    // Modifiers

    /**
     * @dev Reverts unless sender is the owner
     */
    modifier onlyOwner() {
        _ensureOwner();
        _;
    }

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
        uint256 minDuration,
        bool publicSwap
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
        uint256 numTokens = tokens.length;
        _require(numTokens <= _MAX_LBP_TOKENS, Errors.MAX_TOKENS);

        InputHelpers.ensureInputLengthMatch(numTokens, normalizedWeights.length);

        bytes32 poolState;

        // Ensure each normalized weight is above the minimum
        uint256 normalizedSum = 0;
        for (uint8 i = 0; i < numTokens; i++) {
            uint256 normalizedWeight = normalizedWeights[i];
            _require(normalizedWeight >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

            // Insert "start weights" into poolState
            poolState = poolState.insertUint32(normalizedWeight, i * 32);

            normalizedSum = normalizedSum.add(normalizedWeight);
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        // Write initial pool state - all zeros except for the start weights
        _poolState = poolState;

        // If false, the sale will start in a paused state (prevents front-running the unpause transaction)
        swapEnabled = publicSwap;
        minWeightChangeDuration = minDuration;

        emit PublicSwapSet(publicSwap);
    }

    // External functions

    /**
     * @dev Can pause/unpause trading
     */
    function setPublicSwap(bool publicSwap) external onlyOwner whenNotPaused nonReentrant {
        swapEnabled = publicSwap;

        emit PublicSwapSet(publicSwap);
    }

    /**
     * @dev Schedule a gradual weight change, from the current weights to
     * the given endWeights, over startTime to endTime
     */
    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory endWeights
    ) external onlyOwner whenNotPaused nonReentrant {
        // solhint-disable-next-line not-rely-on-time
        uint256 currentTime = block.timestamp;

        _require(currentTime < endTime, Errors.GRADUAL_UPDATE_TIME_TRAVEL);

        // Must specify normalized weights for all tokens
        uint256 numTokens = _getTotalTokens();
        InputHelpers.ensureInputLengthMatch(numTokens, endWeights.length);

        // If the start time is in the past, "fast forward" to start now
        // This prevents circumventing the minimum weight change duration
        uint256 effectiveStartTime = currentTime > startTime ? currentTime : startTime;

        // Enforce a minimum time over which to make the changes
        // The also prevents endBlock <= startBlock
        _require(endTime.sub(effectiveStartTime) >= minWeightChangeDuration, Errors.WEIGHT_CHANGE_TIME_BELOW_MIN);

        // If called while a current weight change is ongoing, set starting point to current weights
        // Initialize the memory variable that will be written to storage at the end
        // This has the current state, with the start time set, and (if applicable), the start weights adjusted
        // This reads the poolState from storage, makes changes, and returns it as newPoolState
        bytes32 newPoolState = _initializeGradualWeightUpdate(numTokens, effectiveStartTime, endTime, currentTime);

        // Validate end weights, and set them in the poolState
        uint256 sumWeights = 0;

        for (uint8 i = 0; i < numTokens; i++) {
            _require(endWeights[i] >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

            // update the end weights in memory
            newPoolState = newPoolState.insertUint8(endWeights[i], _END_WEIGHT_OFFSET + i * 8);

            sumWeights = sumWeights.add(endWeights[i]);
        }

        _require(sumWeights == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _poolState = newPoolState;

        emit GradualUpdateScheduled(effectiveStartTime, endTime);
    }

    // External functions

    /**
     * @dev Return start time, end time, and endWeights as an array
     */
    function getGradualUpdateParams()
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
        uint256 numTokens = _getTotalTokens();
        endWeights = new uint256[](numTokens);

        // prettier-ignore
        {
            if (numTokens > 0) { endWeights[0] = poolState.decodeUint8(_END_WEIGHT_OFFSET); }
            if (numTokens > 1) { endWeights[1] = poolState.decodeUint8(_END_WEIGHT_OFFSET + 8); }
            if (numTokens > 2) { endWeights[2] = poolState.decodeUint8(_END_WEIGHT_OFFSET + 16); }
            if (numTokens > 3) { endWeights[3] = poolState.decodeUint8(_END_WEIGHT_OFFSET + 24); }
        }
    }

    // Public functions

    /**
     * @dev Given that the weight callbacks are all view functions, how do we reset the startTime to 0
     * after an update has passed the end block?
     * This can be called on non-view functions that access weights. It doesn't *have* to be called, but
     * gas will generally be slightly higher if it isn't. It's not called on swaps, since the overhead is
     * likely worse than letting it read the end weights.
     */
    function pokeWeights() public {
        bytes32 poolState = _poolState;

        if (
            poolState.decodeUint32(_START_TIME_OFFSET) != 0 &&
            // solhint-disable-next-line not-rely-on-time
            block.timestamp >= poolState.decodeUint32(_END_TIME_OFFSET)
        ) {
            _copyEndWeightsToStartWeights(_getTotalTokens(), poolState);

            // Set start time to 0 (completing a gradual weight update)
            // We don't clear the endTime, so you can detect whether a gradual update happened, and when it finished
            _poolState = poolState.insertUint32(0, _START_TIME_OFFSET);
        }
    }

    // Internal functions

    function _getNormalizedWeight(IERC20 token) internal view override returns (uint256) {
        uint8 i;

        // prettier-ignore
        if (token == _token0) { i = 0; }
        else if (token == _token1) { i = 1; }
        else if (token == _token2) { i = 2; }
        else if (token == _token3) { i = 3; }
        else {
            _revert(Errors.INVALID_TOKEN);
        }

        bytes32 poolState = _poolState;

        // solhint-disable-next-line not-rely-on-time
        uint256 currentTime = block.timestamp;
        uint256 startTime = poolState.decodeUint32(_START_TIME_OFFSET);

        if (startTime == 0 || currentTime <= startTime) {
            // If no update, or it hasn't started, return the start weight
            return poolState.decodeUint32(i * 32);
        } else if (currentTime >= poolState.decodeUint32(_END_TIME_OFFSET)) {
            // If we are at or past the end block, use the end weights
            return poolState.decodeUint8(_END_WEIGHT_OFFSET + i * 8);
        }

        // An update is in process; need to calculate the weight
        uint256 endTime = poolState.decodeUint32(_END_TIME_OFFSET);
        uint256 totalPeriod = endTime.sub(startTime);
        uint256 secondsElapsed = currentTime.sub(startTime);

        return
            _getDynamicWeight(
                poolState.decodeUint32(i * 32),
                poolState.decodeUint8(_END_WEIGHT_OFFSET + i * 8),
                totalPeriod,
                secondsElapsed
            );
    }

    function _getNormalizedWeights() internal view override returns (uint256[] memory) {
        // solhint-disable-next-line not-rely-on-time
        uint256 currentTime = block.timestamp;
        bytes32 poolState = _poolState;

        uint256 startTime = poolState.decodeUint32(_START_TIME_OFFSET);
        uint256 numTokens = _getTotalTokens();
        uint256[] memory normalizedWeights = new uint256[](numTokens);

        // If there's no update, or it hasn't started yet, return start weights
        // If the update is over, return the end weights
        // prettier-ignore
        {
            if (startTime == 0 || currentTime <= startTime) {
                if (numTokens > 0) { normalizedWeights[0] = poolState.decodeUint32(0); }
                else { return normalizedWeights; }
                if (numTokens > 1) { normalizedWeights[1] = poolState.decodeUint32(32); }
                else { return normalizedWeights; }
                if (numTokens > 2) { normalizedWeights[2] = poolState.decodeUint32(64); }
                else { return normalizedWeights; }
                if (numTokens > 3) { normalizedWeights[3] = poolState.decodeUint32(96); }
                else { return normalizedWeights; }
            } else if (currentTime >= poolState.decodeUint32(_END_TIME_OFFSET)) {
                if (numTokens > 0) { normalizedWeights[0] = poolState.decodeUint8(_END_WEIGHT_OFFSET); }
                else { return normalizedWeights; }
                if (numTokens > 1) { normalizedWeights[1] = poolState.decodeUint8(_END_WEIGHT_OFFSET + 8); }
                else { return normalizedWeights; }
                if (numTokens > 2) { normalizedWeights[2] = poolState.decodeUint8(_END_WEIGHT_OFFSET + 16); }
                else { return normalizedWeights; }
                if (numTokens > 3) { normalizedWeights[3] = poolState.decodeUint8(_END_WEIGHT_OFFSET + 24); }
                else { return normalizedWeights; }
            }
        }

        return _getDynamicWeights(poolState, numTokens, startTime, currentTime);
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

    /**
     * @dev Only the owner can join an LBP pool
     * Since all the callbacks that compute weights are view functions, we can't "reset" the gradual update state
     * during those callbacks. Do that on joins and exits (or if pokeWeights is explicitly called externally)
     */
    function _onJoinPool(
        bytes32,
        address,
        address,
        uint256[] memory balances,
        uint256,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        internal
        override
        onlyOwner
        whenNotPaused
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        // If a gradual weight update has completed, set the normalized weights in storage and clear startTime
        pokeWeights();

        return
            BaseWeightedPool._onJoinPool(0, address(0), address(0), balances, 0, protocolSwapFeePercentage, userData);
    }

    function _onExitPool(
        bytes32,
        address,
        address,
        uint256[] memory balances,
        uint256,
        uint256 protocolSwapFeePercentage,
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
        // If a gradual weight update has completed, set the normalized weights in storage and clear startTime
        pokeWeights();

        return
            BaseWeightedPool._onExitPool(0, address(0), address(0), balances, 0, protocolSwapFeePercentage, userData);
    }

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view override whenNotPaused returns (uint256) {
        // Swaps are disabled while the contract is paused.
        _require(swapEnabled, Errors.SWAPS_PAUSED);

        return BaseWeightedPool._onSwapGivenIn(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view override whenNotPaused returns (uint256) {
        // Swaps are disabled while the contract is paused.
        _require(swapEnabled, Errors.SWAPS_PAUSED);

        return BaseWeightedPool._onSwapGivenOut(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
    }

    // Private functions

    // For the onlyOnwer modifier
    function _ensureOwner() private view {
        _require(msg.sender == getOwner(), Errors.CALLER_NOT_OWNER);
    }

    /**
     * @dev When calling updateWeightsGradually again during an update, reset the start weights to the current weights,
     * if necessary. Since it is called from a view function, read from storage and call in memory
     */
    function _initializeGradualWeightUpdate(
        uint256 numTokens,
        uint256 startTime,
        uint256 endTime,
        uint256 currentTime
    ) private view returns (bytes32) {
        // A weight change is (or was) in progress, we need to nodify the start weights
        bytes32 poolState = _poolState;

        // If there is (or was) an ongoing weight update, need to adjust the start weights
        uint256 currentUpdateStartTime = poolState.decodeUint32(_START_TIME_OFFSET);
        if (currentUpdateStartTime != 0 && currentTime > currentUpdateStartTime) {
            // If we are past the endTime (and nothing called pokeWeights), copy the end weights to the start weights
            if (currentTime >= poolState.decodeUint32(_END_TIME_OFFSET)) {
                _copyEndWeightsToStartWeights(numTokens, poolState);
            } else {
                // If it's still ongoing, set the start weights to the current calculated weights
                uint256[] memory currentWeights = _getDynamicWeights(poolState, numTokens, startTime, currentTime);

                for (uint8 i = 0; i < numTokens; i++) {
                    poolState = poolState.insertUint32(currentWeights[i], i * 32);
                }
            }
        }

        // Reset the timestamps
        poolState = poolState.insertUint32(startTime, _START_TIME_OFFSET);
        return poolState.insertUint32(endTime, _END_TIME_OFFSET);
    }

    // Utility function to copy weights inside poolState
    function _copyEndWeightsToStartWeights(uint256 numTokens, bytes32 poolState) private pure {
        for (uint8 i = 0; i < numTokens; i++) {
            poolState = poolState.insertUint32(poolState.decodeUint8(_END_WEIGHT_OFFSET + i * 8), i * 32);
        }
    }

    function _getDynamicWeights(
        bytes32 poolState,
        uint256 numTokens,
        uint256 startTime,
        uint256 currentTime
    ) private pure returns (uint256[] memory) {
        // Only calculate this once
        uint256 totalPeriod = poolState.decodeUint32(_END_TIME_OFFSET).sub(startTime);
        uint256 secondsElapsed = currentTime.sub(startTime);
        uint256[] memory normalizedWeights = new uint256[](numTokens);

        // prettier-ignore
        {
            if (numTokens > 0) { normalizedWeights[0] =
                _getDynamicWeight(poolState.decodeUint32(0), poolState.decodeUint8(_END_WEIGHT_OFFSET),
                                  totalPeriod, secondsElapsed);
            } else { return normalizedWeights; }
            if (numTokens > 1) { normalizedWeights[1] =
                _getDynamicWeight(poolState.decodeUint32(32), poolState.decodeUint8(_END_WEIGHT_OFFSET + 8),
                                  totalPeriod, secondsElapsed);
            } else { return normalizedWeights; }
            if (numTokens > 2) { normalizedWeights[2] =
                _getDynamicWeight(poolState.decodeUint32(64), poolState.decodeUint8(_END_WEIGHT_OFFSET + 16),
                                  totalPeriod, secondsElapsed);
            } else { return normalizedWeights; }
            if (numTokens > 3) { normalizedWeights[3] =
                _getDynamicWeight(poolState.decodeUint32(96), poolState.decodeUint8(_END_WEIGHT_OFFSET + 24),
                                  totalPeriod, secondsElapsed);
            } else { return normalizedWeights; }
        }
    }

    /**
     * @dev If there is no ongoing weight update, just return the normalizedWeights from storage
     * If there's an ongoing weight update, but we're at or past the end block, return the endWeights.
     * If we're in the middle of an update, calculate the current weight by linear interpolation.
     */
    function _getDynamicWeight(
        uint256 startWeight,
        uint256 endWeight,
        uint256 totalPeriod,
        uint256 secondsElapsed
    ) private pure returns (uint256) {
        // If no change, return fixed value
        if (startWeight == endWeight) {
            return startWeight;
        }

        uint256 totalDelta = endWeight < startWeight ? startWeight.sub(endWeight) : endWeight.sub(startWeight);
        uint256 currentDelta = secondsElapsed.mulDown(totalDelta.divDown(totalPeriod));

        return endWeight < startWeight ? startWeight.sub(currentDelta) : startWeight.add(currentDelta);
    }
}
