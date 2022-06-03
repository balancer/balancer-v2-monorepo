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

import "@balancer-labs/v2-interfaces/contracts/asset-manager-utils/IAssetManager.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ArrayHelpers.sol";

import "../lib/WeightCompression.sol";

import "../BaseWeightedPool.sol";

/**
 * @dev Weighted Pool with mutable weights, designed to support V2 Liquidity Bootstrapping: potentially without
 * requiring seed funds. The pool is linmited to two tokens, explicitly identified as the project and reserve
 * tokens, and the reserve token can have an asset manager. It also pays protocol fees in BPT.
 */
contract AssetManagedLiquidityBootstrappingPool is BaseWeightedPool, ReentrancyGuard {
    // LiquidityBootstrappingPool change their weights over time: these periods are expected to be long enough (e.g.
    // days) that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using WordCodec for bytes32;
    using WeightCompression for uint256;

    // State variables

    IERC20 internal immutable _projectToken;
    IERC20 internal immutable _reserveToken;

    // True if the index of the project token is zero
    bool internal immutable _projectTokenFirst;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.

    uint256 internal immutable _projectScalingFactor;
    uint256 internal immutable _reserveScalingFactor;

    // For gas optimization, store start/end weights and timestamps in one bytes32
    // Start weights need to be high precision, since restarting the update resets them to "spot" values.
    // [ 63 bits |   1 bit      |    32 bits    |     32 bits     |      64 bits     |      64 bits       ]
    // [ unused  | swap enabled | end timestamp | start timestamp | 2x32 end weights | 2x32 start weights ]
    // |MSB                                                                                            LSB|

    bytes32 private _poolState;

    // Offsets for data elements in _poolState
    uint256 private constant _START_WEIGHT_OFFSET = 0;
    uint256 private constant _END_WEIGHT_OFFSET = 64;
    uint256 private constant _START_TIME_OFFSET = 128;
    uint256 private constant _END_TIME_OFFSET = 160;
    uint256 private constant _SWAP_ENABLED_OFFSET = 192;

    // Cache the protocol swap fee percentage, since we need it on swaps, but it is not passed in then
    uint256 private _cachedProtocolSwapFeePercentage;

    // Event declarations

    event SwapEnabledSet(bool swapEnabled);
    event GradualWeightUpdateScheduled(
        uint256 startTime,
        uint256 endTime,
        uint256[] startWeights,
        uint256[] endWeights
    );

    struct NewPoolParams {
        string name;
        string symbol;
        IERC20 projectToken;
        IERC20 reserveToken;
        uint256 projectWeight;
        uint256 reserveWeight;
        uint256 swapFeePercentage;
        bool swapEnabledOnStart;
    }

    constructor(
        NewPoolParams memory params,
        IVault vault,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner,
        address reserveAssetManager
    )
        BaseWeightedPool(
            vault,
            params.name,
            params.symbol,
            _tokenArray(params.projectToken, params.reserveToken),
            _assetManagerArray(reserveAssetManager, params.projectToken < params.reserveToken),
            params.swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner,
            false
        )
    {
        _projectToken = params.projectToken;
        _reserveToken = params.reserveToken;

        _projectScalingFactor = _computeScalingFactor(params.projectToken);
        _reserveScalingFactor = _computeScalingFactor(params.reserveToken);

        uint256 currentTime = block.timestamp;
        uint256[] memory normalizedWeights = new uint256[](2);
        // The tokens must be ordered; determine the index of the project token
        bool projectTokenFirst = params.projectToken < params.reserveToken;
        _projectTokenFirst = projectTokenFirst;

        normalizedWeights[projectTokenFirst ? 0 : 1] = params.projectWeight;
        normalizedWeights[projectTokenFirst ? 1 : 0] = params.reserveWeight;

        _startGradualWeightChange(currentTime, currentTime, normalizedWeights, normalizedWeights);

        // If false, the pool will start in the disabled state (prevents front-running the enable swaps transaction)
        _setSwapEnabled(params.swapEnabledOnStart);

        // Set initial value of the protocolSwapFeePercentage; can be updated externally if it changes
        _cachedProtocolSwapFeePercentage = vault.getProtocolFeesCollector().getSwapFeePercentage();
    }

    function _tokenArray(IERC20 projectToken, IERC20 reserveToken) private pure returns (IERC20[] memory) {
        IERC20[] memory tokens = new IERC20[](2);
        bool projectTokenFirst = projectToken < reserveToken;

        tokens[projectTokenFirst ? 0 : 1] = projectToken;
        tokens[projectTokenFirst ? 1 : 0] = reserveToken;

        return tokens;
    }

    function _assetManagerArray(address reserveAssetManager, bool projectTokenFirst)
        private
        pure
        returns (address[] memory)
    {
        address[] memory assetManagers = new address[](2);
        assetManagers[projectTokenFirst ? 1 : 0] = reserveAssetManager;

        return assetManagers;
    }

    // External functions

    function updateCachedProtocolSwapFeePercentage() external {
        _cachedProtocolSwapFeePercentage = getVault().getProtocolFeesCollector().getSwapFeePercentage();
    }

    /**
     * @dev Tells whether swaps are enabled or not for the given pool.
     */
    function getSwapEnabled() public view returns (bool) {
        return _poolState.decodeBool(_SWAP_ENABLED_OFFSET);
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

        startTime = poolState.decodeUint(_START_TIME_OFFSET, 32);
        endTime = poolState.decodeUint(_END_TIME_OFFSET, 32);
        endWeights = new uint256[](2);

        endWeights[0] = poolState.decodeUint(_END_WEIGHT_OFFSET, 32).decompress(32);
        endWeights[1] = poolState.decodeUint(_END_WEIGHT_OFFSET + 32, 32).decompress(32);
    }

    /**
     * @dev Can pause/unpause trading
     */
    function setSwapEnabled(bool swapEnabled) external authenticate whenNotPaused nonReentrant {
        _setSwapEnabled(swapEnabled);
    }

    /**
     * @dev Schedule a gradual weight change, from the current weights to the given endWeights,
     * over startTime to endTime. Keep interface the same, even though we know there are only two.
     */
    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory endWeights
    ) external authenticate whenNotPaused nonReentrant {
        InputHelpers.ensureInputLengthMatch(2, endWeights.length);

        // If the start time is in the past, "fast forward" to start now
        // This avoids discontinuities in the weight curve. Otherwise, if you set the start/end times with
        // only 10% of the period in the future, the weights would immediately jump 90%
        uint256 currentTime = block.timestamp;
        startTime = Math.max(currentTime, startTime);

        _require(startTime <= endTime, Errors.GRADUAL_UPDATE_TIME_TRAVEL);

        _startGradualWeightChange(startTime, endTime, _getNormalizedWeights(), endWeights);
    }

    // Internal functions

    function _getNormalizedWeight(IERC20 token) internal view override returns (uint256) {
        uint256 tokenIndex;

        if (token == _projectToken) {
            tokenIndex = _isProjectTokenFirst() ? 0 : 1;
        } else if (token == _reserveToken) {
            tokenIndex = _isProjectTokenFirst() ? 1 : 0;
        } else {
            _revert(Errors.INVALID_TOKEN);
        }

        return _getNormalizedWeightByIndex(tokenIndex, _poolState);
    }

    function _getNormalizedWeightByIndex(uint256 i, bytes32 poolState) internal view returns (uint256) {
        uint256 startWeight = poolState.decodeUint(_START_WEIGHT_OFFSET + i * 32, 32).decompress(32);
        uint256 endWeight = poolState.decodeUint(_END_WEIGHT_OFFSET + i * 32, 32).decompress(32);

        uint256 pctProgress = _calculateWeightChangeProgress(poolState);

        return _interpolateWeight(startWeight, endWeight, pctProgress);
    }

    function _getNormalizedWeights() internal view override returns (uint256[] memory) {
        uint256[] memory normalizedWeights = new uint256[](2);
        bytes32 poolState = _poolState;

        normalizedWeights[0] = _getNormalizedWeightByIndex(0, poolState);
        normalizedWeights[1] = _getNormalizedWeightByIndex(1, poolState);

        return normalizedWeights;
    }

    // Pool callback functions

    // Prevent any account other than the owner from joining the pool.
    // If the pool is unseeded, there will be a managed balance for the reserve token.
    // In this case, zero out the reserve token in amountsIn, so that the Vault does not attempt to pull them

    function _onInitializePool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        // Only the owner can initialize the pool
        _require(sender == getOwner(), Errors.CALLER_IS_NOT_LBP_OWNER);

        (uint256 bptAmountOut, uint256[] memory amountsIn) = super._onInitializePool(
            poolId,
            sender,
            recipient,
            scalingFactors,
            userData
        );

        // If there is a managed balance, the pool is unseeded, so we do not want to pull in any reserve tokens
        (, uint256 managed, , ) = getVault().getPoolTokenInfo(poolId, _reserveToken);
        if (managed > 0) {
            amountsIn[_isProjectTokenFirst() ? 1 : 0] = 0;
        }

        return (bptAmountOut, amountsIn);
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
    ) internal override returns (uint256, uint256[] memory) {
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
    ) internal virtual override returns (uint256) {
        _require(getSwapEnabled(), Errors.SWAPS_DISABLED);

        (uint256[] memory normalizedWeights, uint256[] memory preSwapBalances) = _getWeightsAndPreSwapBalances(
            swapRequest,
            currentBalanceTokenIn,
            currentBalanceTokenOut
        );

        // balances (and swapRequest.amount) are already upscaled by BaseMinimalSwapInfoPool.onSwap
        uint256 amountOut = super._onSwapGivenIn(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);

        uint256[] memory postSwapBalances = ArrayHelpers.arrayFill(
            currentBalanceTokenIn.add(_addSwapFeeAmount(swapRequest.amount)),
            currentBalanceTokenOut.sub(amountOut)
        );

        _payLbpProtocolFees(normalizedWeights, preSwapBalances, postSwapBalances);

        return amountOut;
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal virtual override returns (uint256) {
        _require(getSwapEnabled(), Errors.SWAPS_DISABLED);

        (uint256[] memory normalizedWeights, uint256[] memory preSwapBalances) = _getWeightsAndPreSwapBalances(
            swapRequest,
            currentBalanceTokenIn,
            currentBalanceTokenOut
        );

        // balances (and swapRequest.amount) are already upscaled by BaseMinimalSwapInfoPool.onSwap
        uint256 amountIn = super._onSwapGivenOut(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);

        uint256[] memory postSwapBalances = ArrayHelpers.arrayFill(
            currentBalanceTokenIn.add(_addSwapFeeAmount(amountIn)),
            currentBalanceTokenOut.sub(swapRequest.amount)
        );

        _payLbpProtocolFees(normalizedWeights, preSwapBalances, postSwapBalances);

        return amountIn;
    }

    function _getWeightsAndPreSwapBalances(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) private view returns (uint256[] memory, uint256[] memory) {
        uint256[] memory normalizedWeights = ArrayHelpers.arrayFill(
            _getNormalizedWeight(swapRequest.tokenIn),
            _getNormalizedWeight(swapRequest.tokenOut)
        );

        uint256[] memory preSwapBalances = ArrayHelpers.arrayFill(currentBalanceTokenIn, currentBalanceTokenOut);

        return (normalizedWeights, preSwapBalances);
    }

    function _payLbpProtocolFees(
        uint256[] memory normalizedWeights,
        uint256[] memory preSwapBalances,
        uint256[] memory postSwapBalances
    ) private {
        uint256 protocolFeePercentage = _cachedProtocolSwapFeePercentage;

        if (protocolFeePercentage == 0) {
            return;
        }

        // No other balances are changing, so the other terms in the invariant will cancel out
        // when computing the ratio. So this partial invariant calculation is sufficient
        uint256 bptFeeAmount = WeightedMath._calcDueProtocolSwapFeeBptAmount(
            totalSupply(),
            WeightedMath._calculateInvariant(normalizedWeights, preSwapBalances),
            WeightedMath._calculateInvariant(normalizedWeights, postSwapBalances),
            protocolFeePercentage
        );

        _payProtocolFees(bptFeeAmount);
    }

    /**
     * @dev Extend ownerOnly functions to include the LBP control functions
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view override returns (bool) {
        return
            (actionId == getActionId(AssetManagedLiquidityBootstrappingPool.setSwapEnabled.selector)) ||
            (actionId == getActionId(AssetManagedLiquidityBootstrappingPool.updateWeightsGradually.selector)) ||
            super._isOwnerOnlyAction(actionId);
    }

    // Private functions

    /**
     * @dev Returns a fixed-point number representing how far along the current weight change is, where 0 means the
     * change has not yet started, and FixedPoint.ONE means it has fully completed.
     */
    function _calculateWeightChangeProgress(bytes32 poolState) private view returns (uint256) {
        uint256 currentTime = block.timestamp;
        uint256 startTime = poolState.decodeUint(_START_TIME_OFFSET, 32);
        uint256 endTime = poolState.decodeUint(_END_TIME_OFFSET, 32);

        if (currentTime > endTime) {
            return FixedPoint.ONE;
        } else if (currentTime < startTime) {
            return 0;
        }

        // No need for SafeMath as it was checked right above: endTime >= currentTime >= startTime
        uint256 totalSeconds = endTime - startTime;
        uint256 secondsElapsed = currentTime - startTime;

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
            _require(endWeight >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);

            newPoolState = newPoolState
                .insertUint(startWeights[i].compress(32), _START_WEIGHT_OFFSET + i * 32, 32)
                .insertUint(endWeight.compress(32), _END_WEIGHT_OFFSET + i * 32, 32);

            normalizedSum = normalizedSum.add(endWeight);
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _poolState = newPoolState.insertUint(startTime, _START_TIME_OFFSET, 32).insertUint(
            endTime,
            _END_TIME_OFFSET,
            32
        );

        emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);
    }

    function _interpolateWeight(
        uint256 startWeight,
        uint256 endWeight,
        uint256 pctProgress
    ) private pure returns (uint256) {
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

    function _setSwapEnabled(bool swapEnabled) private {
        _poolState = _poolState.insertBool(swapEnabled, _SWAP_ENABLED_OFFSET);
        emit SwapEnabledSet(swapEnabled);
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return 2;
    }

    function _getTotalTokens() internal pure override returns (uint256) {
        return 2;
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        if (token == _projectToken) {
            return _projectScalingFactor;
        } else if (token == _reserveToken) {
            return _reserveScalingFactor;
        } else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        uint256[] memory scalingFactors = new uint256[](2);

        scalingFactors[_isProjectTokenFirst() ? 0 : 1] = _projectScalingFactor;
        scalingFactors[_isProjectTokenFirst() ? 1 : 0] = _reserveScalingFactor;

        return scalingFactors;
    }

    function _isProjectTokenFirst() private view returns (bool) {
        return _projectTokenFirst;
    }
}
