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
contract InvestmentPool is BaseWeightedPool, ReentrancyGuard {
    // The Pause Window and Buffer Period are timestamp-based: they should not be relied upon for sub-minute accuracy.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using WordCodec for bytes32;
    using WeightCompression for uint256;

    // State variables

    // The current number of tokens in the pool
    // Technically redundant; cached here to avoid calling getTokens on the pool,
    //   which would be very gas-intensive for large numbers of tokens
    uint256 private _totalTokens;

    // Store scaling factor and start/end weights for each token
    // Mapping should be more efficient than trying to compress it further
    // into a fixed array of bytes32 or something like that, especially
    // since tokens can be added/removed - and re-ordered in the process
    // For each token, we store:
    // [ 155 bits|   5 bits |  32 bits   |   64 bits    |
    // [ unused  | decimals | end weight | start weight |
    // |MSB                                          LSB|
    mapping(IERC20 => bytes32) private _poolState;

    uint256 private constant _START_WEIGHT_OFFSET = 0;
    uint256 private constant _END_WEIGHT_OFFSET = 64;
    uint256 private constant _DECIMAL_DIFF_OFFSET = 96;

    // Time travel comment
    // [ 192 bits | 32 bits  |  32 bits   |
    // [  unused  | end time | start time |
    // |MSB                            LSB|
    //bytes32 private _gradualUpdateTimestamps;

    //uint256 private constant _START_TIME_OFFSET = 0;
    //uint256 private constant _END_TIME_OFFSET = 32;

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory normalizedWeights,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        BaseWeightedPool(
            vault,
            name,
            symbol,
            tokens,
            new address[](tokens.length), // Pass the zero address: Investment Pools can't have asset managers
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        uint256 numTokens = tokens.length;
        InputHelpers.ensureInputLengthMatch(numTokens, normalizedWeights.length);

        _totalTokens = numTokens;

        // I'm time-traveling a bit here - storing the weights in a form where they can be changed
        uint256 currentTime = block.timestamp;
        _startGradualWeightChange(currentTime, currentTime, normalizedWeights, normalizedWeights, tokens);
    }

    function _getMaxTokens() internal pure virtual override returns (uint256) {
        return _MAX_WEIGHTED_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _totalTokens;
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        bytes32 tokenData = _poolState[token];

        // A valid token can't be zero (would have scaling at least)
        if (tokenData == 0) {
            _revert(Errors.INVALID_TOKEN);
        }

        return _computeScalingFactor(tokenData);
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory scalingFactors) {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 numTokens = tokens.length;

        scalingFactors = new uint256[](numTokens);

        for (uint256 i = 0; i < numTokens; i++) {
            scalingFactors[i] = _computeScalingFactor(_poolState[tokens[i]]);
        }
    }

    function _getNormalizedWeight(IERC20 token) internal view override returns (uint256) {
        bytes32 tokenData = _poolState[token];

        // A valid token can't be zero (would have timestamps at least)
        if (tokenData == 0) {
            _revert(Errors.INVALID_TOKEN);
        }

        uint256 startWeight = tokenData.decodeUint64(_START_WEIGHT_OFFSET).uncompress64();
        uint256 endWeight = tokenData.decodeUint32(_END_WEIGHT_OFFSET).uncompress32();

        uint256 pctProgress = _calculateWeightChangeProgress();

        return _interpolateWeight(startWeight, endWeight, pctProgress);
    }

    function _getNormalizedWeights() internal view override returns (uint256[] memory normalizedWeights) {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 numTokens = tokens.length;

        normalizedWeights = new uint256[](numTokens);

        uint256 pctProgress = _calculateWeightChangeProgress();

        for (uint256 i = 0; i < numTokens; i++) {
            bytes32 tokenData = _poolState[tokens[i]];

            uint256 startWeight = tokenData.decodeUint64(_START_WEIGHT_OFFSET).uncompress64();
            uint256 endWeight = tokenData.decodeUint32(_END_WEIGHT_OFFSET).uncompress32();

            normalizedWeights[i] = _interpolateWeight(startWeight, endWeight, pctProgress);
        }
    }

    function _getNormalizedWeightsAndMaxWeightIndex() internal view override returns (uint256[] memory, uint256) {
        uint256[] memory normalizedWeights = _getNormalizedWeights();

        uint256 maxNormalizedWeight = 0;
        uint256 maxWeightTokenIndex;

        // NOTE: could cache this in the _getNormalizedWeights function and avoid double iteratio,
        // but it's a view function
        for (uint256 i = 0; i < normalizedWeights.length; i++) {
            if (normalizedWeights[i] > maxNormalizedWeight) {
                maxWeightTokenIndex = i;
                maxNormalizedWeight = normalizedWeights[i];
            }
        }

        return (normalizedWeights, maxWeightTokenIndex);
    }

    /**
     * @dev When calling updateWeightsGradually again during an update, reset the start weights to the current weights,
     * if necessary. Time travel elements commented out.
     */
    function _startGradualWeightChange(
        uint256, // startTime,
        uint256, // endTime,
        uint256[] memory startWeights,
        uint256[] memory endWeights,
        IERC20[] memory tokens
    ) internal virtual {
        //bytes32 newTimestamps = _gradualUpdateTimestamps;
        bytes32 tokenState;

        uint256 normalizedSum = 0;

        for (uint256 i = 0; i < endWeights.length; i++) {
            uint256 endWeight = endWeights[i];
            _require(endWeight >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

            IERC20 token = tokens[i];

            tokenState = tokenState.insertUint64(startWeights[i].compress64(), _START_WEIGHT_OFFSET);
            tokenState = tokenState.insertUint32(endWeight.compress32(), _END_WEIGHT_OFFSET);

            // Tokens with more than 18 decimals are not supported.
            uint256 decimalsDifference = 18; //Math.sub(18, ERC20(address(token)).decimals());

            tokenState = tokenState.insertUint5(
                decimalsDifference.sub(ERC20(address(token)).decimals()),
                _DECIMAL_DIFF_OFFSET
            );

            _poolState[token] = tokenState;

            normalizedSum = normalizedSum.add(endWeight);
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        //newTimestamps = newTimestamps.insertUint32(startTime, _START_TIME_OFFSET);
        //newTimestamps = newTimestamps.insertUint32(endTime, _END_TIME_OFFSET);

        //_gradualUpdateTimestamps = newTimestamps;

        //emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);
    }

    function _computeScalingFactor(bytes32 tokenState) private view returns (uint256) {
        uint256 decimalsDifference = tokenState.decodeUint5(_DECIMAL_DIFF_OFFSET);

        return FixedPoint.ONE * 10**decimalsDifference;
    }

    // Private functions

    /**
     * @dev Returns a fixed-point number representing how far along the current weight change is, where 0 means the
     * change has not yet started, and FixedPoint.ONE means it has fully completed.
     */
    function _calculateWeightChangeProgress() private view returns (uint256) {
        /*uint256 currentTime = block.timestamp;
        uint256 startTime = _gradualUpdateTimestamps.decodeUint32(_START_TIME_OFFSET);
        uint256 endTime = _gradualUpdateTimestamps.decodeUint32(_END_TIME_OFFSET);

        if (currentTime > endTime) {
            return FixedPoint.ONE;
        } else if (currentTime < startTime) {
            return 0;
        }

        uint256 totalSeconds = endTime.sub(startTime);
        uint256 secondsElapsed = currentTime.sub(startTime);

        // In the degenerate case of a zero duration change, consider it completed (and avoid division by zero)
        return totalSeconds == 0 ? FixedPoint.ONE : secondsElapsed.divDown(totalSeconds);*/

        return 0;
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
}
