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

import "../managed/ManagedPoolSwapFees.sol";

contract MockManagedPoolSwapFees is ManagedPoolSwapFees {
    bytes32 private _poolState;

    function _getPoolState() internal view override returns (bytes32) {
        return _poolState;
    }

    function _setPoolState(bytes32 newPoolState) internal override {
        _poolState = newPoolState;
    }

    // Mocked Functions

    function getMinSwapFeePercentage() external pure returns (uint256) {
        return _getMinSwapFeePercentage();
    }

    function getMaxSwapFeePercentage() external pure returns (uint256) {
        return _getMaxSwapFeePercentage();
    }

    function validateSwapFeePercentage(uint256 swapFeePercentage) external pure {
        _validateSwapFeePercentage(swapFeePercentage);
    }

    function setSwapFeePercentage(uint256 swapFeePercentage) external {
        _setSwapFeePercentage(_getPoolState(), swapFeePercentage);
    }

    function startGradualSwapFeeChange(
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    ) external {
        _startGradualSwapFeeChange(_getPoolState(), startTime, endTime, startSwapFeePercentage, endSwapFeePercentage);
    }

    // Satisfying IBasePool

    function onJoinPool(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        bytes memory
    ) external pure override returns (uint256[] memory, uint256[] memory) {
        revert("NOT_IMPLEMENTED");
    }

    function onExitPool(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        bytes memory
    ) external pure override returns (uint256[] memory, uint256[] memory) {
        revert("NOT_IMPLEMENTED");
    }

    function getPoolId() external pure override returns (bytes32) {
        revert("NOT_IMPLEMENTED");
    }

    function getScalingFactors() external pure override returns (uint256[] memory) {
        revert("NOT_IMPLEMENTED");
    }

    function queryJoin(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        bytes memory
    ) external pure override returns (uint256, uint256[] memory) {
        revert("NOT_IMPLEMENTED");
    }

    function queryExit(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        bytes memory
    ) external pure override returns (uint256, uint256[] memory) {
        revert("NOT_IMPLEMENTED");
    }
}
