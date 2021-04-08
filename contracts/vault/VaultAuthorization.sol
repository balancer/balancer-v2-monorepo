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
pragma experimental ABIEncoderV2;

import "../lib/openzeppelin/ReentrancyGuard.sol";
import "../lib/helpers/BalancerErrors.sol";
import "../lib/helpers/Authentication.sol";
import "../lib/helpers/EmergencyPeriod.sol";
import "../lib/helpers/BalancerErrors.sol";
import "../lib/helpers/SignaturesValidator.sol";

import "./interfaces/IVault.sol";
import "./interfaces/IAuthorizer.sol";

abstract contract VaultAuthorization is IVault, ReentrancyGuard, Authentication, SignaturesValidator, EmergencyPeriod {
    /* solhint-disable max-line-length */
    /* solhint-disable prettier/prettier */
    /* solhint-disable var-name-mixedcase */
    /* solhint-disable private-vars-leading-underscore */
    bytes32 internal immutable JOIN_TYPE_HASH = keccak256("JoinAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 internal immutable EXIT_TYPE_HASH = keccak256("ExitAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 internal immutable SWAP_TYPE_HASH = keccak256("SwapAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 internal immutable BATCH_SWAP_TYPE_HASH = keccak256("BatchSwapAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 internal immutable CHANGE_RELAYER_TYPE_HASH = keccak256("ChangeRelayerAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    /* solhint-enable max-line-length */
    /* solhint-enable prettier/prettier */
    /* solhint-enable var-name-mixedcase */
    /* solhint-enable private-vars-leading-underscore */

    IAuthorizer private _authorizer;
    mapping(address => mapping(address => bool)) private _allowedRelayers;

    /**
     * @dev Reverts unless `user` has allowed the caller as a relayer, and the caller is allowed by the Authorizer to
     * call this function. Should only be applied to external functions.
     */
    modifier authenticateFor(address user) {
        _authenticateFor(user);
        _;
    }

    constructor(IAuthorizer authorizer) {
        _authorizer = authorizer;
    }

    function changeAuthorizer(IAuthorizer newAuthorizer) external override nonReentrant authenticate {
        _authorizer = newAuthorizer;
    }

    function getAuthorizer() external view override returns (IAuthorizer) {
        return _authorizer;
    }

    /**
     * @dev Change a relayer allowance for `msg.sender`
     */
    function changeRelayerAllowance(
        address sender,
        address relayer,
        bool allowed
    ) external override nonReentrant noEmergencyPeriod authenticateFor(sender) {
        _allowedRelayers[sender][relayer] = allowed;
    }

    function hasAllowedRelayer(address user, address relayer) external view override returns (bool) {
        return _hasAllowedRelayer(user, relayer);
    }

    /**
     * @dev Reverts unless  `user` has allowed the caller as a relayer, and the caller is allowed by the Authorizer to
     * call the entry point function.
     */
    function _authenticateFor(address user) internal {
        if (msg.sender != user) {
            _authenticateCaller();
            // Validate signature only if the user didn't grant allowance to the relayer
            if (!_hasAllowedRelayer(user, msg.sender)) {
                _validateSignature(user, Errors.USER_DOESNT_ALLOW_RELAYER);
            }
        }
    }

    /**
     * @dev Reverts unless `user` has allowed the caller as a relayer.
     */
    function _authenticateCallerFor(address user) internal view {
        _require(_hasAllowedRelayer(user, msg.sender), Errors.USER_DOESNT_ALLOW_RELAYER);
    }

    function _hasAllowedRelayer(address user, address relayer) internal view returns (bool) {
        return _allowedRelayers[user][relayer];
    }

    function _canPerform(bytes32 roleId, address user) internal view override returns (bool) {
        return _authorizer.hasRole(roleId, user);
    }

    function _typeHash() internal view override returns (bytes32) {
        if (msg.sig == IVault.joinPool.selector) {
            return JOIN_TYPE_HASH;
        } else if (msg.sig == IVault.exitPool.selector) {
            return EXIT_TYPE_HASH;
        } else if (msg.sig == IVault.swap.selector) {
            return SWAP_TYPE_HASH;
        } else if (msg.sig == IVault.batchSwap.selector) {
            return BATCH_SWAP_TYPE_HASH;
        } else if (msg.sig == IVault.changeRelayerAllowance.selector) {
            return CHANGE_RELAYER_TYPE_HASH;
        } else {
            return bytes32(0);
        }
    }
}
