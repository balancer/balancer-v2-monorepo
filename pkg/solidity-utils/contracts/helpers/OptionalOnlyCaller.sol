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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/IOptionalOnlyCaller.sol";

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";

/**
 * @dev Helper to add an opt-in validation to methods that are otherwise callable by any address.
 *
 * Derive this contract when an external method that affects a given address
 * (such as a token claim) needs to be restricted by a particular circumstance.
 *
 * When enabled, the verification will only allow the affected address to call the restricted method(s).
 */
abstract contract OptionalOnlyCaller is IOptionalOnlyCaller {
    mapping(address => bool) private _isOnlyCallerEnabled;

    /**
     * @dev Reverts if the verification mechanism is enabled and the given address is not the caller.
     * @param user - Address to validate as the only allowed caller, if the verification is enabled.
     */
    modifier optionalOnlyCaller(address user) {
        _verifyCaller(user);
        _;
    }

    function enableOnlyCaller(bool enabled) external override {
        _isOnlyCallerEnabled[msg.sender] = enabled;
        emit OnlyCallerOptIn(msg.sender, enabled);
    }

    function _verifyCaller(address user) private view {
        if (_isOnlyCallerEnabled[user]) {
            _require(msg.sender == user, Errors.SENDER_NOT_ALLOWED);
        }
    }
}
