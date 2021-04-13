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
 * @dev Base authorization layer implementation for pools. It shares the same concept as the one defined for the Vault.
 * It's built on top of OpenZeppelin's Access Control, which allows defining specific roles to control what access
 * external accounts have to specific contract functions.
 */
abstract contract BasePoolAuthorization is Authentication {
    address private immutable _owner;

    constructor(address owner) {
        _owner = owner;
    }

    function getOwner() external view returns (address) {
        return _owner;
    }

    function getAuthorizer() external view returns (IAuthorizer) {
        return _getAuthorizer();
    }

    function _canPerform(bytes32 roleId, address account) internal view override returns (bool) {
        // A non-zero owner overrides the default Authorizer flow - this address is instead authorized for all actions.
        if (_owner != address(0)) {
            return msg.sender == _owner;
        } else {
            return _getAuthorizer().hasRole(roleId, account);
        }
    }

    function _getAuthorizer() internal view virtual returns (IAuthorizer);
}
