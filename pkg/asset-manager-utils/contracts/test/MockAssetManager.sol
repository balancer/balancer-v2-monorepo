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

pragma experimental ABIEncoderV2;

import "../IAssetManager.sol";

pragma solidity ^0.7.0;

contract MockAssetManager is IAssetManager {
    event Rebalanced(bytes32 poolId);

    mapping (bytes32 => PoolConfig) internal configs;

    function getPoolConfig(bytes32 poolId) external view override returns (PoolConfig memory) {
        return configs[poolId];
    }

    function setPoolConfig(bytes32 poolId, PoolConfig calldata config) external override {
        configs[poolId] = config;
    }

    function balanceOf(bytes32) external pure override returns (uint256) {
        return 0;
    }

    function readAUM() external pure override returns (uint256) {
        return 0;
    }

    function maxInvestableBalance(bytes32) external pure override returns (int256) {
        return 0;
    }

    function getRebalanceFee(bytes32) external pure override returns (uint256) {
        return 0;
    }

    function updateBalanceOfPool(bytes32 poolId) external override {
        // do nothing
    }

    function capitalIn(bytes32, uint256) external pure override {
        // do nothing
    }

    function capitalOut(bytes32, uint256) external pure override {
        // do nothing
    }

    function rebalance(bytes32 poolId) external override {
        emit Rebalanced(poolId);
    }
}
