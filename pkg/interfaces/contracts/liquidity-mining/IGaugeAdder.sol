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

pragma solidity >=0.7.0 <0.9.0;
pragma experimental ABIEncoderV2;

import "./IAuthorizerAdaptorEntrypoint.sol";
import "./IGaugeController.sol";
import "./ILiquidityGauge.sol";
import "./ILiquidityGaugeFactory.sol";
import "./IStakingLiquidityGauge.sol";

interface IGaugeAdder is IAuthentication {
    // Deprecated. TODO: remove from interfaces, and remove references.
    enum GaugeType { LiquidityMiningCommittee, veBAL, Ethereum, Polygon, Arbitrum, Optimism, Gnosis, ZKSync }

    event GaugeFactorySet(string indexed gaugeType, ILiquidityGaugeFactory gaugeFactory);

    /**
     * @notice Returns the address of the Authorizer adaptor entrypoint contract.
     */
    function getAuthorizerAdaptorEntrypoint() external view returns (IAuthorizerAdaptorEntrypoint);

    /**
     * @notice Returns the address of the Gauge Controller
     */
    function getGaugeController() external view returns (IGaugeController);

    /**
     * @notice Returns list of allowlisted gauge types.
     */
    function getGaugeTypes() external view returns (string[] memory);

    /**
     * @notice Returns the factory for gauge type `gaugeType`.
     */
    function getFactoryForGaugeType(string memory gaugeType) external view returns (ILiquidityGaugeFactory);

    /**
     * @notice Returns true if `gauge` has been deployed by the factory for the gauge type `gaugeType`; false otherwise.
     */
    function isGaugeFromValidFactory(address gauge, string memory gaugeType) external view returns (bool);


    /**
     * @notice Adds a new `gaugeType` corresponding to a new network, which allows setting a factory and adding gauges
     * for the type later on.
     * @param gaugeType Name of the new gauge type.
     * @param typeNumber Type identification that should match the one in the gauge controller.
     */
    function addGaugeType(string memory gaugeType, int128 typeNumber) external;

    /**
     * @notice Adds a new gauge to the GaugeController for the given `gaugeType` type.
     * @dev This function must be called with the address of the *root* gauge which is deployed on Ethereum mainnet.
     * It should not be called with the address of the child gauge which is deployed on the L2 / sidechain.
     *
     * If the gauge added is an Ethereum gauge, it cannot be a gauge for the 80BAL-20WETH pool.
     */
    function addGauge(address gauge, string memory gaugeType) external;

    /**
     * @notice Sets `factory` as the allowlisted factory contract for gauges with type `gaugeType`.
     * @dev This function can either set a new factory or replace an existing one.
     */
    function setGaugeFactory(ILiquidityGaugeFactory factory, string memory gaugeType) external;
}
