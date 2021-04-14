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

import "./BalancerErrors.sol";
import "./IAuthentication.sol";

abstract contract Authentication is IAuthentication {
    /**
     * @dev Reverts unless the caller is allowed to call this function. Should only be applied to external functions.
     */
    modifier authenticate() {
        _authenticateCaller();
        _;
    }

    /**
     * @dev Reverts unless the caller is allowed to call the entry point function.
     */
    function _authenticateCaller() internal view {
        // Each external function is dynamically assigned a role ID as the hash of the contract address
        // and the function selector.
        bytes32 roleId = _getRole(msg.sig);
        _require(_canPerform(roleId, msg.sender), Errors.SENDER_NOT_ALLOWED);
    }

    // Ideally we wouldn't need this and would simply have children override the `getRole` function directly as a public
    // function (so we can call it in `_authenticallyCaller`), but because in this context all we have is the external
    // version from the interface, we manually perform the handoff from the external to the internal one.
    function getRole(bytes4 selector) external view override returns (bytes32) {
        return _getRole(selector);
    }

    /**
     * @dev Returns the role required to call the function described by `selector`.
     */
    function _getRole(bytes4 selector) internal view virtual returns (bytes32);

    function _canPerform(bytes32 roleId, address user) internal view virtual returns (bool);
}
