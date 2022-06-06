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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IBalancerTokenAdmin.sol";

import "../BaseCoordinator.sol";

contract TribeBALMinterCoordinator is BaseCoordinator {
    address public constant TRIBE_BAL_RECIPIENT = 0xc5bb8F0253776beC6FF450c2B40f092f7e7f5b57;
    uint256 public constant TRIBE_BAL_MINT_AMOUNT = 34_344e18; // TODO: get more accurate value.

    IBalancerTokenAdmin private immutable _balancerTokenAdmin;

    constructor(IAuthorizerAdaptor authorizerAdaptor, IBalancerTokenAdmin balancerTokenAdmin)
        BaseCoordinator(authorizerAdaptor)
    {
        _balancerTokenAdmin = balancerTokenAdmin;
    }

    // Coordinator Setup

    function _registerStages() internal override {
        _registerStage(_mintBALForTribe);
    }

    function _afterLastStage() internal virtual override {
        ICurrentAuthorizer authorizer = ICurrentAuthorizer(address(getAuthorizer()));
        bytes32 mintBALRole = _balancerTokenAdmin.getActionId(IBalancerTokenAdmin.mint.selector);
        
        authorizer.renounceRole(mintBALRole);
    }

    // Internal functions

    function _mintBALForTribe() private {
        _balancerTokenAdmin.mint(TRIBE_BAL_RECIPIENT, TRIBE_BAL_MINT_AMOUNT);
    }
}
