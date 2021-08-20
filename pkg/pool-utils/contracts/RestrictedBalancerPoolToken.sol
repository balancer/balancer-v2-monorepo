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

import "./BalancerPoolToken.sol";
import "./BasePoolAuthorization.sol";

/**
 * @title Extension of BalancerPoolToken with holder allowlist
 * @author Balancer Labs
 * @dev
 * - Restricts both senders and recipients of all transfers (including mints
 *   and burns) to addresses on an allowlist
 * - Includes permissioned functions for adding/removing members to/from the
 *   allowlist
 */
abstract contract RestrictedBalancerPoolToken is BalancerPoolToken, BasePoolAuthorization {
    mapping(address => bool) private _allowedAddresses;

    event AddressAdded(address member);
    event AddressRemoved(address member);

    constructor() {
        // Add zero address to allowlist to avoid blocking mints and burns
        _allowedAddresses[address(0)] = true;
    }

    // Overrides

    /**
     * @dev Override to enforce address allowlist.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256
    ) internal virtual override {
        _require(isAllowedAddress(from), Errors.ERC20_TRANSFER_FROM_PROHIBITED_ADDRESS);
        _require(isAllowedAddress(to), Errors.ERC20_TRANSFER_TO_PROHIBITED_ADDRESS);
    }

    /**
     * @dev Override to enforce address allowlist
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view virtual override returns (bool) {
        return
            (actionId == getActionId(this.addAllowedAddress.selector)) ||
            (actionId == getActionId(this.removeAllowedAddress.selector));
    }

    // Public functions

    /**
     * @dev Verifies that a given address is allowed to hold tokens.
     */
    function isAllowedAddress(address member) public view returns (bool) {
        return _allowedAddresses[member];
    }

    /**
     * @dev Adds an address to the allowlist.
     */
    function addAllowedAddress(address member) public authenticate {
        _require(!isAllowedAddress(member), Errors.ADDRESS_ALREADY_ALLOWLISTED);
        _allowedAddresses[member] = true;
        emit AddressAdded(member);
    }

    /**
     * @dev Removes an address from the allowlist.
     */
    function removeAllowedAddress(address member) public authenticate {
        _require(isAllowedAddress(member), Errors.ADDRESS_NOT_ALLOWLISTED);
        delete _allowedAddresses[member];
        emit AddressRemoved(member);
    }
}
