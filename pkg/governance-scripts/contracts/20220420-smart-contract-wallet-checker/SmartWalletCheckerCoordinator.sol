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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IAuthorizerAdaptor.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IVotingEscrow.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-liquidity-mining/contracts/SmartWalletChecker.sol";

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
contract SmartWalletCheckerCoordinator is ReentrancyGuard {
    IVault private immutable _vault;
    IAuthorizerAdaptor private immutable _authorizerAdaptor;
    IVotingEscrow private immutable _votingEscrow;

    SmartWalletChecker private immutable _smartWalletChecker;

    address public constant GOV_MULTISIG = 0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f;

    enum DeploymentStage { PENDING, FIRST_STAGE_DONE }

    uint256 public firstStageActivationTime;

    DeploymentStage private _currentDeploymentStage;

    constructor(
        IAuthorizerAdaptor authorizerAdaptor,
        IVotingEscrow votingEscrow,
        SmartWalletChecker smartWalletChecker
    ) {
        _currentDeploymentStage = DeploymentStage.PENDING;

        IVault vault = authorizerAdaptor.getVault();
        _vault = vault;
        _authorizerAdaptor = authorizerAdaptor;
        _votingEscrow = votingEscrow;
        _smartWalletChecker = smartWalletChecker;
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

    function performFirstStage() external nonReentrant {
        // Check internal state
        require(_currentDeploymentStage == DeploymentStage.PENDING, "First step already performed");

        // Check external state: we need admin permission on the Authorizer
        ICurrentAuthorizer authorizer = getAuthorizer();
        require(authorizer.canPerform(bytes32(0), address(this), address(0)), "Not Authorizer admin");

        // Step 1: Activate a SmartWalletChecker contract for veBAL
        //
        // This allows an allowlisted set of contracts to lock veBAL, contracts are generally prevented from doing so.
        _setSmartWalletChecker();

        // Step 2: Allow the Governance multisig to allow/denylist future smart contracts to mint veBAL
        _setSmartWalletCheckerPermissions();

        authorizer.revokeRole(bytes32(0), address(this));

        firstStageActivationTime = block.timestamp;
        _currentDeploymentStage = DeploymentStage.FIRST_STAGE_DONE;
    }

    function _setSmartWalletChecker() private {
        ICurrentAuthorizer authorizer = getAuthorizer();
        bytes32 commitSmartWalletCheckerRole = _authorizerAdaptor.getActionId(
            IVotingEscrow.commit_smart_wallet_checker.selector
        );
        bytes32 applySmartWalletCheckerRole = _authorizerAdaptor.getActionId(
            IVotingEscrow.apply_smart_wallet_checker.selector
        );

        authorizer.grantRole(commitSmartWalletCheckerRole, address(this));
        getAuthorizerAdaptor().performAction(
            address(_votingEscrow),
            abi.encodeWithSelector(IVotingEscrow.commit_smart_wallet_checker.selector, _smartWalletChecker)
        );
        authorizer.revokeRole(commitSmartWalletCheckerRole, address(this));

        authorizer.grantRole(applySmartWalletCheckerRole, address(this));
        getAuthorizerAdaptor().performAction(
            address(_votingEscrow),
            abi.encodeWithSelector(IVotingEscrow.apply_smart_wallet_checker.selector)
        );
        authorizer.revokeRole(applySmartWalletCheckerRole, address(this));

        require(
            _votingEscrow.smart_wallet_checker() == address(_smartWalletChecker),
            "Smart wallet checker not set correctly"
        );
    }

    function _setSmartWalletCheckerPermissions() private {
        ICurrentAuthorizer authorizer = getAuthorizer();
        bytes32 allowlistAddressRole = _smartWalletChecker.getActionId(SmartWalletChecker.allowlistAddress.selector);
        bytes32 denylistAddressRole = _smartWalletChecker.getActionId(SmartWalletChecker.denylistAddress.selector);

        authorizer.grantRole(allowlistAddressRole, GOV_MULTISIG);
        authorizer.grantRole(denylistAddressRole, GOV_MULTISIG);
    }
}
