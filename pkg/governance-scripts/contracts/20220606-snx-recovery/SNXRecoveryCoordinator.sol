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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IProtocolFeesWithdrawer.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";

import "../BaseCoordinator.sol";

contract SNXRecoveryCoordinator is BaseCoordinator {
    IProtocolFeesWithdrawer public immutable protocolFeesWithdrawer;

    IERC20[] public tokens;
    uint256[] public refundAmounts;

    constructor(
        IAuthorizerAdaptor authorizerAdaptor,
        IProtocolFeesWithdrawer _protocolFeesWithdrawer,
        IERC20[] memory _tokens,
        uint256[] memory _refundAmounts
    ) BaseCoordinator(authorizerAdaptor) {
        uint256 tokensLength = _tokens.length;
        InputHelpers.ensureInputLengthMatch(tokensLength, _refundAmounts.length);

        for (uint256 i = 0; i < tokensLength; i++) {
            require(!_protocolFeesWithdrawer.isWithdrawableToken(_tokens[i]), "Token is already withdrawable");
        }

        protocolFeesWithdrawer = _protocolFeesWithdrawer;
        tokens = _tokens;
        refundAmounts = _refundAmounts;
    }

    // Coordinator Setup

    function _registerStages() internal override {
        _registerStage(_returnTokensToVault);
    }

    function _afterLastStage() internal virtual override {
        // Clean up any permissions which were granted to the coordinator which it no longer needs.
        ICurrentAuthorizer authorizer = ICurrentAuthorizer(address(getAuthorizer()));
        bytes32 withdrawCollectedFeesRole = IAuthentication(address(protocolFeesWithdrawer)).getActionId(
            IProtocolFeesWithdrawer.withdrawCollectedFees.selector
        );
        bytes32 allowlistTokenRole = IAuthentication(address(protocolFeesWithdrawer)).getActionId(
            IProtocolFeesWithdrawer.allowlistToken.selector
        );

        authorizer.renounceRole(withdrawCollectedFeesRole, address(this));
        authorizer.renounceRole(allowlistTokenRole, address(this));
    }

    // Internal functions

    function _returnTokensToVault() private {
        // Before we can withdraw these tokens back to the Vault they need to be allowlisted again.
        for (uint256 i = 0; i < tokens.length; i++) {
            protocolFeesWithdrawer.allowlistToken(tokens[i]);
        }

        // Once allowlisted, we send the specified amounts back to the vault directly.
        protocolFeesWithdrawer.withdrawCollectedFees(tokens, refundAmounts, address(getAuthorizerAdaptor().getVault()));
    }
}
