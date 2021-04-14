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
    // bytes32 internal constant JOIN_TYPE_HASH = keccak256("JoinAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 internal constant JOIN_TYPE_HASH = 0x8378a8c1df05a9f1a8c03f56ac5deaa79a89d08a18ee66900300eeccbbffab60;
    // bytes32 internal constant EXIT_TYPE_HASH = keccak256("ExitAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 internal constant EXIT_TYPE_HASH = 0x0725e3eb280becc5e8a12353eebf7eea0f300734e37d6ea26a0618f0e33b7c2c;
    // bytes32 internal constant SWAP_TYPE_HASH = keccak256("SwapAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 internal constant SWAP_TYPE_HASH = 0xccccf29320e8013475285e723e882da98bb8fe6d57df3ef56f4450c8a0b87279;
    // bytes32 internal constant BATCH_SWAP_TYPE_HASH = keccak256("BatchSwapAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 internal constant BATCH_SWAP_TYPE_HASH = 0x19798cf6a20b933b5582bab474b88a347f49600d7885bea767cebdf93e67e25b;
    // bytes32 internal constant CHANGE_RELAYER_TYPE_HASH = keccak256("ChangeRelayerAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32
        internal constant CHANGE_RELAYER_TYPE_HASH = 0xa287a6d125737644e801d3f7878ec24503dc3f766efac5bdc0fe4932726c75f9;
    /* solhint-enable max-line-length */
    /* solhint-enable prettier/prettier */
    /* solhint-enable var-name-mixedcase */
    /* solhint-enable private-vars-leading-underscore */

    IAuthorizer private _authorizer;
    mapping(address => mapping(address => bool)) private _allowedRelayers;

    event AuthorizerChanged(IAuthorizer indexed oldAuthorizer, IAuthorizer indexed newAuthorizer);
    event RelayerAllowanceChanged(address indexed relayer, address indexed sender, bool allowed);

    /**
     * @dev Reverts unless `user` has allowed the caller as a relayer, and the caller is allowed by the Authorizer to
     * call this function. Should only be applied to external functions.
     */
    modifier authenticateFor(address user) {
        _authenticateFor(user);
        _;
    }

    constructor(IAuthorizer authorizer) Authentication(bytes32(uint256(address(this)))) {
        _authorizer = authorizer;
    }

    function changeAuthorizer(IAuthorizer newAuthorizer) external override nonReentrant authenticate {
        emit AuthorizerChanged(_authorizer, newAuthorizer);
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
        emit RelayerAllowanceChanged(relayer, sender, allowed);
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
        // Role management is delegated to the Authorizer.
        return _authorizer.hasRoleIn(roleId, user, address(this));
    }

    function _typeHash() internal pure override returns (bytes32 hash) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // Copy first 32 bytes from calldata to extract selector
            // Shift right (logical) 224 bits the extracted selector to move it to the least significant 4 bytes
            let selector := shr(224, calldataload(0))

            // Switch case the selector to return the corresponding type hash
            switch selector
                case 0xb95cac28 {
                    hash := JOIN_TYPE_HASH
                }
                case 0x8bdb3913 {
                    hash := EXIT_TYPE_HASH
                }
                case 0x52bbbe29 {
                    hash := SWAP_TYPE_HASH
                }
                case 0x945bcec9 {
                    hash := BATCH_SWAP_TYPE_HASH
                }
                case 0x2fd87446 {
                    hash := CHANGE_RELAYER_TYPE_HASH
                }
                default {
                    hash := 0x0000000000000000000000000000000000000000000000000000000000000000
                }
        }
    }
}
