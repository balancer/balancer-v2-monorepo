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

interface IAssetManager {
    struct PoolConfig {
        uint64 targetPercentage;
        uint64 criticalPercentage;
        uint64 feePercentage;
    }

    /**
     * @notice Returns the pools config
     */
    function getPoolConfig(bytes32 poolId) external view returns (PoolConfig memory);

    /**
     * @notice Sets the pool config
     */
    function setPoolConfig(bytes32 poolId, PoolConfig calldata config) external;

    /**
     * @notice Returns invested balance
     */
    function balanceOf(bytes32 poolId) external view returns (uint256);

    /**
     * @return the current assets under management of this asset manager
     */
    function readAUM() external view returns (uint256);

    /**
     * @notice Checks invested balance and updates AUM appropriately
     */
    function realizeGains() external;

    /**
     * @return The difference in token between the target investment
     * and the currently invested amount (i.e. the amount that can be invested)
     */
    function maxInvestableBalance(bytes32 poolId) external view returns (int256);

    /**
     * @return the rebalance fee for the pool
     */
    function getRebalanceFee(bytes32 poolId) external view returns (uint256);

    /**
     * @notice Updates the Vault on the value of the pool's investment returns
     * @dev To be called following a call to realizeGains
     */
    function updateBalanceOfPool(bytes32 poolId) external;

    /**
     * @dev Transfers capital into the asset manager, and then invests it
     * @param amount - the amount of tokens being deposited
     */
    function capitalIn(bytes32 poolId, uint256 amount) external;

    /**
     * @notice Divests capital back to the asset manager and then sends it to the vault
     * @param amount - the amount of tokens to withdraw to the vault
     */
    function capitalOut(bytes32 poolId, uint256 amount) external;

    /**
     * @notice Rebalances funds between pool and asset manager to maintain target investment percentage.
     * If the pool is below it's critical threshold for the amount invested then calling this will send a small reward
     */
    function rebalance(bytes32 poolId) external;
}
