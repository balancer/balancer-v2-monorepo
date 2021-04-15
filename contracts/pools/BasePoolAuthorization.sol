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

import "./BasePool.sol";

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
    address private immutable _owner;

    constructor(address owner) {
        _owner = owner;
    }

    function getOwner() public view returns (address) {
        return _owner;
    }

    function getAuthorizer() external view returns (IAuthorizer) {
        return _getAuthorizer();
    }

    function _canPerform(bytes32 roleId, address account) internal view override returns (bool) {
        if ((getOwner() != address(0)) && _isOwnerOverrideableRole(roleId)) {
            // A non-zero owner overrides the Authorizer flow for roles that can be overridden
            return msg.sender == getOwner();
        } else {
            // Non-overrideable roles are always processed via the Authorizer, as are the overrideable ones if no owner
            // is set.
            return _getAuthorizer().hasRoleIn(roleId, account, address(this));
        }
    }

    function _isOwnerOverrideableRole(bytes32 roleId) private view returns (bool) {
        return roleId == getRole(BasePool.setSwapFee.selector);
    }

    function _getAuthorizer() internal view virtual returns (IAuthorizer);
}
