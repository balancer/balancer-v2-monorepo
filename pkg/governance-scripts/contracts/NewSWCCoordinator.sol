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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IVotingEscrow.sol";

import "@balancer-labs/v2-liquidity-mining/contracts/SmartWalletChecker.sol";

import "./BaseCoordinator.sol";

contract SmartWalletCheckerCoordinator is BaseCoordinator {
    IVotingEscrow private immutable _votingEscrow;

    SmartWalletChecker private immutable _smartWalletChecker;

    address public constant GOV_MULTISIG = 0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f;

    uint256 public firstStageActivationTime;

    constructor(
        IAuthorizerAdaptor authorizerAdaptor,
        IVotingEscrow votingEscrow,
        SmartWalletChecker smartWalletChecker
    ) BaseCoordinator(authorizerAdaptor, 0) {
        _votingEscrow = votingEscrow;
        _smartWalletChecker = smartWalletChecker;
    }

    function _performNextStage(uint256 deploymentStage) internal override {
        if (deploymentStage == 0) {
            // Step 1: Activate a SmartWalletChecker contract for veBAL
            //
            // This allows an allowlisted set of contracts to lock veBAL,
            // contracts are generally prevented from doing so.
            _setSmartWalletChecker();

            // Step 2: Allow the Governance multisig to allow/denylist future smart contracts to mint veBAL
            _setSmartWalletCheckerPermissions();
        } else {
            // We should have reverted in BaseCoordinator before reaching this block.
            revert("Invalid deployment stage");
        }
    }

    function _setSmartWalletChecker() private {
        ICurrentAuthorizer authorizer = getAuthorizer();
        bytes32 commitSmartWalletCheckerRole = getAuthorizerAdaptor().getActionId(
            IVotingEscrow.commit_smart_wallet_checker.selector
        );
        bytes32 applySmartWalletCheckerRole = getAuthorizerAdaptor().getActionId(
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
