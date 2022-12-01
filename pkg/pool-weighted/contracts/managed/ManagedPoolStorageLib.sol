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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "../lib/GradualValueChange.sol";

/**
 * @title Managed Pool Storage Library
 * @notice Library for manipulating a bitmap used for commonly used Pool state in ManagedPool.
 */
library ManagedPoolStorageLib {
    using WordCodec for bytes32;

    /* solhint-disable max-line-length */
    // Store non-token-based values:
    // Start/end timestamps for gradual weight and swap fee updates
    // Start/end values of the swap fee
    // Flags for the LP allowlist, enabling/disabling trading, enabling/disabling joins and exits, and recovery mode
    //
    // [     1 bit      |   1 bit  |  1 bit  |   1 bit   |    62 bits   |     62 bits    |    32 bits   |     32 bits    | 32 bits |  32 bits  ]
    // [ join-exit flag | recovery | LP flag | swap flag | end swap fee | start swap fee | end fee time | start fee time | end wgt | start wgt ]
    // |MSB                                                                                                                                 LSB|
    /* solhint-enable max-line-length */
    uint256 private constant _WEIGHT_START_TIME_OFFSET = 0;
    uint256 private constant _WEIGHT_END_TIME_OFFSET = _WEIGHT_START_TIME_OFFSET + _TIMESTAMP_WIDTH;
    uint256 private constant _SWAP_FEE_START_TIME_OFFSET = _WEIGHT_END_TIME_OFFSET + _TIMESTAMP_WIDTH;
    uint256 private constant _SWAP_FEE_END_TIME_OFFSET = _SWAP_FEE_START_TIME_OFFSET + _TIMESTAMP_WIDTH;
    uint256 private constant _SWAP_FEE_START_PCT_OFFSET = _SWAP_FEE_END_TIME_OFFSET + _TIMESTAMP_WIDTH;
    uint256 private constant _SWAP_FEE_END_PCT_OFFSET = _SWAP_FEE_START_PCT_OFFSET + _SWAP_FEE_PCT_WIDTH;
    uint256 private constant _SWAP_ENABLED_OFFSET = _SWAP_FEE_END_PCT_OFFSET + _SWAP_FEE_PCT_WIDTH;
    uint256 private constant _MUST_ALLOWLIST_LPS_OFFSET = _SWAP_ENABLED_OFFSET + 1;
    uint256 private constant _RECOVERY_MODE_OFFSET = _MUST_ALLOWLIST_LPS_OFFSET + 1;
    uint256 private constant _JOIN_EXIT_ENABLED_OFFSET = _RECOVERY_MODE_OFFSET + 1;

    uint256 private constant _TIMESTAMP_WIDTH = 32;
    // 2**60 ~= 1.1e18 so this is sufficient to store the full range of potential swap fees.
    uint256 private constant _SWAP_FEE_PCT_WIDTH = 62;

    // Getters

    /**
     * @notice Returns whether the Pool allows regular joins and exits (recovery exits not included).
     * @param poolState - The byte32 state of the Pool.
     */
    function getJoinExitEnabled(bytes32 poolState) internal pure returns (bool) {
        return poolState.decodeBool(_JOIN_EXIT_ENABLED_OFFSET);
    }

    /**
     * @notice Returns whether the Pool is currently in Recovery Mode.
     * @param poolState - The byte32 state of the Pool.
     */
    function getRecoveryModeEnabled(bytes32 poolState) internal pure returns (bool) {
        return poolState.decodeBool(_RECOVERY_MODE_OFFSET);
    }

    /**
     * @notice Returns whether the Pool currently allows swaps (and by extension, non-proportional joins/exits).
     * @param poolState - The byte32 state of the Pool.
     */
    function getSwapEnabled(bytes32 poolState) internal pure returns (bool) {
        return poolState.decodeBool(_SWAP_ENABLED_OFFSET);
    }

    /**
     * @notice Returns whether addresses must be allowlisted to add liquidity to the Pool.
     * @param poolState - The byte32 state of the Pool.
     */
    function getLPAllowlistEnabled(bytes32 poolState) internal pure returns (bool) {
        return poolState.decodeBool(_MUST_ALLOWLIST_LPS_OFFSET);
    }

    /**
     * @notice Returns the percentage progress through the current gradual weight change.
     * @param poolState - The byte32 state of the Pool.
     * @return pctProgress - A 18 decimal fixed-point value corresponding to how far to interpolate between the start
     * and end weights. 0 represents the start weight and 1 represents the end weight (with values >1 being clipped).
     */
    function getGradualWeightChangeProgress(bytes32 poolState) internal view returns (uint256) {
        (uint256 startTime, uint256 endTime) = getWeightChangeFields(poolState);

        return GradualValueChange.calculateValueChangeProgress(startTime, endTime);
    }

    /**
     * @notice Returns the start and end timestamps of the current gradual weight change.
     * @param poolState - The byte32 state of the Pool.
     * @param startTime - The timestamp at which the current gradual weight change started/will start.
     * @param endTime - The timestamp at which the current gradual weight change finished/will finish.
     */
    function getWeightChangeFields(bytes32 poolState) internal pure returns (uint256 startTime, uint256 endTime) {
        startTime = poolState.decodeUint(_WEIGHT_START_TIME_OFFSET, _TIMESTAMP_WIDTH);
        endTime = poolState.decodeUint(_WEIGHT_END_TIME_OFFSET, _TIMESTAMP_WIDTH);
    }

    /**
     * @notice Returns the current value of the swap fee percentage.
     * @dev Computes the current swap fee percentage, which can change every block if a gradual swap fee
     * update is in progress.
     * @param poolState - The byte32 state of the Pool.
     */
    function getSwapFeePercentage(bytes32 poolState) internal view returns (uint256) {
        (
            uint256 startTime,
            uint256 endTime,
            uint256 startSwapFeePercentage,
            uint256 endSwapFeePercentage
        ) = getSwapFeeFields(poolState);

        return
            GradualValueChange.getInterpolatedValue(startSwapFeePercentage, endSwapFeePercentage, startTime, endTime);
    }

    /**
     * @notice Returns the start and end timestamps of the current gradual weight change.
     * @param poolState - The byte32 state of the Pool.
     * @return startTime - The timestamp at which the current gradual swap fee change started/will start.
     * @return endTime - The timestamp at which the current gradual swap fee change finished/will finish.
     * @return startSwapFeePercentage - The swap fee value at the start of the current gradual swap fee change.
     * @return endSwapFeePercentage - The swap fee value at the end of the current gradual swap fee change.
     */
    function getSwapFeeFields(bytes32 poolState)
        internal
        pure
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256 startSwapFeePercentage,
            uint256 endSwapFeePercentage
        )
    {
        startTime = poolState.decodeUint(_SWAP_FEE_START_TIME_OFFSET, _TIMESTAMP_WIDTH);
        endTime = poolState.decodeUint(_SWAP_FEE_END_TIME_OFFSET, _TIMESTAMP_WIDTH);
        startSwapFeePercentage = poolState.decodeUint(_SWAP_FEE_START_PCT_OFFSET, _SWAP_FEE_PCT_WIDTH);
        endSwapFeePercentage = poolState.decodeUint(_SWAP_FEE_END_PCT_OFFSET, _SWAP_FEE_PCT_WIDTH);
    }

    // Setters

    /**
     * @notice Sets the "Joins/Exits enabled" flag to `enabled`.
     * @param poolState - The byte32 state of the Pool.
     * @param enabled - A boolean flag for whether Joins and Exits are to be enabled.
     */
    function setJoinExitEnabled(bytes32 poolState, bool enabled) internal pure returns (bytes32) {
        return poolState.insertBool(enabled, _JOIN_EXIT_ENABLED_OFFSET);
    }

    /**
     * @notice Sets the "Recovery Mode enabled" flag to `enabled`.
     * @param poolState - The byte32 state of the Pool.
     * @param enabled - A boolean flag for whether Recovery Mode is to be enabled.
     */
    function setRecoveryModeEnabled(bytes32 poolState, bool enabled) internal pure returns (bytes32) {
        return poolState.insertBool(enabled, _RECOVERY_MODE_OFFSET);
    }

    /**
     * @notice Sets the "swaps enabled" flag to `enabled`.
     * @param poolState - The byte32 state of the Pool.
     * @param enabled - A boolean flag for whether swaps are to be enabled.
     */
    function setSwapEnabled(bytes32 poolState, bool enabled) internal pure returns (bytes32) {
        return poolState.insertBool(enabled, _SWAP_ENABLED_OFFSET);
    }

    /**
     * @notice Sets the "LP allowlist enabled" flag to `enabled`.
     * @param poolState - The byte32 state of the Pool.
     * @param enabled - A boolean flag for whether the LP allowlist is to be enforced.
     */
    function setLPAllowlistEnabled(bytes32 poolState, bool enabled) internal pure returns (bytes32) {
        return poolState.insertBool(enabled, _MUST_ALLOWLIST_LPS_OFFSET);
    }

    /**
     * @notice Sets the start and end times of a gradual weight change.
     * @param poolState - The byte32 state of the Pool.
     * @param startTime - The timestamp at which the gradual weight change is to start.
     * @param endTime - The timestamp at which the gradual weight change is to finish.
     */
    function setWeightChangeData(
        bytes32 poolState,
        uint256 startTime,
        uint256 endTime
    ) internal pure returns (bytes32) {
        poolState = poolState.insertUint(startTime, _WEIGHT_START_TIME_OFFSET, _TIMESTAMP_WIDTH);
        return poolState.insertUint(endTime, _WEIGHT_END_TIME_OFFSET, _TIMESTAMP_WIDTH);
    }

    /**
     * @notice Sets the start and end times of a gradual swap fee change.
     * @param poolState - The byte32 state of the Pool.
     * @param startTime - The timestamp at which the gradual swap fee change is to start.
     * @param endTime - The timestamp at which the gradual swap fee change is to finish.
     * @param startSwapFeePercentage - The desired swap fee value at the start of the gradual swap fee change.
     * @param endSwapFeePercentage - The desired swap fee value at the end of the gradual swap fee change.
     */
    function setSwapFeeData(
        bytes32 poolState,
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    ) internal pure returns (bytes32) {
        poolState = poolState.insertUint(startTime, _SWAP_FEE_START_TIME_OFFSET, _TIMESTAMP_WIDTH);
        poolState = poolState.insertUint(endTime, _SWAP_FEE_END_TIME_OFFSET, _TIMESTAMP_WIDTH);
        poolState = poolState.insertUint(startSwapFeePercentage, _SWAP_FEE_START_PCT_OFFSET, _SWAP_FEE_PCT_WIDTH);
        return poolState.insertUint(endSwapFeePercentage, _SWAP_FEE_END_PCT_OFFSET, _SWAP_FEE_PCT_WIDTH);
    }
}
