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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ILiquidityGaugeFactory.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Clones.sol";

import "./MockLiquidityGauge.sol";

contract MockLiquidityGaugeFactory is ILiquidityGaugeFactory {
    mapping(address => bool) private _isGaugeFromFactory;
    mapping(address => address) private _poolGauge;

    event GaugeCreated(address indexed gauge, address indexed pool);

    /**
     * @notice Returns the address of the gauge belonging to `pool`.
     */
    function getPoolGauge(address pool) external view returns (ILiquidityGauge) {
        return ILiquidityGauge(_poolGauge[pool]);
    }

    /**
     * @notice Returns true if `gauge` was created by this factory.
     */
    function isGaugeFromFactory(address gauge) external view override returns (bool) {
        return _isGaugeFromFactory[gauge];
    }

    function create(address pool) external override returns (address) {
        require(_poolGauge[pool] == address(0), "Gauge already exists");

        address gauge = address(new MockLiquidityGauge(pool));

        _isGaugeFromFactory[gauge] = true;
        _poolGauge[pool] = gauge;
        emit GaugeCreated(gauge, pool);

        return gauge;
    }
}
