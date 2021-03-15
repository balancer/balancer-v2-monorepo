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
 * It's built on top of OpenZeppelin's Access Control, which allows to define specific roles to control the access of
 * external accounts to the different functionalities of the contract.
 */
abstract contract BasePoolAuthorization is Authentication {
    function getAuthorizer() external view returns (IAuthorizer) {
        return _getAuthorizer();
    }

    function _canPerform(bytes32 roleId, address account) internal view override returns (bool) {
        return _getAuthorizer().hasRole(roleId, account);
    }

    function _getAuthorizer() internal view virtual returns (IAuthorizer);
}
