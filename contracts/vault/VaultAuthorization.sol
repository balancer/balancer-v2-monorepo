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

import "../lib/helpers/BalancerErrors.sol";
import "../lib/helpers/Authentication.sol";
import "../lib/helpers/TemporarilyPausable.sol";
import "../lib/helpers/BalancerErrors.sol";
import "../lib/helpers/SignaturesValidator.sol";
import "../lib/openzeppelin/ReentrancyGuard.sol";

import "./interfaces/IVault.sol";
import "./interfaces/IAuthorizer.sol";

/**
 * @dev Manages access control of Vault permissioned functions by relying on the Authorizer and signature validation.
 *
 * Additionally handles relayer access and approval.
 */
abstract contract VaultAuthorization is
    IVault,
    ReentrancyGuard,
    Authentication,
    SignaturesValidator,
    TemporarilyPausable
{
    // Ideally, we'd store the typehashes as immutable state variables to avoid computing the hash at runtime, but
    // unfortunately immutable variables cannot be used in assembly, so we just keep the precomputed hashes instead.

    // _JOIN_TYPE_HASH = keccak256("JoinAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 private constant _JOIN_TYPE_HASH = 0x8378a8c1df05a9f1a8c03f56ac5deaa79a89d08a18ee66900300eeccbbffab60;

    // _EXIT_TYPE_HASH = keccak256("ExitAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 private constant _EXIT_TYPE_HASH = 0x0725e3eb280becc5e8a12353eebf7eea0f300734e37d6ea26a0618f0e33b7c2c;

    // _SWAP_TYPE_HASH = keccak256("SwapAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 private constant _SWAP_TYPE_HASH = 0xccccf29320e8013475285e723e882da98bb8fe6d57df3ef56f4450c8a0b87279;

    // _BATCH_SWAP_TYPE_HASH = keccak256("BatchSwapAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 private constant _BATCH_SWAP_TYPE_HASH = 0x19798cf6a20b933b5582bab474b88a347f49600d7885bea767cebdf93e67e25b;

    // _CHANGE_RELAYER_TYPE_HASH =
    //     keccak256("ChangeRelayerAuth(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32
        private constant _CHANGE_RELAYER_TYPE_HASH = 0xa287a6d125737644e801d3f7878ec24503dc3f766efac5bdc0fe4932726c75f9;

    IAuthorizer private _authorizer;
    mapping(address => mapping(address => bool)) private _approvedRelayers;

    /**
     * @dev Reverts unless `user` is the caller, or the caller is approved by the Authorizer to call this function (that
     * is, it is a relayer for that function), and either:
     *  a) `user` approved the caller as a relayer (via `setRelayerApproval`), or
     *  b) a valid signature from them was appended to the calldata.
     *
     * Should only be applied to external functions.
     */
    modifier authenticateFor(address user) {
        _authenticateFor(user);
        _;
    }

    constructor(IAuthorizer authorizer)
        // The Vault is a singleton, so it simply uses its own address to disambiguate action identifiers.
        Authentication(bytes32(uint256(address(this))))
    {
        _authorizer = authorizer;
    }

    function changeAuthorizer(IAuthorizer newAuthorizer) external override nonReentrant authenticate {
        emit AuthorizerChanged(_authorizer, newAuthorizer);
        _authorizer = newAuthorizer;
    }

    function getAuthorizer() external view override returns (IAuthorizer) {
        return _authorizer;
    }

    function setRelayerApproval(
        address sender,
        address relayer,
        bool approved
    ) external override nonReentrant whenNotPaused authenticateFor(sender) {
        _approvedRelayers[sender][relayer] = approved;
        emit RelayerApprovalChanged(relayer, sender, approved);
    }

    function hasApprovedRelayer(address user, address relayer) external view override returns (bool) {
        return _hasApprovedRelayer(user, relayer);
    }

    /**
     * @dev Reverts unless `user` is the caller, or the caller is approved by the Authorizer to call the entry point
     * function (that is, it is a relayer for that function) and either:
     *  a) `user` approved the caller as a relayer (via `setRelayerApproval`), or
     *  b) a valid signature from them was appended to the calldata.
     */
    function _authenticateFor(address user) internal {
        if (msg.sender != user) {
            // In this context, 'permission to call a function' means 'being a relayer for a function'.
            _authenticateCaller();

            // Being a relayer is not sufficient: `user` must have also approved the caller either via
            // `setRelayerApproval`, or by providing a signature appended to the calldata.
            if (!_hasApprovedRelayer(user, msg.sender)) {
                _validateSignature(user, Errors.USER_DOESNT_ALLOW_RELAYER);
            }
        }
    }

    /**
     * @dev Returns true if `user` approved `relayer` to act as a relayer for them.
     */
    function _hasApprovedRelayer(address user, address relayer) internal view returns (bool) {
        return _approvedRelayers[user][relayer];
    }

    function _canPerform(bytes32 action, address user) internal view override returns (bool) {
        // Access control is delegated to the Authorizer.
        return _authorizer.canPerform(action, user, address(this));
    }

    function _typeHash() internal pure override returns (bytes32 hash) {
        // This is a simple switch-case statement, trivially written in Solidity by chaining else-if statements, but the
        // assembly implementation results in much denser bytecode.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // The function selector is located at the first 4 bytes of calldata. We copy the first full calldata
            // 256 word, and then perform a logical shift to the right, moving the selector to the least significant
            // 4 bytes.
            let selector := shr(224, calldataload(0))

            // With the selector in the least significant 4 bytes, we can use 4 byte literals with leading zeros,
            // resulting in dense bytecode (PUSH4 opcodes).
            switch selector
                case 0xb95cac28 {
                    hash := _JOIN_TYPE_HASH
                }
                case 0x8bdb3913 {
                    hash := _EXIT_TYPE_HASH
                }
                case 0x52bbbe29 {
                    hash := _SWAP_TYPE_HASH
                }
                case 0x945bcec9 {
                    hash := _BATCH_SWAP_TYPE_HASH
                }
                case 0x2fd87446 {
                    hash := _CHANGE_RELAYER_TYPE_HASH
                }
                default {
                    hash := 0x0000000000000000000000000000000000000000000000000000000000000000
                }
        }
    }
}
