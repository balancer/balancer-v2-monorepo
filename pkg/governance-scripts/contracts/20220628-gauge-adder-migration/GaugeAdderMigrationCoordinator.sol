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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IArbitrumFeeProvider.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeAdder.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IOptimismGasLimitProvider.sol";

import "../BaseCoordinator.sol";

contract GaugeAdderMigrationCoordinator is BaseCoordinator {
    IGaugeAdder public immutable newGaugeAdder;
    IGaugeAdder public immutable oldGaugeAdder;

    IGaugeController public immutable gaugeController;

    ILiquidityGaugeFactory public immutable arbitrumRootGaugeFactory;
    ILiquidityGaugeFactory public immutable optimismRootGaugeFactory;

    address public immutable liquidityMiningCommitteeMultisig;
    address public immutable gaugeCheckpointingMultisig;

    constructor(
        IAuthorizerAdaptor authorizerAdaptor,
        IGaugeAdder _newGaugeAdder,
        IGaugeAdder _oldGaugeAdder,
        ILiquidityGaugeFactory _arbitrumRootGaugeFactory,
        ILiquidityGaugeFactory _optimismRootGaugeFactory,
        address _liquidityMiningCommitteeMultisig,
        address _gaugeCheckpointingMultisig
    ) BaseCoordinator(authorizerAdaptor) {
        newGaugeAdder = _newGaugeAdder;
        oldGaugeAdder = _oldGaugeAdder;
        arbitrumRootGaugeFactory = _arbitrumRootGaugeFactory;
        optimismRootGaugeFactory = _optimismRootGaugeFactory;
        liquidityMiningCommitteeMultisig = _liquidityMiningCommitteeMultisig;
        gaugeCheckpointingMultisig = _gaugeCheckpointingMultisig;

        gaugeController = _newGaugeAdder.getGaugeController();
    }

    // Coordinator Setup

    function _registerStages() internal override {
        _registerStage(_firstStage);
    }

    function _firstStage() private {
        _grantPermissionsOverBridgeParameters();
        _setupOptimismGaugeType();
        _setupNewGaugeAdder();
        _deprecateOldGaugeAdder();
    }

    function _afterLastStage() internal virtual override {
        ICurrentAuthorizer authorizer = ICurrentAuthorizer(address(getAuthorizer()));

        authorizer.renounceRole(authorizer.DEFAULT_ADMIN_ROLE(), address(this));
    }

    // Internal functions

    function _grantPermissionsOverBridgeParameters() private {
        ICurrentAuthorizer authorizer = ICurrentAuthorizer(address(getAuthorizer()));

        authorizer.grantRole(
            IAuthentication(address(arbitrumRootGaugeFactory)).getActionId(
                IArbitrumFeeProvider.setArbitrumFees.selector
            ),
            gaugeCheckpointingMultisig
        );
        authorizer.grantRole(
            IAuthentication(address(optimismRootGaugeFactory)).getActionId(
                IOptimismGasLimitProvider.setOptimismGasLimit.selector
            ),
            gaugeCheckpointingMultisig
        );
    }

    function _setupOptimismGaugeType() private {
        ICurrentAuthorizer authorizer = ICurrentAuthorizer(address(getAuthorizer()));

        bytes32 addGaugeTypeRole = getAuthorizerAdaptor().getActionId(IGaugeController.add_type.selector);
        authorizer.grantRole(addGaugeTypeRole, address(this));

        // Create "Optimism" gauge type on GaugeController.
        // All types on the Gauge controller have equal type weights of 1e18.
        uint256 typeWeight = 1e18;
        getAuthorizerAdaptor().performAction(
            address(gaugeController),
            abi.encodeWithSelector(IGaugeController.add_type.selector, "Optimism", typeWeight)
        );

        authorizer.renounceRole(addGaugeTypeRole, address(this));
    }

    function _setupNewGaugeAdder() private {
        ICurrentAuthorizer authorizer = ICurrentAuthorizer(address(getAuthorizer()));

        // Migrate factories from old GaugeAdder.
        {
            bytes32 addFactoryRole = IAuthentication(address(newGaugeAdder)).getActionId(
                IGaugeAdder.addGaugeFactory.selector
            );
            authorizer.grantRole(addFactoryRole, address(this));

            // Copy across gauge factories from previous GaugeAdder.
            // Only one factory exists for each gauge type so this is sufficient.
            newGaugeAdder.addGaugeFactory(
                ILiquidityGaugeFactory(oldGaugeAdder.getFactoryForGaugeType(IGaugeAdder.GaugeType.Ethereum, 0)),
                IGaugeAdder.GaugeType.Ethereum
            );
            newGaugeAdder.addGaugeFactory(
                ILiquidityGaugeFactory(oldGaugeAdder.getFactoryForGaugeType(IGaugeAdder.GaugeType.Polygon, 0)),
                IGaugeAdder.GaugeType.Polygon
            );
            newGaugeAdder.addGaugeFactory(
                ILiquidityGaugeFactory(oldGaugeAdder.getFactoryForGaugeType(IGaugeAdder.GaugeType.Arbitrum, 0)),
                IGaugeAdder.GaugeType.Arbitrum
            );

            // Add the new factory for Optimism gauges.
            newGaugeAdder.addGaugeFactory(optimismRootGaugeFactory, IGaugeAdder.GaugeType.Optimism);

            authorizer.renounceRole(addFactoryRole, address(this));
        }

        // Grant permissions for adding new Gauges.
        // Permissions for Gnosis and ZKSync are not granted.
        {
            bytes32 addEthereumGaugeRole = IAuthentication(address(newGaugeAdder)).getActionId(
                IGaugeAdder.addEthereumGauge.selector
            );
            bytes32 addPolygonGaugeRole = IAuthentication(address(newGaugeAdder)).getActionId(
                IGaugeAdder.addPolygonGauge.selector
            );
            bytes32 addArbitrumGaugeRole = IAuthentication(address(newGaugeAdder)).getActionId(
                IGaugeAdder.addArbitrumGauge.selector
            );
            bytes32 addOptimismGaugeRole = IAuthentication(address(newGaugeAdder)).getActionId(
                IGaugeAdder.addOptimismGauge.selector
            );

            authorizer.grantRole(addEthereumGaugeRole, liquidityMiningCommitteeMultisig);
            authorizer.grantRole(addPolygonGaugeRole, liquidityMiningCommitteeMultisig);
            authorizer.grantRole(addArbitrumGaugeRole, liquidityMiningCommitteeMultisig);
            authorizer.grantRole(addOptimismGaugeRole, liquidityMiningCommitteeMultisig);
        }

        // Grant the new GaugeAdder powers to add gauges to the GaugeController.
        bytes32 addGaugeRole = getAuthorizerAdaptor().getActionId(IGaugeController.add_gauge.selector);
        authorizer.grantRole(addGaugeRole, address(newGaugeAdder));
    }

    function _deprecateOldGaugeAdder() private {
        ICurrentAuthorizer authorizer = ICurrentAuthorizer(address(getAuthorizer()));

        // Revoke the powers to add gauges to the GaugeController from the old GaugeAdder.
        bytes32 addGaugeRole = getAuthorizerAdaptor().getActionId(IGaugeController.add_gauge.selector);
        authorizer.revokeRole(addGaugeRole, address(oldGaugeAdder));

        // `liquidityMiningCommitteeMultisig` retains the permissions to call functions on `oldGaugeAdder`.
        // This is acceptable as any interactions with `oldGaugeAdder` will fail as it can no longer interact
        // with the `GaugeController`. Eventually these roles will be omitted in the Authorizer migration and disappear.
    }
}
