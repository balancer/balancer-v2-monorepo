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

import "../lib/helpers/Authentication.sol";
import "../vault/interfaces/IAuthorizer.sol";

/**
 * @dev Base authorization layer implementation for Pools.
 *
 * Pools can be assigned an owner account, which is the only one that can call the permissioned functions. Note that
 * this owner is immutable: more sophisticated permission schemes such as multiple ownership, granular roles, etc.,
 * should be built on top of this by making the owner a smart contract.
 *
 * Alternatively, if the owner is set to the zero address, the Pool switches to role-based access control using an
 * Authorizer.
 */
abstract contract BasePoolAuthorization is Authentication {
    address private immutable _factory;
    address private immutable _owner;

    constructor(address owner) {
        _factory = msg.sender;
        _owner = owner;
    }

    function getOwner() public view returns (address) {
        return _owner;
    }

    function getAuthorizer() external view returns (IAuthorizer) {
        return _getAuthorizer();
    }

    function _canPerform(bytes32 roleId, address account) internal view override returns (bool) {
        if (getOwner() != address(0)) {
            // A non-zero owner overrides the Authorizer flow - the owner is instead authorized for all actions.
            return msg.sender == getOwner();
        } else {
            // Alternatively, we query the Authorizer for permission.
            return _getAuthorizer().hasRoleIn(roleId, account, address(this));
        }
    }

    function _getRole(bytes4 selector) internal view override returns (bytes32) {
        // Base Pools are expected to be deployed using factories. By embedding the factory address in the role
        // generation process, we make all Pools deployed by the same factory share role identifiers, which allows for
        // sophisticated role management schemes (such as being able to grant the 'set fee' role in any Pool created
        // from the same factory), while making roles unique among different factories.
        return keccak256(abi.encodePacked(_factory, selector));
    }

    function _getAuthorizer() internal view virtual returns (IAuthorizer);
}
