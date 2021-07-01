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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";

import "../IAssetManager.sol";

pragma solidity ^0.7.0;

contract MockAssetManager is IAssetManager {
    event Rebalanced(address assetManager, bytes32 poolId, IERC20 token, bool force);

    IERC20 internal _token;

    constructor(IERC20 token) {
        _token = token;
    }

    function setConfig(bytes32, bytes memory) external override {
        // solhint-disable-previous-line no-empty-blocks
    }

    function getToken() external view override returns (IERC20) {
        return _token;
    }

    function getAUM(bytes32) external pure override returns (uint256) {
        return 0;
    }

    function getPoolBalances(bytes32) external pure override returns (uint256 poolCash, uint256 poolManaged) {
        return (0, 0);
    }

    function maxInvestableBalance(bytes32) external pure override returns (int256) {
        return 0;
    }

    function updateBalanceOfPool(bytes32) external override {
        // solhint-disable-previous-line no-empty-blocks
    }

    function shouldRebalance(uint256, uint256) external pure override returns (bool) {
        return true;
    }

    function rebalance(bytes32 poolId, bool force) external override {
        emit Rebalanced(address(this), poolId, _token, force);
    }

    function capitalOut(bytes32, uint256) external override {
        // solhint-disable-previous-line no-empty-blocks
    }
}
