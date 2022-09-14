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

import "../managed/ManagedPoolStorageLib.sol";

contract MockManagedPoolStorageLib {
    using ManagedPoolStorageLib for bytes32;

    // Getters

    function getRecoveryModeEnabled(bytes32 poolState) external pure returns (bool) {
        return poolState.getRecoveryModeEnabled();
    }

    function getSwapsEnabled(bytes32 miscData) external pure returns (bool) {
        return miscData.getSwapsEnabled();
    }

    function getLPAllowlistEnabled(bytes32 miscData) external pure returns (bool) {
        return miscData.getLPAllowlistEnabled();
    }

    function getGradualWeightChangeProgress(bytes32 miscData) external view returns (uint256) {
        return miscData.getGradualWeightChangeProgress();
    }

    function getWeightChangeFields(bytes32 miscData) external pure returns (uint256 startTime, uint256 endTime) {
        return miscData.getWeightChangeFields();
    }

    function getSwapFeePercentage(bytes32 miscData) external view returns (uint256) {
        return miscData.getSwapFeePercentage();
    }

    function getSwapFeeFields(bytes32 miscData)
        external
        pure
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256 startSwapFeePercentage,
            uint256 endSwapFeePercentage
        )
    {
        return miscData.getSwapFeeFields();
    }

    // Setters

    function setRecoveryModeEnabled(bytes32 poolState, bool enabled) external pure returns (bytes32) {
        return poolState.setRecoveryModeEnabled(enabled);
    }

    function setSwapsEnabled(bytes32 miscData, bool enabled) external pure returns (bytes32) {
        return miscData.setSwapsEnabled(enabled);
    }

    function setLPAllowlistEnabled(bytes32 miscData, bool enabled) external pure returns (bytes32) {
        return miscData.setLPAllowlistEnabled(enabled);
    }

    function setWeightChangeData(
        bytes32 miscData,
        uint256 startTime,
        uint256 endTime
    ) external pure returns (bytes32) {
        return miscData.setWeightChangeData(startTime, endTime);
    }

    function setSwapFeeData(
        bytes32 miscData,
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    ) external pure returns (bytes32) {
        return miscData.setSwapFeeData(startTime, endTime, startSwapFeePercentage, endSwapFeePercentage);
    }
}
