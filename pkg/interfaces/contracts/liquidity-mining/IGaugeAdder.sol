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

    // String values are hashed when indexed, so we also emit the raw string as a data field for ease of use.
    event GaugeTypeAdded(string indexed indexedGaugeType, string gaugeType);
    event GaugeFactorySet(string indexed indexedGaugeType, string gaugeType, ILiquidityGaugeFactory gaugeFactory);

    /**
     * @notice Returns the address of the Authorizer adaptor entrypoint contract.
     */
    function getAuthorizerAdaptorEntrypoint() external view returns (IAuthorizerAdaptorEntrypoint);

    /**
     * @notice Returns the address of the Gauge Controller
     */
    function getGaugeController() external view returns (IGaugeController);

    /**
     * @notice Returns the list of gauge types.
     */
    function getGaugeTypes() external view returns (string[] memory);

    /**
     * @notice Returns gauge type name registered at the given index.
     */
    function getGaugeTypeAtIndex(uint256 index) external view returns (string memory);

    /**
     * @notice Returns the number of gauge types.
     */
    function getGaugeTypesCount() external view returns (uint256);

    /**
     * @notice Returns true if the given gauge type is valid; false otherwise.
     */
    function isValidGaugeType(string memory gaugeType) external view returns (bool);

    /**
     * @notice Returns the factory for gauge type `gaugeType`.
     */
    function getFactoryForGaugeType(string memory gaugeType) external view returns (ILiquidityGaugeFactory);

    /**
     * @notice Returns true if `gauge` has been deployed by the factory for the gauge type `gaugeType`.
     * Note that if a gauge type's factory changes then this function will start returning false for previously
     * valid gauges.
     */
    function isGaugeFromValidFactory(address gauge, string memory gaugeType) external view returns (bool);

    /**
     * @notice Adds a new `gaugeType` corresponding to a new network, which allows setting a factory and adding gauges
     * for the type later on.
     * @param gaugeType Name of the new gauge type.
     */
    function addGaugeType(string memory gaugeType) external;

    /**
     * @notice Adds a new gauge to the GaugeController for the given `gaugeType` type.
     * @dev When adding gauges for L2 networks or sidechains, this must be called with the address of the *root* gauge
     * which is deployed on Ethereum. It should *not* be called with the address of the child gauge which is deployed on
     * the L2 / sidechain.
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
