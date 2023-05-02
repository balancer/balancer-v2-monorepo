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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IChildChainGauge.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ILiquidityGaugeFactory.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IL2LayerZeroDelegation.sol";

import { ChildChainGaugeRegistry } from "./ChildChainGaugeRegistry.sol";

/**
 * @title ChildChainGaugeCheckpointer
 * @notice Checkpointer for all child chain gauges.
 * This contract calls `user_checkpoint` function on every child chain gauge during onVeBalBridged callback.
 */
contract ChildChainGaugeCheckpointer is IL2LayerZeroDelegation {
    ChildChainGaugeRegistry private immutable _childChainGaugeRegistry;

    constructor(ChildChainGaugeRegistry childChainGaugeRegistry) {
        _childChainGaugeRegistry = childChainGaugeRegistry;
    }

    /// @inheritdoc IL2LayerZeroDelegation
    function onVeBalBridged(address user) external override {
        uint256 totalGauges = _childChainGaugeRegistry.totalGauges();
        IChildChainGauge[] memory gauges = _childChainGaugeRegistry.getGauges(0, totalGauges);
        for (uint256 i = 0; i < totalGauges; i++) {
            gauges[i].user_checkpoint(user);
        }
    }

    /// @inheritdoc IL2LayerZeroDelegation
    function onVeBalSupplyUpdate() external override {
        // solhint-disable-previous-line no-empty-blocks
    }
}
