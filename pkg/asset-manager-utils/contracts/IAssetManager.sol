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

    function getPoolConfig(bytes32 poolId) external view returns (PoolConfig memory);

    function setPoolConfig(bytes32 poolId, PoolConfig calldata config) external;

    function balanceOf(bytes32 poolId) external view returns (uint256);

    function readAUM() external view returns (uint256);

    function realizeGains() external;

    function maxInvestableBalance(bytes32 poolId) external view returns (int256);

    function getRebalanceFee(bytes32 poolId) external view returns (uint256);

    function updateBalanceOfPool(bytes32 poolId) external;

    function capitalIn(bytes32 poolId, uint256 amount) external;

    function capitalOut(bytes32 poolId, uint256 amount) external;

    function rebalance(bytes32 poolId) external;
}
