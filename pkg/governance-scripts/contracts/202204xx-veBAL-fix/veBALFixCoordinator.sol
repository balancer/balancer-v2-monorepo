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
import "@balancer-labs/v2-liquidity-mining/contracts/interfaces/IBalancerTokenAdmin.sol";

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

// solhint-disable-next-line contract-name-camelcase
contract veBALFixCoordinator is ReentrancyGuard {
    IVault private immutable _vault;
    IAuthorizerAdaptor private immutable _authorizerAdaptor;
    IGaugeController private immutable _gaugeController;
    IBalancerTokenAdmin private immutable _balancerTokenAdmin;
   
    address public constant BAL_MINT_RECIPIENT = address(0);
    uint256 public constant BAL_MINT_AMOUNT = 98_600e18;

    enum DeploymentStage { PENDING, FIRST_STAGE_DONE }

    uint256 public firstStageActivationTime;

    DeploymentStage private _currentDeploymentStage;
    uint256 private immutable _activationScheduledTime;

    constructor(
        IAuthorizerAdaptor authorizerAdaptor,
        IBalancerTokenAdmin balancerTokenAdmin,
        IGaugeController gaugeController,
        uint256 activationScheduledTime
    ) {
        _currentDeploymentStage = DeploymentStage.PENDING;

        IVault vault = authorizerAdaptor.getVault();
        _vault = vault;
        _authorizerAdaptor = authorizerAdaptor;
        _balancerTokenAdmin = balancerTokenAdmin;
        _gaugeController = gaugeController;

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
        require(block.timestamp >= _activationScheduledTime, "Not ready for activation");
        require(_currentDeploymentStage == DeploymentStage.PENDING, "First step already performed");

        // Check external state: we need admin permission on the Authorizer
        ICurrentAuthorizer authorizer = getAuthorizer();
        require(authorizer.canPerform(bytes32(0), address(this), address(0)), "Not Authorizer admin");

        // Step 1: Deprecate the LM committee gauge type on the GaugeController.
        _deprecateLMCommittee();

        // Step 2: Mint BAL which was to be distributed to Polygon and Arbitrum LPs to a multisig for distribution.
        _mintMissingBAL();

        firstStageActivationTime = block.timestamp;
        _currentDeploymentStage = DeploymentStage.FIRST_STAGE_DONE;
    }

    function _deprecateLMCommittee() private {
        ICurrentAuthorizer authorizer = getAuthorizer();

        // The LM committee has been deprecated so we set the type weight to zero and kill the relevant gauge

        bytes32 changeTypeWeightRole = _authorizerAdaptor.getActionId(IGaugeController.change_type_weight.selector);
        authorizer.grantRole(changeTypeWeightRole, address(this));
        
        _setGaugeTypeWeight(IGaugeAdder.GaugeType.LiquidityMiningCommittee, 0);
        
        authorizer.revokeRole(changeTypeWeightRole, address(this));

        address lmCommitteeGauge = address(0);
        bytes32 killGaugeRole = _authorizerAdaptor.getActionId(ILiquidityGauge.killGauge.selector);
        authorizer.grantRole(killGaugeRole, address(this));
        
        _killGauge(lmCommitteeGauge);
        
        authorizer.revokeRole(killGaugeRole, address(this));
    }

    function _mintMissingBAL() private {
        ICurrentAuthorizer authorizer = getAuthorizer();

        // Mint BAL necessary to make Polygon and Arbitrum LPs whole.
        // See: https://forum.balancer.fi/t/decide-on-gauge-unexpected-behavior/2960#keeping-promises-13

        bytes32 mintBALRole = _balancerTokenAdmin.getActionId(IBalancerTokenAdmin.mint.selector);

        authorizer.grantRole(mintBALRole, address(this));
        _balancerTokenAdmin.mint(BAL_MINT_RECIPIENT, BAL_MINT_AMOUNT);
        authorizer.revokeRole(mintBALRole, address(this));
    }

    function _killGauge(address gauge) private {
        getAuthorizerAdaptor().performAction(gauge, abi.encodeWithSelector(ILiquidityGauge.killGauge.selector));
    }

    function _setGaugeTypeWeight(IGaugeAdder.GaugeType typeId, uint256 weight) private {
        getAuthorizerAdaptor().performAction(
            address(_gaugeController),
            abi.encodeWithSelector(IGaugeController.change_type_weight.selector, int128(typeId), weight)
        );
    }
}
