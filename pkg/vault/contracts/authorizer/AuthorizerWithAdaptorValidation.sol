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
 * @dev Stopgap contract to allow use of AuthorizerAdaptorEntrypoint validation before
 * migration to the `TimelockAuthorizer`.
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
     * (which we know has safely checked permissions), or can be validated with the current Authorizer.
     */
    function canPerform(
        bytes32 actionId,
        address account,
        address where
    ) external view override returns (bool) {
        if (msg.sender == address(_authorizerAdaptor)) {
            return account == address(_adaptorEntrypoint);
        } else {
            return _actualAuthorizer.canPerform(actionId, account, where);
        }
    }
}
