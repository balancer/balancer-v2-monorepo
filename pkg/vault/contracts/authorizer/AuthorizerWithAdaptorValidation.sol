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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IAuthorizerAdaptorEntrypoint.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IAuthorizerAdaptor.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IAuthorizer.sol";

/**
 * @dev Temporary Authorizer upgrade that fixes the issue in the AuthorizerAdaptor and allows usage of
 * the AuthorizerAdaptorEntrypoint. The previous Authorizer is the one that actually keeps track of permissions.
 *
 * This is expected to be replaced by the TimelockAuthorizer, which also includes this fix.
 */
contract AuthorizerWithAdaptorValidation is IAuthorizer {
    IAuthorizerAdaptorEntrypoint private immutable _adaptorEntrypoint;
    IAuthorizerAdaptor private immutable _authorizerAdaptor;
    IAuthorizer private immutable _actualAuthorizer;

    constructor(
        IAuthorizer actualAuthorizer,
        IAuthorizerAdaptor authorizerAdaptor,
        IAuthorizerAdaptorEntrypoint adaptorEntrypoint
    ) {
        _actualAuthorizer = actualAuthorizer;
        _authorizerAdaptor = authorizerAdaptor;
        _adaptorEntrypoint = adaptorEntrypoint;
    }

    /**
     * @dev Return the address of the original Authorizer.
     */
    function getActualAuthorizer() external view returns (IAuthorizer) {
        return _actualAuthorizer;
    }

    /**
     * @dev Return the address of the Authorizer Adaptor.
     */
    function getAuthorizerAdaptor() external view returns (IAuthorizerAdaptor) {
        return _authorizerAdaptor;
    }

    /**
     * @dev Return the address of the Authorizer Adaptor Entrypoint.
     */
    function getAuthorizerAdaptorEntrypoint() external view returns (IAuthorizerAdaptorEntrypoint) {
        return _adaptorEntrypoint;
    }

    /**
     * @dev Ensure that all requests either came through the AuthorizerAdaptor via the AuthorizerAdaptorEntrypoint
     * (which we know has safely checked permissions), or can be validated with the actual Authorizer.
     */
    function canPerform(
        bytes32 actionId,
        address account,
        address where
    ) external view override returns (bool) {
        if (msg.sender == address(_authorizerAdaptor)) {
            // The situation where the caller is the `AuthorizerAdaptor` is a special case, as due to a bug it can be
            // tricked into passing an incorrect `actionId` value, potentially resulting in escalation of privileges.
            //
            // To remedy this we force all calls to the `AuthorizerAdaptor` to be made through a singleton entrypoint
            // contract, called the `AuthorizerAdaptorEntrypoint`. This contract correctly checks whether `account` can
            // perform `actionId` on `where`, and then forwards the call onto the `AuthorizerAdaptor` to execute.
            //
            // The authorizer then rejects calls to the `AuthorizerAdaptor` which aren't made through the entrypoint,
            // and approves all calls made through it (since the entrypoint will have already performed any necessary
            // permission checks).
            return account == address(_adaptorEntrypoint);
        } else {
            // A permission check performed by any other account is simply forwarded to the actual Authorizer, which
            // is the one that keeps track of permissions.
            return _actualAuthorizer.canPerform(actionId, account, where);
        }
    }
}
