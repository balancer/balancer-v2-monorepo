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

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

import "../lib/helpers/ReentrancyGuard.sol";

import "./interfaces/IVault.sol";
import "./interfaces/IAuthorizer.sol";

abstract contract Authorization is IVault, ReentrancyGuard {
    IAuthorizer private _authorizer;
    mapping(address => mapping(address => bool)) private _allowedRelayers;

    /**
     * @dev Check that the sender has the required permission
     */
    modifier authenticate() {
        _authenticateSender();
        _;
    }

    /**
     * @dev Check that the sender is the user to act on behalf of or someone with the required permission
     */
    modifier authenticateFor(address user) {
        _authenticateSenderFor(user);
        _;
    }

    constructor(IAuthorizer authorizer) {
        _authorizer = authorizer;
    }

    function changeAuthorizer(IAuthorizer newAuthorizer) external override nonReentrant authenticate {
        _authorizer = newAuthorizer;
    }

    /**
     * @dev Changes the allowance for a relayer
     */
    function changeRelayerAllowance(address relayer, bool allowed) external override nonReentrant {
        _allowedRelayers[msg.sender][relayer] = allowed;
    }

    function getAuthorizer() external view override returns (IAuthorizer) {
        return _authorizer;
    }

    /**
     * @dev Tells whether a user has allowed a specific relayer
     */
    function hasAllowedRelayer(address user, address relayer) external view override returns (bool) {
        return _hasAllowedRelayer(user, relayer);
    }

    /**
     * @dev Ensure that the sender is the user to act on behalf of or someone with the required permission
     */
    function _authenticateSenderFor(address user) internal view {
        if (msg.sender != user) {
            _authenticateSender();
            require(_hasAllowedRelayer(user, msg.sender), "USER_DOESNT_ALLOW_RELAYER");
        }
    }

    /**
     * @dev Ensure that the sender is the user to act on behalf of or someone with the required permission
     */
    function _authenticateSender() internal view {
        bytes32 roleId = keccak256(abi.encodePacked(address(this), msg.sig));
        require(_authorizer.hasRole(roleId, msg.sender), "SENDER_NOT_ALLOWED");
    }

    /**
     * @dev Tell whether a user has allowed a relayer or not
     */
    function _hasAllowedRelayer(address user, address relayer) internal view returns (bool) {
        return _allowedRelayers[user][relayer];
    }
}
