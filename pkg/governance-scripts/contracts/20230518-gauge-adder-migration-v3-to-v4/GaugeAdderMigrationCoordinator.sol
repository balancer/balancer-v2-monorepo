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

    ILiquidityGaugeFactory public immutable ethereumGaugeFactory;
    ILiquidityGaugeFactory public immutable polygonRootGaugeFactory;
    ILiquidityGaugeFactory public immutable arbitrumRootGaugeFactory;
    ILiquidityGaugeFactory public immutable optimismRootGaugeFactory;
    ILiquidityGaugeFactory public immutable gnosisRootGaugeFactory;
    ILiquidityGaugeFactory public immutable polygonZkEvmRootGaugeFactory;

    address public immutable liquidityMiningCommitteeMultisig;
    address public immutable gaugeCheckpointingMultisig;

    constructor(
        IAuthorizerAdaptor authorizerAdaptor,
        IGaugeAdder _newGaugeAdder,
        IGaugeAdder _oldGaugeAdder,
        ILiquidityGaugeFactory _ethereumGaugeFactory,
        ILiquidityGaugeFactory _polygonRootGaugeFactory,
        ILiquidityGaugeFactory _arbitrumRootGaugeFactory,
        ILiquidityGaugeFactory _optimismRootGaugeFactory,
        ILiquidityGaugeFactory _gnosisRootGaugeFactory,
        ILiquidityGaugeFactory _polygonZkvmMRootGaugeFactory,
        address _liquidityMiningCommitteeMultisig,
        address _gaugeCheckpointingMultisig
    ) BaseCoordinator(authorizerAdaptor) {
        newGaugeAdder = _newGaugeAdder;
        oldGaugeAdder = _oldGaugeAdder;
        ethereumGaugeFactory = _ethereumGaugeFactory;
        polygonRootGaugeFactory = _polygonRootGaugeFactory;
        arbitrumRootGaugeFactory = _arbitrumRootGaugeFactory;
        optimismRootGaugeFactory = _optimismRootGaugeFactory;
        gnosisRootGaugeFactory = _gnosisRootGaugeFactory;
        polygonZkEvmRootGaugeFactory = _polygonZkvmMRootGaugeFactory;
        liquidityMiningCommitteeMultisig = _liquidityMiningCommitteeMultisig;
        gaugeCheckpointingMultisig = _gaugeCheckpointingMultisig;

        IGaugeController gaugeControllerAddress = _newGaugeAdder.getGaugeController();
        require(
            gaugeControllerAddress == _oldGaugeAdder.getGaugeController(),
            "Gauge controller doesn't match on adders"
        );
        gaugeController = gaugeControllerAddress;
    }

    // Coordinator Setup

    function _registerStages() internal override {
        _registerStage(_firstStage);
    }

    function _firstStage() private {
        _setupNewGaugeAdder();
        _deprecateOldGaugeAdder();
    }

    function _afterLastStage() internal virtual override {
        ICurrentActualAuthorizer authorizer = _getActualAuthorizer();

        authorizer.renounceRole(authorizer.DEFAULT_ADMIN_ROLE(), address(this));
    }

    // Internal functions

    function _setupNewGaugeAdder() private {
        ICurrentActualAuthorizer authorizer = _getActualAuthorizer();

        {
            bytes32 addTypeRole = IAuthentication(address(newGaugeAdder)).getActionId(
                IGaugeAdder.addGaugeType.selector
            );
            authorizer.grantRole(addTypeRole, address(this));

            newGaugeAdder.addGaugeType("Ethereum");
            newGaugeAdder.addGaugeType("Polygon");
            newGaugeAdder.addGaugeType("Arbitrum");
            newGaugeAdder.addGaugeType("Optimism");
            newGaugeAdder.addGaugeType("Gnosis");
            newGaugeAdder.addGaugeType("PolygonZkEvm");
            newGaugeAdder.addGaugeType("ZkSync");
            authorizer.renounceRole(addTypeRole, address(this));
        }

        // Set up factories on new gauge adder.
        // Factories for Gnosis and ZKSync are not set as their factories are not deployed.
        {
            bytes32 setFactoryRole = IAuthentication(address(newGaugeAdder)).getActionId(
                IGaugeAdder.setGaugeFactory.selector
            );
            authorizer.grantRole(setFactoryRole, address(this));

            newGaugeAdder.setGaugeFactory(ethereumGaugeFactory, "Ethereum");
            newGaugeAdder.setGaugeFactory(polygonRootGaugeFactory, "Polygon");
            newGaugeAdder.setGaugeFactory(arbitrumRootGaugeFactory, "Arbitrum");
            newGaugeAdder.setGaugeFactory(optimismRootGaugeFactory, "Optimism");
            newGaugeAdder.setGaugeFactory(gnosisRootGaugeFactory, "Gnosis");
            newGaugeAdder.setGaugeFactory(polygonZkEvmRootGaugeFactory, "PolygonZkEvm");

            authorizer.renounceRole(setFactoryRole, address(this));
        }

        // Grant permissions for adding new Gauges.
        {
            bytes32 addGaugeRole = IAuthentication(address(newGaugeAdder)).getActionId(IGaugeAdder.addGauge.selector);

            authorizer.grantRole(addGaugeRole, liquidityMiningCommitteeMultisig);
        }

        // Grant the new GaugeAdder powers to add gauges to the GaugeController.
        bytes32 addGaugeRole = getAuthorizerAdaptor().getActionId(IGaugeController.add_gauge.selector);
        authorizer.grantRole(addGaugeRole, address(newGaugeAdder));
    }

    function _deprecateOldGaugeAdder() private {
        ICurrentActualAuthorizer authorizer = _getActualAuthorizer();

        // Revoke the powers to add gauges to the GaugeController from the old GaugeAdder.
        bytes32 addGaugeRole = getAuthorizerAdaptor().getActionId(IGaugeController.add_gauge.selector);
        authorizer.revokeRole(addGaugeRole, address(oldGaugeAdder));

        // `liquidityMiningCommitteeMultisig` retains the permissions to call functions on `oldGaugeAdder`.
        // This is acceptable as any interactions with `oldGaugeAdder` will fail as it can no longer interact
        // with the `GaugeController`.
    }

    function _getActualAuthorizer() private view returns (ICurrentActualAuthorizer) {
        return ICurrentAuthorizerWrapper(address(getAuthorizer())).getActualAuthorizer();
    }
}
