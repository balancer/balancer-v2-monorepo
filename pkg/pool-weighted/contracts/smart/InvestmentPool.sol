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
import "../WeightedPoolUserDataHelpers.sol";

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

    // This is the percentage of the swap fee retained by the pool owner
    // Ensure the sum of the protocol and managemnet fee can never exceed 1.0 (or we would be draining the pool)
    // ProtocolFeesCollector._MAX_PROTOCOL_SWAP_FEE_PERCENTAGE = 50e16
    uint256 public constant MAX_MGMT_FEE_PERCENTAGE = 50e16; // (1 - MAX protocol fee) = 50%

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

    uint256 private immutable _managementFeePercentage;

    // Store collected management fees by token
    mapping(IERC20 => uint256) private _collectedManagementFees;

    // Store scaling factor and start/end weights for each token
    // Mapping should be more efficient than trying to compress it further
    // [ 155 bits|   5 bits |  32 bits   |   64 bits    |
    // [ unused  | decimals | end weight | start weight |
    // |MSB                                          LSB|
    mapping(IERC20 => bytes32) private _tokenState;

    uint256 private constant _START_WEIGHT_OFFSET = 0;
    uint256 private constant _END_WEIGHT_OFFSET = 64;
    uint256 private constant _DECIMAL_DIFF_OFFSET = 96;

    uint256 private constant _MINIMUM_WEIGHT_CHANGE_DURATION = 1 days;

    // Event declarations

    event GradualWeightUpdateScheduled(
        uint256 startTime,
        uint256 endTime,
        uint256[] startWeights,
        uint256[] endWeights
    );
    event SwapEnabledSet(bool swapEnabled);
    event ManagementFeePercentageSet(uint256 managementFee);

    struct NewPoolParams {
        IVault vault;
        string name;
        string symbol;
        IERC20[] tokens;
        uint256[] normalizedWeights;
        address[] assetManagers;
        uint256 swapFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        address owner;
        bool swapEnabledOnStart;
        uint256 managementFeePercentage;
    }

    constructor(NewPoolParams memory params)
        BaseWeightedPool(
            params.vault,
            params.name,
            params.symbol,
            params.tokens,
            params.assetManagers,
            params.swapFeePercentage,
            params.pauseWindowDuration,
            params.bufferPeriodDuration,
            params.owner
        )
    {
        uint256 totalTokens = params.tokens.length;
        InputHelpers.ensureInputLengthMatch(totalTokens, params.normalizedWeights.length, params.assetManagers.length);

        _setMiscData(_getMiscData().insertUint7(totalTokens, _TOTAL_TOKENS_OFFSET));
        // Double check it fits in 7 bits
        _require(_getTotalTokens() == totalTokens, Errors.MAX_TOKENS);

        uint256 currentTime = block.timestamp;
        _startGradualWeightChange(
            currentTime,
            currentTime,
            params.normalizedWeights,
            params.normalizedWeights,
            params.tokens
        );

        // If false, the pool will start in the disabled state (prevents front-running the enable swaps transaction)
        _setSwapEnabled(params.swapEnabledOnStart);

        _require(params.managementFeePercentage <= MAX_MGMT_FEE_PERCENTAGE, Errors.MGMT_FEE_PERCENTAGE_TOO_HIGH);
        _managementFeePercentage = params.managementFeePercentage;

        emit ManagementFeePercentageSet(params.managementFeePercentage);
    }

    function getManagementFeePercentage() external view returns (uint256) {
        return _managementFeePercentage;
    }

    function getCollectedManagementFeeAmounts(IERC20[] memory tokens)
        external
        view
        returns (uint256[] memory feeAmounts)
    {
        feeAmounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];

            feeAmounts[i] = _collectedManagementFees[token];
        }
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
    ) internal view override returns (uint256) {
        _require(getSwapEnabled(), Errors.SWAPS_DISABLED);

        return super._onSwapGivenIn(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view override returns (uint256) {
        _require(getSwapEnabled(), Errors.SWAPS_DISABLED);

        return super._onSwapGivenOut(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
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

    function _readScalingFactor(bytes32 tokenState) private pure returns (uint256) {
        uint256 decimalsDifference = tokenState.decodeUint5(_DECIMAL_DIFF_OFFSET);

        return FixedPoint.ONE * 10**decimalsDifference;
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

        if (_managementFeePercentage != 0) {
            // If there is no protocol fee, dueProtocolFeeAmounts will be zero, so we need to do all the
            // same calculations
            if (protocolSwapFeePercentage == 0) {
                _collectManagementFeesFromBalances(balances);
            } else {
                // If there was a protocol fee, we can let the superclass do all the calculations,
                // and just use the results
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

                _collectManagementFeesFromAmounts(dueProtocolFeeAmounts, protocolSwapFeePercentage);

                return (bptAmountOut, amountsIn, dueProtocolFeeAmounts);
            }
        }

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

        if (userData.exitKind() == ExitKind.MANAGEMENT_FEE_TOKENS_OUT) {
            _require(sender == getOwner(), Errors.SENDER_NOT_ALLOWED);

            (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
            amountsOut = new uint256[](_getTotalTokens());

            for (uint256 i = 0; i < _getTotalTokens(); i++) {
                IERC20 token = tokens[i];

                amountsOut[i] = _upscale(_collectedManagementFees[token], _scalingFactor(token));
                delete _collectedManagementFees[token];
            }

            return (0, amountsOut, new uint256[](_getTotalTokens()));
        } else {
            if (_managementFeePercentage != 0) {
                // If there is no protocol fee, dueProtocolFeeAmounts will be zero,
                // so we need to do all the same calculations
                if (protocolSwapFeePercentage == 0) {
                    _collectManagementFeesFromBalances(balances);
                } else {
                    // If there was a protocol fee, we can let the superclass do all the calculations,
                    // and just use the results
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

                    // dueProtocolFeeAmounts[maxWeightTokenIndex] will have a non-zero value
                    // The management fee amount will be:
                    // managementFeePercentage / protocolSwapFeePercentage * dueProtocolFeeAmounts
                    _collectManagementFeesFromAmounts(dueProtocolFeeAmounts, protocolSwapFeePercentage);

                    return (bptAmountIn, amountsOut, dueProtocolFeeAmounts);
                }
            }

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
        }
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

    function _collectManagementFeesFromBalances(uint256[] memory balances) private {
        (uint256[] memory normalizedWeights, uint256 maxWeightTokenIndex) = _getNormalizedWeightsAndMaxWeightIndex();

        // Due protocol swap fee amounts are computed by measuring the growth of the invariant between the previous join
        // or exit event and now - the invariant's growth is due exclusively to swap fees. This avoids spending gas
        // computing them on each individual swap
        uint256 invariantBeforeJoin = WeightedMath._calculateInvariant(normalizedWeights, balances);

        uint256 feeAmount = WeightedMath._calcDueTokenProtocolSwapFeeAmount(
            balances[maxWeightTokenIndex],
            normalizedWeights[maxWeightTokenIndex],
            getLastInvariant(),
            invariantBeforeJoin,
            getSwapFeePercentage().mulDown(_managementFeePercentage)
        );

        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        IERC20 token = tokens[maxWeightTokenIndex];

        _collectedManagementFees[token] = _collectedManagementFees[token].add(
            _downscaleDown(feeAmount, _scalingFactor(token))
        );
    }

    function _collectManagementFeesFromAmounts(
        uint256[] memory dueProtocolFeeAmounts,
        uint256 protocolSwapFeePercentage
    ) private {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());

        // We have set the maximum in ManagementFeeEnabled to 1 - MaxProtocolFee,
        // so we're sure (management fee + max protocol fee) <= 1

        for (uint256 i = 0; i < dueProtocolFeeAmounts.length; i++) {
            uint256 amount = dueProtocolFeeAmounts[i];
            if (amount != 0) {
                IERC20 token = tokens[i];

                _collectedManagementFees[token] = _collectedManagementFees[token].add(
                    _downscaleDown(
                        amount.mulDown(_managementFeePercentage.divUp(protocolSwapFeePercentage)),
                        _scalingFactor(token)
                    )
                );
            }
        }
    }

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

    function _getTokenData(IERC20 token) private view returns (bytes32 tokenData) {
        tokenData = _tokenState[token];

        // A valid token can't be zero (must have non-zero weights)
        _require(tokenData != 0, Errors.INVALID_TOKEN);
    }
}
