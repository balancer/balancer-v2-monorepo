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

import "./IAuthorizerAdaptor.sol";
import "./IGaugeController.sol";
import "./ILiquidityGauge.sol";
import "./ILiquidityGaugeFactory.sol";
import "./IStakingLiquidityGauge.sol";

interface IGaugeAdder is IAuthentication {
    enum GaugeType { LiquidityMiningCommittee, veBAL, Ethereum, Polygon, Arbitrum }

    event GaugeFactoryAdded(GaugeType indexed gaugeType, ILiquidityGaugeFactory gaugeFactory);

    /**
     * @notice Returns the address of the Gauge Controller
     */
    function getGaugeController() external view returns (IGaugeController);

    /**
     * @notice Returns the gauge corresponding to a Balancer pool `pool` on Ethereum mainnet.
     * Only returns gauges which have been added to the Gauge Controller.
     * @dev Gauge Factories also implement a `getPoolGauge` function which maps pools to gauges which it has deployed.
     * This function provides global information by using which gauge has been added to the Gauge Controller
     * to represent the canonical gauge for a given pool address.
     */
    function getPoolGauge(IERC20 pool) external view returns (ILiquidityGauge);

    /**
     * @notice Returns the `index`'th factory for gauge type `gaugeType`
     */
    function getFactoryForGaugeType(GaugeType gaugeType, uint256 index) external view returns (address);

    /**
     * @notice Returns the number of factories for gauge type `gaugeType`
     */
    function getFactoryForGaugeTypeCount(GaugeType gaugeType) external view returns (uint256);

    /**
     * @notice Returns whether `gauge` has been deployed by one of the listed factories for the gauge type `gaugeType`
     */
    function isGaugeFromValidFactory(address gauge, GaugeType gaugeType) external view returns (bool);

    /**
     * @notice Adds a new gauge to the GaugeController for the "Ethereum" type.
     */
    function addEthereumGauge(IStakingLiquidityGauge gauge) external;

    /**
     * @notice Adds a new gauge to the GaugeController for the "Polygon" type.
     * This function must be called with the address of the *root* gauge which is deployed on Ethereum mainnet.
     * It should not be called with the address of the gauge which is deployed on Polygon
     */
    function addPolygonGauge(address rootGauge) external;

    /**
     * @notice Adds a new gauge to the GaugeController for the "Arbitrum" type.
     * This function must be called with the address of the *root* gauge which is deployed on Ethereum mainnet.
     * It should not be called with the address of the gauge which is deployed on Arbitrum
     */
    function addArbitrumGauge(address rootGauge) external;

    /**
     * @notice Adds `factory` as an allowlisted factory contract for gauges with type `gaugeType`.
     */
    function addGaugeFactory(ILiquidityGaugeFactory factory, GaugeType gaugeType) external;
}
