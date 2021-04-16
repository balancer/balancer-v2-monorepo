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
    bytes32 private immutable _roleDisambiguator;

    /**
     * @dev The main purpose of the `roleDisambiguator` is to prevent accidental function selector collisions.
     *
     * There are two main uses for it:
     *  - if the contract is a singleton, any unique identifier can be used to make the associated roles unique. The
     * contract's own address is a good option.
     *  - if the contract belongs to a family that share roles for the same functions, an identifier shared by the
     * entire family (and no other contract) should be used instead.
     */
    constructor(bytes32 roleDisambiguator) {
        _roleDisambiguator = roleDisambiguator;
    }

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
        bytes32 roleId = getRole(msg.sig);
        _require(_canPerform(roleId, msg.sender), Errors.SENDER_NOT_ALLOWED);
    }

    function getRole(bytes4 selector) public view override returns (bytes32) {
        // Each external is dynamically assigned a role ID as the hash of the disambiguator and the function selector.
        // Disambiguation is necessary to avoid potential collisions in the function selectors of multiple contracts.
        return keccak256(abi.encodePacked(_roleDisambiguator, selector));
    }

    function _canPerform(bytes32 roleId, address user) internal view virtual returns (bool);
}
