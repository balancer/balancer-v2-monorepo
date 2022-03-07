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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "./interfaces/IAuthorizerAdaptor.sol";
import "./interfaces/IGaugeController.sol";
import "./interfaces/ILiquidityGauge.sol";
import "./interfaces/ILiquidityGaugeFactory.sol";

contract GaugeAdder is Authentication, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;

    IVault private immutable _vault;
    IGaugeController private immutable _gaugeController;
    IAuthorizerAdaptor private _authorizerAdaptor;

    // TODO: Ensure that these align with the types as set on the GaugeController
    // Failure to do so will result in an irrecoverably broken GaugeController state.
    enum GaugeType { LiquidityMiningCommittee, veBAL, Ethereum, Polygon, Arbitrum }

    // Mapping from gauge type to a list of address for approved factories for that type
    mapping(GaugeType => EnumerableSet.AddressSet) internal _gaugeFactoriesByType;

    event GaugeFactoryAdded(GaugeType indexed gaugeType, ILiquidityGaugeFactory gaugeFactory);

    constructor(IGaugeController gaugeController, IAuthorizerAdaptor authorizerAdaptor)
        Authentication(bytes32(uint256(address(this))))
    {
        // GaugeAdder is a singleton, so it simply uses its own address to disambiguate action identifiers
        _vault = authorizerAdaptor.getVault();
        _gaugeController = gaugeController;
        _authorizerAdaptor = authorizerAdaptor;
    }

    /**
     * @notice Returns the Balancer Vault
     */
    function getVault() public view returns (IVault) {
        return _vault;
    }

    /**
     * @notice Returns the Balancer Vault's current authorizer.
     */
    function getAuthorizer() public view returns (IAuthorizer) {
        return getVault().getAuthorizer();
    }

    /**
     * @notice Returns the address of the Authorizer adaptor contract.
     */
    function getAuthorizerAdaptor() external view returns (IAuthorizerAdaptor) {
        return _authorizerAdaptor;
    }

    /**
     * @notice Returns the address of the Gauge Controller
     */
    function getGaugeController() external view returns (address) {
        return address(_gaugeController);
    }

    /**
     * @notice Returns whether `gauge` has been deployed by one of the listed factories for the gauge type `gaugeType`
     */
    function isGaugeFromValidFactory(address gauge, GaugeType gaugeType) public view returns (bool) {
        EnumerableSet.AddressSet storage gaugeFactories = _gaugeFactoriesByType[gaugeType];
        uint256 gaugeFactoriesLength = gaugeFactories.length();

        // This potentially unbounded loop isn't an issue as the GaugeAdder may be redeployed
        // without affecting the rest of the system.
        for (uint256 i; i < gaugeFactoriesLength; ++i) {
            if (ILiquidityGaugeFactory(gaugeFactories.unchecked_at(i)).isGaugeFromFactory(gauge)) {
                return true;
            }
        }

        return false;
    }

    // Admin Functions

    // Functions for the "LiquidityMiningCommittee" and "veBAL" types are purposefully omitted as there is
    // no reason for new gauges to be deployed for these types so there is no need to expose methods to add them.

    /**
     * @notice Adds a new gauge to the GaugeController for the "Ethereum" type.
     */
    function addEthereumGauge(address gauge) external authenticate {
        _addGauge(gauge, GaugeType.Ethereum);
    }

    /**
     * @notice Adds a new gauge to the GaugeController for the "Polygon" type.
     * This function must be called with the address of the *root* gauge which is deployed on Ethereum mainnet.
     * It should not be called with the address of the gauge which is deployed on Polygon
     */
    function addPolygonGauge(address rootGauge) external authenticate {
        _addGauge(rootGauge, GaugeType.Polygon);
    }

    /**
     * @notice Adds a new gauge to the GaugeController for the "Arbitrum" type.
     * This function must be called with the address of the *root* gauge which is deployed on Ethereum mainnet.
     * It should not be called with the address of the gauge which is deployed on Arbitrum
     */
    function addArbitrumGauge(address rootGauge) external authenticate {
        _addGauge(rootGauge, GaugeType.Arbitrum);
    }

    /**
     * @notice Adds `factory` as an allowlisted factory contract for gauges with type `gaugeType`.
     */
    function addGaugeFactory(ILiquidityGaugeFactory factory, GaugeType gaugeType) external authenticate {
        // Casting is safe as n_gauge_types return value is >= 0.
        require(uint256(gaugeType) < uint256(_gaugeController.n_gauge_types()), "Invalid gauge type");

        // Sanity check that calling `isGaugeFromFactory` won't revert
        require(!factory.isGaugeFromFactory(address(0)), "Invalid factory implementation");

        EnumerableSet.AddressSet storage gaugeFactories = _gaugeFactoriesByType[gaugeType];
        require(gaugeFactories.add(address(factory)), "Factory already added");

        emit GaugeFactoryAdded(gaugeType, factory);
    }

    // Internal functions

    function _canPerform(bytes32 actionId, address account) internal view override returns (bool) {
        return getAuthorizer().canPerform(actionId, account, address(this));
    }

    /**
     * @dev Adds `gauge` to the GaugeController with type `gaugeType` and an initial weight of zero
     */
    function _addGauge(address gauge, GaugeType gaugeType) private {
        require(isGaugeFromValidFactory(gauge, gaugeType), "Invalid gauge");

        // `_gaugeController` enforces that duplicate gauges may not be added so we do not need to check here.
        _authorizerAdaptor.performAction(
            address(_gaugeController),
            abi.encodeWithSelector(IGaugeController.add_gauge.selector, gauge, gaugeType, 0)
        );
    }
}
