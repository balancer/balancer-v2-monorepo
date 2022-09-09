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

library ManagedPoolStorageLib {
    using WordCodec for bytes32;

    // Store non-token-based values:
    // Start/end timestamps for gradual weight and swap fee updates
    // Start/end values of the swap fee
    // Flags for the LP allowlist and enabling/disabling trading
    // [ 1 bit   |   1 bit   |    62 bits   |     64 bits    |    32 bits   |     32 bits    | 32 bits |  32 bits  ]
    // [ LP flag | swap flag | end swap fee | start swap fee | end fee time | start fee time | end wgt | start wgt ]
    // |MSB                                                                                                     LSB|
    uint256 private constant _WEIGHT_START_TIME_OFFSET = 0;
    uint256 private constant _WEIGHT_END_TIME_OFFSET = 32;
    uint256 private constant _SWAP_FEE_START_TIME_OFFSET = 64;
    uint256 private constant _SWAP_FEE_END_TIME_OFFSET = 96;
    uint256 private constant _SWAP_FEE_START_PERCENTAGE_OFFSET = 128;
    uint256 private constant _SWAP_FEE_END_PERCENTAGE_OFFSET = 192;
    uint256 private constant _SWAP_ENABLED_OFFSET = 254;
    uint256 private constant _MUST_ALLOWLIST_LPS_OFFSET = 255;

    uint256 private constant _TIMESTAMP_WIDTH = 32;
    uint256 private constant _SWAP_FEE_START_PERCENTAGE_WIDTH = 64;
    uint256 private constant _SWAP_FEE_END_PERCENTAGE_WIDTH = 62;

    // Getters

    /**
     * @notice Returns whether the Pool currently allows swaps (and by extension, non-proportional joins/exits).
     */
    function getSwapsEnabled(bytes32 miscData) internal pure returns (bool) {
        return miscData.decodeBool(_SWAP_ENABLED_OFFSET);
    }

    /**
     * @notice Returns whether addresses must be allowlisted to add liquidity to the Pool.
     */
    function getLPAllowlistEnabled(bytes32 miscData) internal pure returns (bool) {
        return miscData.decodeBool(_MUST_ALLOWLIST_LPS_OFFSET);
    }

    /**
     * @notice Returns the percentage progress through the current gradual weight change.
     */
    function getGradualWeightChangeProgress(bytes32 miscData) internal view returns (uint256) {
        (uint256 startTime, uint256 endTime) = _getWeightChangeFields(miscData);

        return GradualValueChange.calculateValueChangeProgress(startTime, endTime);
    }

    /**
     * @notice Returns the current value of the swap fee percentage.
     * @dev Computes the current swap fee percentage, which can change every block if a gradual swap fee
     * update is in progress.
     */
    function getSwapFeePercentage(bytes32 miscData) internal view returns (uint256) {
        (
            uint256 startTime,
            uint256 endTime,
            uint256 startSwapFeePercentage,
            uint256 endSwapFeePercentage
        ) = _getSwapFeeFields(miscData);

        return
            GradualValueChange.getInterpolatedValue(startSwapFeePercentage, endSwapFeePercentage, startTime, endTime);
    }

    // Setters

    function setSwapsEnabled(bytes32 miscData, bool enabled) internal pure returns (bytes32) {
        return miscData.insertBool(enabled, _SWAP_ENABLED_OFFSET);
    }

    function setLPAllowlistEnabled(bytes32 miscData, bool enabled) internal pure returns (bytes32) {
        return miscData.insertBool(enabled, _MUST_ALLOWLIST_LPS_OFFSET);
    }

    function setWeightChangeData(
        bytes32 miscData,
        uint256 startTime,
        uint256 endTime
    ) internal pure returns (bytes32) {
        return
            miscData.insertUint(startTime, _WEIGHT_START_TIME_OFFSET, _TIMESTAMP_WIDTH).insertUint(
                endTime,
                _WEIGHT_END_TIME_OFFSET,
                _TIMESTAMP_WIDTH
            );
    }

    function setSwapFeeData(
        bytes32 miscData,
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    ) internal pure returns (bytes32) {
        // Add scope to prevent "Stack too deep"
        {
            miscData = miscData.insertUint(startTime, _SWAP_FEE_START_TIME_OFFSET, _TIMESTAMP_WIDTH).insertUint(
                endTime,
                _SWAP_FEE_END_TIME_OFFSET,
                _TIMESTAMP_WIDTH
            );
        }
        return
            miscData
                .insertUint(startSwapFeePercentage, _SWAP_FEE_START_PERCENTAGE_OFFSET, _SWAP_FEE_START_PERCENTAGE_WIDTH)
                .insertUint(endSwapFeePercentage, _SWAP_FEE_END_PERCENTAGE_OFFSET, _SWAP_FEE_END_PERCENTAGE_WIDTH);
    }

    // Private

    function _getWeightChangeFields(bytes32 miscData) private pure returns (uint256 startTime, uint256 endTime) {
        startTime = miscData.decodeUint(_WEIGHT_START_TIME_OFFSET, _TIMESTAMP_WIDTH);
        endTime = miscData.decodeUint(_WEIGHT_END_TIME_OFFSET, _TIMESTAMP_WIDTH);
    }

    function _getSwapFeeFields(bytes32 miscData)
        private
        pure
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256 startSwapFeePercentage,
            uint256 endSwapFeePercentage
        )
    {
        startTime = miscData.decodeUint(_SWAP_FEE_START_TIME_OFFSET, _TIMESTAMP_WIDTH);
        endTime = miscData.decodeUint(_SWAP_FEE_END_TIME_OFFSET, _TIMESTAMP_WIDTH);
        startSwapFeePercentage = miscData.decodeUint(
            _SWAP_FEE_START_PERCENTAGE_OFFSET,
            _SWAP_FEE_START_PERCENTAGE_WIDTH
        );
        endSwapFeePercentage = miscData.decodeUint(_SWAP_FEE_END_PERCENTAGE_OFFSET, _SWAP_FEE_END_PERCENTAGE_WIDTH);
    }
}
