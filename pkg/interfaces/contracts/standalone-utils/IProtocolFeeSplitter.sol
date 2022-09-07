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

/**
 * @title ProtocolFeeSplitter
 * @notice Distributes collected protocol fees between Balancer's treasury and a pool owner
 */
interface IProtocolFeeSplitter {
    event FeesCollected(
        bytes32 indexed poolId,
        address indexed owner,
        uint256 ownerEarned,
        address indexed treasury,
        uint256 treasuryEarned
    );

    event PoolRevenueShareChanged(bytes32 indexed poolId, uint256 revenueSharePercentage);
    event DefaultRevenueSharingFeePercentageChanged(uint256 revenueSharePercentage);

    /**
     * @notice Allows a authorized user to change revenueShare for a `poolId`
     * @param poolId - the poolId of the pool where we want to change fee percentage
     * @param newSwapFeePercentage - new swap fee percentage
     */
    function setRevenueSharingFeePercentage(bytes32 poolId, uint256 newSwapFeePercentage) external;
    
    /**
     * @notice Allows a authorized user to change the default revenue sharing fee percentage
     * @param feePercentage - new default revenue sharing fee percentage
     */
    function setDefaultRevenueSharingFeePercentage(uint256 feePercentage) external;

    /**
     * @notice Collects and distributes fees for a `poolId`
     * @dev Use multicall contract for batchCollectFees
     * @param poolId - the poolId of the pool for which we collect fees
     */
    function collectFees(bytes32 poolId) external;
}
