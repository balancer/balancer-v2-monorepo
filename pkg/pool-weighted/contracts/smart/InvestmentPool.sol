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
import "../WeightedPoolUserDataHelpers.sol";
import "./WeightCompression.sol";

/**
 * @dev Weighted Pool with mutable weights, designed to support investment use cases: large token counts,
 * rebalancing through gradual weight updates.
 */
contract InvestmentPool is BaseWeightedPool, ReentrancyGuard {
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using WordCodec for bytes32;
    using WeightCompression for uint256;
    using WeightedPoolUserDataHelpers for bytes;

    // State variables

    // Use the _miscData slot in BasePool
    // First 64 bits are reserved for the swap fee
    //
    // Store non-token-based values:
    // Start/end timestamps for gradual weight update
    // Cache total tokens
    // [ 64 bits  |  120 bits |  32 bits  |   32 bits  |    7 bits    |    1 bit     ]
    // [ reserved |  unused   | end time  | start time | total tokens |   swap flag  ]
    // |MSB                                                                       LSB|
    uint256 private constant _SWAP_ENABLED_OFFSET = 0;
    uint256 private constant _TOTAL_TOKENS_OFFSET = 1;
    uint256 private constant _START_TIME_OFFSET = 8;
    uint256 private constant _END_TIME_OFFSET = 40;
    // 7 bits is enough for the token count, since MAX_WEIGHTED_TOKENS is 100

    // Store scaling factor and start/end weights for each token
    // Mapping should be more efficient than trying to compress it further
    // [ 27 bits |  5 bits  |  112 bits | 8 bits | 8 bits |  32 bits   |   64 bits    |
    // [ unused  | decimals | ref price | min R  | max R  | end weight | start weight |
    // |MSB                                                                        LSB|
    mapping(IERC20 => bytes32) private _tokenState;

    uint256 private constant _START_WEIGHT_OFFSET = 0;
    uint256 private constant _END_WEIGHT_OFFSET = 64;
    uint256 private constant _MAX_RATIO_OFFSET = 96;
    uint256 private constant _MIN_RATIO_OFFSET = 104;
    uint256 private constant _REF_BPT_PRICE_OFFSET = 112;
    uint256 private constant _DECIMAL_DIFF_OFFSET = 224;

    uint256 private constant _MIN_CIRCUIT_BREAKER_RATIO = 0.1e18;
    uint256 private constant _MAX_CIRCUIT_BREAKER_RATIO = 10e18;

    uint256 private constant _MINIMUM_WEIGHT_CHANGE_DURATION = 1 days;

    // Event declarations

    event GradualWeightUpdateScheduled(
        uint256 startTime,
        uint256 endTime,
        uint256[] startWeights,
        uint256[] endWeights
    );
    event SwapEnabledSet(bool swapEnabled);
    event CircuitBreakerRatioSet(address indexed token, uint256 minRatio, uint256 maxRatio);

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory normalizedWeights,
        address[] memory assetManagers,
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
            assetManagers,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        uint256 totalTokens = tokens.length;
        InputHelpers.ensureInputLengthMatch(totalTokens, normalizedWeights.length, assetManagers.length);

        _setMiscData(_getMiscData().insertUint7(totalTokens, _TOTAL_TOKENS_OFFSET));
        // Double check it fits in 7 bits
        _require(_getTotalTokens() == totalTokens, Errors.MAX_TOKENS);

        uint256 currentTime = block.timestamp;
        _startGradualWeightChange(currentTime, currentTime, normalizedWeights, normalizedWeights, tokens);

        // If false, the pool will start in the disabled state (prevents front-running the enable swaps transaction)
        _setSwapEnabled(swapEnabledOnStart);
    }

    // External functions

    /**
     * @dev Indicates whether swaps are enabled or not for the given pool.
     */
    function getSwapEnabled() public view returns (bool) {
        return _getMiscData().decodeBool(_SWAP_ENABLED_OFFSET);
    }

    /**
     * @dev Returns the mimimum duration of a gradual weight change
     */
    function getMinimumWeightChangeDuration() external pure returns (uint256) {
        return _MINIMUM_WEIGHT_CHANGE_DURATION;
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
        bytes32 poolState = _getMiscData();

        startTime = poolState.decodeUint32(_START_TIME_OFFSET);
        endTime = poolState.decodeUint32(_END_TIME_OFFSET);

        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 totalTokens = tokens.length;

        endWeights = new uint256[](totalTokens);

        for (uint256 i = 0; i < totalTokens; i++) {
            endWeights[i] = _tokenState[tokens[i]].decodeUint32(_END_WEIGHT_OFFSET).uncompress32();
        }
    }

    function _getMaxTokens() internal pure virtual override returns (uint256) {
        return _MAX_WEIGHTED_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _getMiscData().decodeUint7(_TOTAL_TOKENS_OFFSET);
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
        startTime = Math.max(currentTime, startTime);

        _require(startTime <= endTime, Errors.GRADUAL_UPDATE_TIME_TRAVEL);
        _require(endTime - startTime >= _MINIMUM_WEIGHT_CHANGE_DURATION, Errors.WEIGHT_CHANGE_TOO_FAST);

        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());

        _startGradualWeightChange(startTime, endTime, _getNormalizedWeights(), endWeights, tokens);
    }

    /*
     * @dev Can enable/disable trading
     */
    function setSwapEnabled(bool swapEnabled) external authenticate whenNotPaused nonReentrant {
        _setSwapEnabled(swapEnabled);
    }

    function _setSwapEnabled(bool swapEnabled) private {
        _setMiscData(_getMiscData().insertBool(swapEnabled, _SWAP_ENABLED_OFFSET));

        emit SwapEnabledSet(swapEnabled);
    }

    /**
     * @dev Update the circuit breaker ratios
     */
    function setCircuitBreakerRatio(uint256[] memory minRatios, uint256[] memory maxRatios)
        external
        authenticate
        whenNotPaused
        nonReentrant
    {
        InputHelpers.ensureInputLengthMatch(_getTotalTokens(), minRatios.length, maxRatios.length);

        uint256 supply = totalSupply();

        (IERC20[] memory tokens, uint256[] memory balances, ) = getVault().getPoolTokens(getPoolId());
        uint256[] memory normalizedWeights = _getNormalizedWeights();

        for (uint256 i = 0; i < tokens.length; i++) {
            // Can we remove? - if so, pass through 0s? - maybe leave it and document that we can't remove it.
            // Or do you have to set it on every token?
            if (minRatios[i] != 0 || maxRatios[i] != 0) {
                // priceOfTokenInBpt = totalSupply / (token.balance / token.weight)
                _setCircuitBreakerRatio(
                    tokens[i],
                    supply.divUp(balances[i].divDown(normalizedWeights[i])),
                    minRatios[i],
                    maxRatios[i]
                );
            }
        }
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        return _readScalingFactor(_getTokenData(token));
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory scalingFactors) {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 numTokens = tokens.length;

        scalingFactors = new uint256[](numTokens);

        for (uint256 i = 0; i < numTokens; i++) {
            scalingFactors[i] = _readScalingFactor(_tokenState[tokens[i]]);
        }
    }

    function _getNormalizedWeight(IERC20 token) internal view override returns (uint256) {
        uint256 pctProgress = _calculateWeightChangeProgress();
        bytes32 tokenData = _getTokenData(token);

        return _interpolateWeight(tokenData, pctProgress);
    }

    function _getNormalizedWeights() internal view override returns (uint256[] memory normalizedWeights) {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 numTokens = tokens.length;

        normalizedWeights = new uint256[](numTokens);

        uint256 pctProgress = _calculateWeightChangeProgress();

        for (uint256 i = 0; i < numTokens; i++) {
            bytes32 tokenData = _tokenState[tokens[i]];

            normalizedWeights[i] = _interpolateWeight(tokenData, pctProgress);
        }
    }

    function _getNormalizedWeightsAndMaxWeightIndex()
        internal
        view
        override
        returns (uint256[] memory normalizedWeights, uint256 maxWeightTokenIndex)
    {
        normalizedWeights = _getNormalizedWeights();

        maxWeightTokenIndex = 0;
        uint256 maxNormalizedWeight = normalizedWeights[0];

        for (uint256 i = 1; i < normalizedWeights.length; i++) {
            if (normalizedWeights[i] > maxNormalizedWeight) {
                maxWeightTokenIndex = i;
                maxNormalizedWeight = normalizedWeights[i];
            }
        }
    }

    // Swap overrides - revert unless swaps are enabled

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view override returns (uint256 tokenOutAmount) {
        _require(getSwapEnabled(), Errors.SWAPS_DISABLED);

        // Check that the final amount in (= currentBalance + swap amount) doesn't trip the breaker
        // Higher balance = lower BPT price
        // Upper Bound check means BptPrice must be >= startPrice/MaxRatio
        _checkCircuitBreakerUpperBound(
            _tokenState[swapRequest.tokenIn],
            currentBalanceTokenIn.add(swapRequest.amount),
            swapRequest.tokenIn
        );

        // Since amountIn is valid, calculate the amount out (price quote), and check
        // that it doesn't trip that token's breaker
        tokenOutAmount = super._onSwapGivenIn(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);

        // Lower Bound check means BptPrice must be <= startPrice/MinRatio
        _checkCircuitBreakerLowerBound(
            _tokenState[swapRequest.tokenOut],
            currentBalanceTokenOut.sub(tokenOutAmount),
            swapRequest.tokenOut
        );
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view override returns (uint256 amountIn) {
        _require(getSwapEnabled(), Errors.SWAPS_DISABLED);

        // Check that the final amount in (= currentBalance + swap amount) doesn't trip the breaker
        // Higher balance = lower BPT price
        // Upper Bound check means BptPrice must be >= startPrice/MaxRatio
        _checkCircuitBreakerUpperBound(
            _tokenState[swapRequest.tokenOut],
            currentBalanceTokenOut.add(swapRequest.amount),
            swapRequest.tokenOut
        );

        amountIn = super._onSwapGivenOut(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);

        // Lower Bound check means BptPrice must be <= startPrice/MinRatio
        _checkCircuitBreakerLowerBound(
            _tokenState[swapRequest.tokenIn],
            currentBalanceTokenIn.sub(amountIn),
            swapRequest.tokenIn
        );
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
            uint256 bptAmountOut,
            uint256[] memory amountsIn,
            uint256[] memory dueProtocolFeeAmounts
        )
    {
        // If swaps are disabled, the only join kind that is allowed is the proportional one, as all others involve
        // implicit swaps and alter token prices.
        _require(
            getSwapEnabled() || userData.joinKind() == JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT,
            Errors.INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED
        );

        (bptAmountOut, amountsIn, dueProtocolFeeAmounts) = super._onJoinPool(
            poolId,
            sender,
            recipient,
            balances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            scalingFactors,
            userData
        );

        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());

        for (uint256 i = 0; i < _getTotalTokens(); i++) {
            // Check that the final amount in (= currentBalance + swap amount) doesn't trip the breaker
            // Higher balance = lower BPT price
            // Upper Bound check means BptPrice must be >= startPrice/MaxRatio
            IERC20 token = tokens[i];

            _checkCircuitBreakerUpperBound(_tokenState[token], balances[i].add(amountsIn[i]), token);
        }
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
            uint256 bptAmountIn,
            uint256[] memory amountsOut,
            uint256[] memory dueProtocolFeeAmounts
        )
    {
        // If swaps are disabled, the only exit kind that is allowed is the proportional one, as all others involve
        // implicit swaps and alter token prices.
        _require(
            getSwapEnabled() || userData.exitKind() == ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT,
            Errors.INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED
        );

        (bptAmountIn, amountsOut, dueProtocolFeeAmounts) = super._onExitPool(
            poolId,
            sender,
            recipient,
            balances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            scalingFactors,
            userData
        );

        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());

        for (uint256 i = 0; i < _getTotalTokens(); i++) {
            // Check that the final amount in (= currentBalance + swap amount) doesn't trip the breaker
            // Higher balance = lower BPT price
            // Upper Bound check means BptPrice must be >= startPrice/MaxRatio
            IERC20 token = tokens[i];

            _checkCircuitBreakerLowerBound(_tokenState[token], balances[i].sub(amountsOut[i]), token);
        }
    }

    /**
     * @dev When calling updateWeightsGradually again during an update, reset the start weights to the current weights,
     * if necessary. Time travel elements commented out.
     */
    function _startGradualWeightChange(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory startWeights,
        uint256[] memory endWeights,
        IERC20[] memory tokens
    ) internal virtual {
        uint256 normalizedSum = 0;
        bytes32 tokenState;

        for (uint256 i = 0; i < endWeights.length; i++) {
            uint256 endWeight = endWeights[i];
            _require(endWeight >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

            IERC20 token = tokens[i];

            // Tokens with more than 18 decimals are not supported
            // Scaling calculations must be exact/lossless
            // Store decimal difference instead of actual scaling factor
            _tokenState[token] = tokenState
                .insertUint64(startWeights[i].compress64(), _START_WEIGHT_OFFSET)
                .insertUint32(endWeight.compress32(), _END_WEIGHT_OFFSET)
                .insertUint5(uint256(18).sub(ERC20(address(token)).decimals()), _DECIMAL_DIFF_OFFSET);

            normalizedSum = normalizedSum.add(endWeight);
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _setMiscData(
            _getMiscData().insertUint32(startTime, _START_TIME_OFFSET).insertUint32(endTime, _END_TIME_OFFSET)
        );

        emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);
    }

    // If the ratio is 0, there is no breaker in this direction on this token
    function _checkCircuitBreakerUpperBound(
        bytes32 tokenData,
        uint256 endingBalance,
        IERC20 token
    ) private view {
        uint256 maxRatio = _decodeRatio(tokenData.decodeUint8(_MAX_RATIO_OFFSET).uncompress8());

        if (maxRatio != 0) {
            uint256 initialPrice = tokenData.decodeUint112(_REF_BPT_PRICE_OFFSET);
            uint256 lowerBound = initialPrice.divUp(maxRatio);

            // Validate that token price is within bounds
            // Can be front run!
            // Once turned on, all need to have values
            // BPT price can be manipulated - but lower bound protects against most of it
            // can snapshot
            uint256 finalPrice = totalSupply().divDown(endingBalance.divUp(_getNormalizedWeight(token)));
            _require(finalPrice >= lowerBound, Errors.CIRCUIT_BREAKER_TRIPPED_MAX_RATIO);
        }
    }

    function _checkCircuitBreakerLowerBound(
        bytes32 tokenData,
        uint256 endingBalance,
        IERC20 token
    ) private view {
        uint256 minRatio = _decodeRatio(tokenData.decodeUint8(_MIN_RATIO_OFFSET).uncompress8());

        // If the ratio is 0, there is no breaker in this direction on this token
        if (minRatio != 0) {
            uint256 initialPrice = tokenData.decodeUint112(_REF_BPT_PRICE_OFFSET);
            uint256 upperBound = initialPrice.divDown(minRatio);

            // Validate that token price is within bounds
            uint256 finalPrice = totalSupply().divUp(endingBalance.divDown(_getNormalizedWeight(token)));
            _require(finalPrice <= upperBound, Errors.CIRCUIT_BREAKER_TRIPPED_MIN_RATIO);
        }
    }

    function _readScalingFactor(bytes32 tokenState) private pure returns (uint256) {
        uint256 decimalsDifference = tokenState.decodeUint5(_DECIMAL_DIFF_OFFSET);

        return FixedPoint.ONE * 10**decimalsDifference;
    }

    /**
     * @dev Extend ownerOnly functions to include the Investment Pool control functions
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view override returns (bool) {
        return
            (actionId == getActionId(InvestmentPool.updateWeightsGradually.selector)) ||
            (actionId == getActionId(InvestmentPool.setSwapEnabled.selector)) ||
            super._isOwnerOnlyAction(actionId);
    }

    // Private functions

    /**
     * @dev Returns a fixed-point number representing how far along the current weight change is, where 0 means the
     * change has not yet started, and FixedPoint.ONE means it has fully completed.
     */
    function _calculateWeightChangeProgress() private view returns (uint256) {
        uint256 currentTime = block.timestamp;
        bytes32 poolState = _getMiscData();

        uint256 startTime = poolState.decodeUint32(_START_TIME_OFFSET);
        uint256 endTime = poolState.decodeUint32(_END_TIME_OFFSET);

        if (currentTime > endTime) {
            return FixedPoint.ONE;
        } else if (currentTime < startTime) {
            return 0;
        }

        uint256 totalSeconds = endTime - startTime;
        uint256 secondsElapsed = currentTime - startTime;

        // In the degenerate case of a zero duration change, consider it completed (and avoid division by zero)
        return totalSeconds == 0 ? FixedPoint.ONE : secondsElapsed.divDown(totalSeconds);
    }

    function _interpolateWeight(bytes32 tokenData, uint256 pctProgress) private pure returns (uint256 finalWeight) {
        uint256 startWeight = tokenData.decodeUint64(_START_WEIGHT_OFFSET).uncompress64();
        uint256 endWeight = tokenData.decodeUint32(_END_WEIGHT_OFFSET).uncompress32();

        if (pctProgress == 0 || startWeight == endWeight) return startWeight;
        if (pctProgress >= FixedPoint.ONE) return endWeight;

        if (startWeight > endWeight) {
            uint256 weightDelta = pctProgress.mulDown(startWeight - endWeight);
            return startWeight.sub(weightDelta);
        } else {
            uint256 weightDelta = pctProgress.mulDown(endWeight - startWeight);
            return startWeight.add(weightDelta);
        }
    }

    function _setCircuitBreakerRatio(
        IERC20 token,
        uint256 initialPrice,
        uint256 minRatio,
        uint256 maxRatio
    ) internal {
        // Has to be > minRatio (if equal, encoded value would be 0, indistinguishable from no circuit breaker)
        _require(minRatio == 0 || minRatio > _MIN_CIRCUIT_BREAKER_RATIO, Errors.MIN_CIRCUIT_BREAKER_RATIO);
        _require(maxRatio == 0 || maxRatio <= _MAX_CIRCUIT_BREAKER_RATIO, Errors.MAX_CIRCUIT_BREAKER_RATIO);
        _require(maxRatio >= minRatio, Errors.INVALID_CIRCUIT_BREAKER_RATIOS);

        bytes32 tokenData = _tokenState[token];

        _tokenState[token] = tokenData
            .insertUint112(initialPrice, _REF_BPT_PRICE_OFFSET)
            .insertUint8(_encodeRatio(minRatio).compress8(), _MIN_RATIO_OFFSET)
            .insertUint8(_encodeRatio(maxRatio).compress8(), _MAX_RATIO_OFFSET);

        emit CircuitBreakerRatioSet(address(token), minRatio, maxRatio);
    }

    // Encoded value = (value - MIN)/range
    // e.g., if range is 0.1 - 10, 1.5 = (1.5 - 0.1)/9.9 = 0.1414
    function _encodeRatio(uint256 ratio) private pure returns (uint256) {
        return
            ratio == 0
                ? 0
                : (ratio - _MIN_CIRCUIT_BREAKER_RATIO) / (_MAX_CIRCUIT_BREAKER_RATIO - _MIN_CIRCUIT_BREAKER_RATIO);
    }

    // Scale back to a numeric ratio
    // 0.1 + 0.1414 * 9.9 ~ 1.5
    function _decodeRatio(uint256 ratio) private pure returns (uint256) {
        return
            ratio == 0
                ? 0
                : _MIN_CIRCUIT_BREAKER_RATIO + ratio * (_MAX_CIRCUIT_BREAKER_RATIO - _MIN_CIRCUIT_BREAKER_RATIO);
    }

    function _getTokenData(IERC20 token) private view returns (bytes32 tokenData) {
        tokenData = _tokenState[token];

        // A valid token can't be zero (must have non-zero weights)
        _require(tokenData != 0, Errors.INVALID_TOKEN);
    }
}
