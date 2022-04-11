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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "@balancer-labs/v2-liquidity-mining/contracts/interfaces/IAuthorizerAdaptor.sol";
import "@balancer-labs/v2-liquidity-mining/contracts/interfaces/IGaugeAdder.sol";
import "@balancer-labs/v2-liquidity-mining/contracts/interfaces/IGaugeController.sol";
import "@balancer-labs/v2-liquidity-mining/contracts/interfaces/IBalancerMinter.sol";
import "@balancer-labs/v2-liquidity-mining/contracts/interfaces/IBalancerTokenAdmin.sol";
import "@balancer-labs/v2-liquidity-mining/contracts/interfaces/ILiquidityGaugeFactory.sol";
import "@balancer-labs/v2-liquidity-mining/contracts/interfaces/ISingleRecipientGaugeFactory.sol";
import "@balancer-labs/v2-standalone-utils/contracts/interfaces/IBALTokenHolderFactory.sol";

// solhint-disable not-rely-on-time

/**
 * @dev The currently deployed Authorizer has a different interface relative to the Authorizer in the monorepo
 * for granting/revoking roles(referred to as permissions in the new Authorizer) and so we require a one-off interface
 */
interface ICurrentAuthorizer is IAuthorizer {
    // solhint-disable-next-line func-name-mixedcase
    function DEFAULT_ADMIN_ROLE() external view returns (bytes32);

    function grantRole(bytes32 role, address account) external;

    function revokeRole(bytes32 role, address account) external;
}

// https://vote.balancer.fi/#/proposal/0x9fe19c491cf90ed2e3ed9c15761c43d39fd1fb732a940aba8058ff69787ee90a
// solhint-disable-next-line contract-name-camelcase
contract veBALL2Coordinator is ReentrancyGuard {
    IVault private immutable _vault;
    IAuthorizerAdaptor private immutable _authorizerAdaptor;
    IVotingEscrow private immutable _votingEscrow;
    IGaugeAdder private immutable _gaugeAdder;
    ILiquidityGaugeFactory private immutable _ethereumGaugeFactory;
    ISingleRecipientGaugeFactory private immutable _polygonGaugeFactory;
    ISingleRecipientGaugeFactory private immutable _arbitrumGaugeFactory;

    enum DeploymentStage { PENDING, FIRST_STAGE_DONE }

    uint256 public firstStageActivationTime;

    DeploymentStage private _currentDeploymentStage;
    uint256 private immutable _activationScheduledTime;

    constructor(
        IAuthorizerAdaptor authorizerAdaptor,
        IVotingEscrow votingEscrow,
        IGaugeAdder gaugeAdder,
        ILiquidityGaugeFactory ethereumGaugeFactory,
        ISingleRecipientGaugeFactory polygonGaugeFactory,
        ISingleRecipientGaugeFactory arbitrumGaugeFactory,
        uint256 activationScheduledTime
    ) {
        _currentDeploymentStage = DeploymentStage.PENDING;

        IVault vault = authorizerAdaptor.getVault();
        _vault = vault;
        _authorizerAdaptor = authorizerAdaptor;
        _votingEscrow = votingEscrow;
        _gaugeAdder = gaugeAdder;
        _ethereumGaugeFactory = ethereumGaugeFactory;
        _polygonGaugeFactory = polygonGaugeFactory;
        _arbitrumGaugeFactory = arbitrumGaugeFactory;

        _activationScheduledTime = activationScheduledTime;
    }

    /**
     * @notice Returns the Balancer Vault.
     */
    function getVault() public view returns (IVault) {
        return _vault;
    }

    /**
     * @notice Returns the Balancer Vault's current authorizer.
     */
    function getAuthorizer() public view returns (ICurrentAuthorizer) {
        return ICurrentAuthorizer(address(getVault().getAuthorizer()));
    }

    function getAuthorizerAdaptor() public view returns (IAuthorizerAdaptor) {
        return _authorizerAdaptor;
    }

    function getCurrentDeploymentStage() external view returns (DeploymentStage) {
        return _currentDeploymentStage;
    }

    function getActivationScheduledTime() external view returns (uint256) {
        return _activationScheduledTime;
    }

    function performFirstStage() external nonReentrant {
        // Check internal state
        require(_currentDeploymentStage == DeploymentStage.PENDING, "First step already performed");

        // Check external state: we need admin permission on the Authorizer
        ICurrentAuthorizer authorizer = getAuthorizer();
        require(authorizer.canPerform(bytes32(0), address(this), address(0)), "Not Authorizer admin");

        // Step 1: Add new gauges to the GaugeController
        _addNewEthereumGauges();

        // Step 2: Allowlist factories for the Polygon and Arbitrum gauge types
        //
        // This allows gauges deployed from these factories to be added to Gauge Controller
        _addPolygonAndArbitrumGaugeFactories();

        // Step 3: Deploy Polygon gauges and add them to the Gauge Controller
        _addNewPolygonGauges();

        // Step 4: Deploy Arbitrum gauges and add them to the Gauge Controller
        _addNewArbitrumGauges();

        firstStageActivationTime = block.timestamp;
        _currentDeploymentStage = DeploymentStage.FIRST_STAGE_DONE;
    }

    function _addNewEthereumGauges() private {
        // TODO: fill out list of gauges
        // All these addresses are required to be mainnet gauges which have already been deployed
        address[] memory newGauges = new address[](0);

        ICurrentAuthorizer authorizer = getAuthorizer();
        bytes32 addEthereumGaugeRole = _gaugeAdder.getActionId(IGaugeAdder.addEthereumGauge.selector);

        authorizer.grantRole(addEthereumGaugeRole, address(this));

        uint256 gaugesLength = newGauges.length;
        for (uint256 i = 0; i < gaugesLength; i++) {
            _gaugeAdder.addEthereumGauge(IStakingLiquidityGauge(newGauges[i]));
        }

        authorizer.revokeRole(addEthereumGaugeRole, address(this));
    }

    function _addPolygonAndArbitrumGaugeFactories() private {
        ICurrentAuthorizer authorizer = getAuthorizer();
        bytes32 addGaugeFactoryRole = _gaugeAdder.getActionId(IGaugeAdder.addGaugeFactory.selector);

        authorizer.grantRole(addGaugeFactoryRole, address(this));

        _gaugeAdder.addGaugeFactory(_polygonGaugeFactory, IGaugeAdder.GaugeType.Polygon);
        _gaugeAdder.addGaugeFactory(_arbitrumGaugeFactory, IGaugeAdder.GaugeType.Arbitrum);

        authorizer.revokeRole(addGaugeFactoryRole, address(this));
    }

    function _addNewPolygonGauges() private {
        // TODO: fill out list of recipients
        // All these addresses are required to match ChildChainStreamers which have been deployed to Polygon mainnet.
        address[] memory initialRecipients = new address[](0);

        ICurrentAuthorizer authorizer = getAuthorizer();
        bytes32 addPolygonGaugeRole = _gaugeAdder.getActionId(IGaugeAdder.addPolygonGauge.selector);

        authorizer.grantRole(addPolygonGaugeRole, address(this));

        uint256 initialRecipientsLength = initialRecipients.length;
        for (uint256 i = 0; i < initialRecipientsLength; i++) {
            address gauge = _deployGauge(_polygonGaugeFactory, initialRecipients[i]);
            _gaugeAdder.addPolygonGauge(gauge);
        }

        authorizer.revokeRole(addPolygonGaugeRole, address(this));
    }

    function _addNewArbitrumGauges() private {
        // TODO: fill out list of recipients
        // All these addresses are required to match ChildChainStreamers which have been deployed to Arbitrum One.
        address[] memory initialRecipients = new address[](0);

        ICurrentAuthorizer authorizer = getAuthorizer();
        bytes32 addArbitrumGaugeRole = _gaugeAdder.getActionId(IGaugeAdder.addArbitrumGauge.selector);

        authorizer.grantRole(addArbitrumGaugeRole, address(this));

        uint256 initialRecipientsLength = initialRecipients.length;
        for (uint256 i = 0; i < initialRecipientsLength; i++) {
            address gauge = _deployGauge(_arbitrumGaugeFactory, initialRecipients[i]);
            _gaugeAdder.addArbitrumGauge(gauge);
        }

        authorizer.revokeRole(addArbitrumGaugeRole, address(this));
    }

    function _deployGauge(ISingleRecipientGaugeFactory factory, address recipient) private returns (address gauge) {
        // Find gauge which distributes BAL to listed recipient
        gauge = address(factory.getRecipientGauge(recipient));
        if (gauge == address(0)) {
            // If gauge doesn't exist yet then create one.
            gauge = factory.create(recipient);
        }
    }
}
