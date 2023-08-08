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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/ScalingHelpers.sol";

import "@balancer-labs/v2-pool-utils/contracts/NewBasePool.sol";

import "../lib/GradualValueChange.sol";
import "../WeightedMath.sol";

import "./AssetManagedLBPStorageLib.sol";

/**
 * @dev Weighted Pool with mutable weights, designed to support Asset Managed V2 Liquidity Bootstrapping.
 */
abstract contract AssetManagedLBPSettings is IMinimalSwapInfoPool, NewBasePool {
    // LiquidityBootstrappingPools change their weights over time: these periods are expected to be long enough (e.g.
    // days) that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;

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

    uint256 private constant _LBP_TOKENS = 2;

    // 1e18 corresponds to 1.0, or a 100% fee
    uint256 private constant _MIN_SWAP_FEE_PERCENTAGE = 1e12; // 0.0001%
    uint256 private constant _MAX_SWAP_FEE_PERCENTAGE = 1e17; // 10%

    uint256 private _swapFeePercentage;

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
    // Cache the protocol swap fee in the top 62 bits. 1e18 ~ 60 bits, so it will fit.
    // [   62 bits     |  1 bit   |   1 bit      |    32 bits    |     32 bits     |    64 bits    |    64 bits      ]
    // [ protocol fee  | recovery | swap enabled | end timestamp | start timestamp | 2x32 end wgts | 2x32 start wgts ]
    // |MSB                                                                                                       LSB|

    bytes32 private _poolState;

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
        NewPoolParams memory params,
        IVault vault,
        bytes32 poolId,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    ) NewBasePool(vault, poolId, params.name, params.symbol, pauseWindowDuration, bufferPeriodDuration, owner) {
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

        _setSwapFeePercentage(params.swapFeePercentage);

        _startGradualWeightChange(currentTime, currentTime, normalizedWeights, normalizedWeights);

        // If false, the pool will start in the disabled state (prevents front-running the enable swaps transaction)
        _setSwapEnabled(params.swapEnabledOnStart);

        // Set initial value of the protocolSwapFeePercentage; can be updated externally if it changes
        _updateCachedProtocolSwapFeePercentage(vault);
    }

    function _getPoolState() internal view returns (bytes32) {
        return _poolState;
    }

    function getCachedProtocolSwapFeePercentage() public view returns (uint256) {
        return AssetManagedLBPStorageLib.getCachedProtocolSwapFee(_poolState);
    }

    function updateCachedProtocolSwapFeePercentage() external {
        _updateCachedProtocolSwapFeePercentage(getVault());
    }

    function _updateCachedProtocolSwapFeePercentage(IVault vault) private {
        _poolState = AssetManagedLBPStorageLib.setCachedProtocolSwapFee(
            _poolState,
            vault.getProtocolFeesCollector().getSwapFeePercentage()
        );
    }

    function _getTokenIndex(IERC20 token) internal view returns (uint256) {
        if (token == _projectToken) {
            return _isProjectTokenFirst() ? 0 : 1;
        } else if (token == _reserveToken) {
            return _isProjectTokenFirst() ? 1 : 0;
        } else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    // External functions

    /**
     * @notice Return whether swaps are enabled or not for the given pool.
     */
    function getSwapEnabled() public view returns (bool) {
        return AssetManagedLBPStorageLib.getSwapEnabled(_poolState);
    }

    /**
     * @notice Pause/unpause trading.
     */
    function setSwapEnabled(bool swapEnabled) external authenticate whenNotPaused {
        _setSwapEnabled(swapEnabled);
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
        (startTime, endTime, , endWeights) = AssetManagedLBPStorageLib.getGradualWeightUpdateParams(_poolState);
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
        InputHelpers.ensureInputLengthMatch(_LBP_TOKENS, endWeights.length);

        startTime = GradualValueChange.resolveStartTime(startTime, endTime);
        _startGradualWeightChange(startTime, endTime, _getNormalizedWeights(), endWeights);
    }

    function _getNormalizedWeight(IERC20 token) internal view returns (uint256) {
        uint256 tokenIndex;

        if (token == _projectToken) {
            tokenIndex = _isProjectTokenFirst() ? 0 : 1;
        } else if (token == _reserveToken) {
            tokenIndex = _isProjectTokenFirst() ? 1 : 0;
        } else {
            _revert(Errors.INVALID_TOKEN);
        }

        return AssetManagedLBPStorageLib.getNormalizedWeightByIndex(tokenIndex, _poolState);
    }

    function _getNormalizedWeights() internal view returns (uint256[] memory) {
        uint256[] memory normalizedWeights = new uint256[](2);
        bytes32 poolState = _poolState;

        normalizedWeights[0] = AssetManagedLBPStorageLib.getNormalizedWeightByIndex(0, poolState);
        normalizedWeights[1] = AssetManagedLBPStorageLib.getNormalizedWeightByIndex(1, poolState);

        return normalizedWeights;
    }

    // Swap Fees

    /**
     * @notice Return the current value of the swap fee percentage.
     * @dev This is stored separately, as there is no more room in `_poolState`.
     */
    function getSwapFeePercentage() public view virtual override returns (uint256) {
        return _swapFeePercentage;
    }

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

    function getMinimumWeight() public pure returns (uint256) {
        return WeightedMath._MIN_WEIGHT;
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
        uint256 normalizedSum = 0;
        for (uint256 i = 0; i < endWeights.length; i++) {
            uint256 endWeight = endWeights[i];
            _require(endWeight >= getMinimumWeight(), Errors.MIN_WEIGHT);

            normalizedSum = normalizedSum.add(endWeight);
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _poolState = AssetManagedLBPStorageLib.setNormalizedWeights(
            _poolState,
            startTime,
            endTime,
            startWeights,
            endWeights
        );

        emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);
    }

    function _setSwapEnabled(bool swapEnabled) private {
        _poolState = AssetManagedLBPStorageLib.setSwapEnabled(_poolState, swapEnabled);
        emit SwapEnabledSet(swapEnabled);
    }

    // Scaling factors

    function _scalingFactor(IERC20 token) internal view returns (uint256) {
        if (token == _projectToken) {
            return _projectScalingFactor;
        } else if (token == _reserveToken) {
            return _reserveScalingFactor;
        } else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function getScalingFactors() public view virtual override returns (uint256[] memory) {
        uint256[] memory scalingFactors = new uint256[](2);

        scalingFactors[_isProjectTokenFirst() ? 0 : 1] = _projectScalingFactor;
        scalingFactors[_isProjectTokenFirst() ? 1 : 0] = _reserveScalingFactor;

        return scalingFactors;
    }

    function _isProjectTokenFirst() internal view returns (bool) {
        return _projectTokenFirst;
    }

    // Recovery Mode

    /**
     * @notice Returns whether the pool is in Recovery Mode.
     */
    function inRecoveryMode() public view override returns (bool) {
        return AssetManagedLBPStorageLib.getRecoveryMode(_poolState);
    }

    /**
     * @dev Sets the recoveryMode state. The RecoveryModeStateChanged event is emitted in the RecoveryMode
     * base contract, in `enableRecoveryMode` or `disabledRecoveryMode`, before calling this hook.
     */
    function _setRecoveryMode(bool enabled) internal virtual override {
        _poolState = AssetManagedLBPStorageLib.setRecoveryMode(_poolState, enabled);
    }

    // Misc

    /**
     * @dev Extend ownerOnly functions to include the LBP control functions
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view override returns (bool) {
        return
            (actionId == getActionId(this.setSwapFeePercentage.selector)) ||
            (actionId == getActionId(this.setSwapEnabled.selector)) ||
            (actionId == getActionId(this.updateWeightsGradually.selector));
    }
}
