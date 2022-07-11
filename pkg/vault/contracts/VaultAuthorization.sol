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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IAuthorizer.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ExtraCalldataEOASignaturesValidator.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/TemporarilyPausable.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

/**
 * @dev Manages access control of Vault permissioned functions by relying on the Authorizer and signature validation.
 *
 * Additionally handles relayer access and approval.
 */
abstract contract VaultAuthorization is
    IVault,
    ReentrancyGuard,
    Authentication,
    ExtraCalldataEOASignaturesValidator,
    TemporarilyPausable
{
    // Ideally, we'd store the type hashes as immutable state variables to avoid computing the hash at runtime, but
    // unfortunately immutable variables cannot be used in assembly, so we just keep the precomputed hashes instead.

    // _JOIN_TYPE_HASH = keccak256("JoinPool(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 private constant _JOIN_TYPE_HASH = 0x3f7b71252bd19113ff48c19c6e004a9bcfcca320a0d74d58e85877cbd7dcae58;

    // _EXIT_TYPE_HASH = keccak256("ExitPool(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 private constant _EXIT_TYPE_HASH = 0x8bbc57f66ea936902f50a71ce12b92c43f3c5340bb40c27c4e90ab84eeae3353;

    // _SWAP_TYPE_HASH = keccak256("Swap(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 private constant _SWAP_TYPE_HASH = 0xe192dcbc143b1e244ad73b813fd3c097b832ad260a157340b4e5e5beda067abe;

    // _BATCH_SWAP_TYPE_HASH = keccak256("BatchSwap(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 private constant _BATCH_SWAP_TYPE_HASH = 0x9bfc43a4d98313c6766986ffd7c916c7481566d9f224c6819af0a53388aced3a;

    // _SET_RELAYER_TYPE_HASH =
    //     keccak256("SetRelayerApproval(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32
        private constant _SET_RELAYER_TYPE_HASH = 0xa3f865aa351e51cfeb40f5178d1564bb629fe9030b83caf6361d1baaf5b90b5a;

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
        EIP712("Balancer V2 Vault", "1")
    {
        _setAuthorizer(authorizer);
    }

    function setAuthorizer(IAuthorizer newAuthorizer) external override nonReentrant authenticate {
        _setAuthorizer(newAuthorizer);
    }

    function _setAuthorizer(IAuthorizer newAuthorizer) private {
        emit AuthorizerChanged(newAuthorizer);
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
                _validateExtraCalldataSignature(user, Errors.USER_DOESNT_ALLOW_RELAYER);
            }
        }
    }

    /**
     * @dev Returns true if `user` approved `relayer` to act as a relayer for them.
     */
    function _hasApprovedRelayer(address user, address relayer) internal view returns (bool) {
        return _approvedRelayers[user][relayer];
    }

    function _canPerform(bytes32 actionId, address user) internal view override returns (bool) {
        // Access control is delegated to the Authorizer.
        return _authorizer.canPerform(actionId, user, address(this));
    }

    function _entrypointTypeHash() internal pure override returns (bytes32 hash) {
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
                case 0xfa6e671d {
                    hash := _SET_RELAYER_TYPE_HASH
                }
                default {
                    hash := 0x0000000000000000000000000000000000000000000000000000000000000000
                }
        }
    }
}
