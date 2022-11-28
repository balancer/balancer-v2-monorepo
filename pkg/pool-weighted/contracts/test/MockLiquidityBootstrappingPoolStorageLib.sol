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

import "../lbp/LiquidityBootstrappingPoolStorageLib.sol";

contract MockLiquidityBootstrappingPoolStorageLib {
    // Getters

    function getSwapEnabled(bytes32 poolState) external pure returns (bool) {
        return LiquidityBootstrappingPoolStorageLib.getSwapEnabled(poolState);
    }

    function getRecoveryMode(bytes32 poolState) external pure returns (bool) {
        return LiquidityBootstrappingPoolStorageLib.getRecoveryMode(poolState);
    }

    function getGradualWeightUpdateParams(bytes32 poolState, uint256 totalTokens)
        external
        pure
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256[] memory startWeights,
            uint256[] memory endWeights
        )
    {
        return LiquidityBootstrappingPoolStorageLib.getGradualWeightUpdateParams(poolState, totalTokens);
    }

    // Setters

    function setSwapEnabled(bytes32 poolState, bool swapEnabled) external pure returns (bytes32) {
        return LiquidityBootstrappingPoolStorageLib.setSwapEnabled(poolState, swapEnabled);
    }

    function setRecoveryMode(bytes32 poolState, bool enabled) external pure returns (bytes32) {
        return LiquidityBootstrappingPoolStorageLib.setRecoveryMode(poolState, enabled);
    }

    function setNormalizedWeights(
        bytes32 poolState,
        uint256 startTime,
        uint256 endTime,
        uint256[] memory newStartWeights,
        uint256[] memory newEndWeights
    ) external pure returns (bytes32) {
        return
            LiquidityBootstrappingPoolStorageLib.setNormalizedWeights(
                poolState,
                startTime,
                endTime,
                newStartWeights,
                newEndWeights
            );
    }
}
