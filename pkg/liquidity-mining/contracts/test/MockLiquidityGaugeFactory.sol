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

import "../gauges/BaseGaugeFactory.sol";
import "./MockLiquidityGauge.sol";

contract MockLiquidityGaugeFactory is BaseGaugeFactory {
    constructor(MockLiquidityGauge gaugeImplementation) BaseGaugeFactory(address(gaugeImplementation)) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function create(address pool, uint256 relativeWeightCap) external returns (address) {
        address gauge = _create();

        MockLiquidityGauge(gauge).initialize(pool, relativeWeightCap);

        return gauge;
    }
}
