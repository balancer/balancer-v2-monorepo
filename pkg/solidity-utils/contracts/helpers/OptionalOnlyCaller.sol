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

import "./SignaturesValidator.sol";

abstract contract OptionalOnlyCaller is IOptionalOnlyCaller, SignaturesValidator {
    mapping(address => bool) private _isOnlyCallerEnabled;

    bytes32 private constant _SET_ONLY_CALLER_CHECK_TYPEHASH = keccak256(
        "SetOnlyCallerCheck(bool enabled,address user,uint256 nonce)"
    );

    /**
     * @dev Reverts if the verification mechanism is enabled and the given address is not the caller.
     * @param user - Address to validate as the only allowed caller, if the verification is enabled.
     */
    modifier optionalOnlyCaller(address user) {
        _verifyCaller(user);
        _;
    }

    function setOnlyCallerCheck(bool enabled) external override {
        _setOnlyCallerCheck(enabled, msg.sender);
    }

    function setOnlyCallerCheckWithSignature(
        bool enabled,
        address user,
        bytes memory signature
    ) external override {
        bytes32 structHash = keccak256(abi.encode(_SET_ONLY_CALLER_CHECK_TYPEHASH, enabled, user, getNextNonce(user)));
        _ensureValidSignature(user, structHash, signature, Errors.INVALID_SIGNATURE);
        _setOnlyCallerCheck(enabled, user);
    }

    function _setOnlyCallerCheck(bool enabled, address user) private {
        _isOnlyCallerEnabled[user] = enabled;
        emit OnlyCallerOptIn(user, enabled);
    }

    function isOnlyCallerEnabled(address user) external view override returns (bool) {
        return _isOnlyCallerEnabled[user];
    }

    function _verifyCaller(address user) private view {
        if (_isOnlyCallerEnabled[user]) {
            _require(msg.sender == user, Errors.SENDER_NOT_ALLOWED);
        }
    }
}
