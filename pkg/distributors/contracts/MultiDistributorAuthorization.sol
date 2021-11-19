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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/SignaturesValidator.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IAuthorizer.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

/**
 * @dev Base authorization layer implementation for MultiDistributor
 */
abstract contract MultiDistributorAuthorization is Authentication, SignaturesValidator {
    IVault private immutable _vault;

    // Ideally, we'd store the type hashes as immutable state variables to avoid computing the hash at runtime, but
    // unfortunately immutable variables cannot be used in assembly, so we just keep the precomputed hashes instead.

    // _STAKE_TYPE_HASH = keccak256("Stake(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 private constant _STAKE_TYPE_HASH = 0x094838c3262b45f25bc2532b3a229518c8fb0ca1c5f85d55bc9a5045f815ea0b;

    // _UNSTAKE_TYPE_HASH = keccak256("Unstake(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 private constant _UNSTAKE_TYPE_HASH = 0x9c58cf0238db9c72fa323127fbe1fd76b6e5462b9f265eb78c18fd79ef0612f1;

    // _CLAIM_TYPE_HASH = keccak256("Claim(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 private constant _CLAIM_TYPE_HASH = 0x3cd59f50c349e4bec96303c8ddca75ecf1c722778043d7219dc2301b51815589;

    // solhint-disable-next-line max-line-length
    // _CLAIM_CB_TYPE_HASH = keccak256("ClaimWithCallback(bytes calldata,address sender,uint256 nonce,uint256 deadline)");
    bytes32 private constant _CLAIM_CB_TYPE_HASH = 0x483200a4656d9f0771f5ff65142231f14a65c2fd1d4cbad1c5bfce20e004f47d;

    /**
     * @dev Reverts unless `user` is the caller, or the caller is approved by the Authorizer to call this function (that
     * is, it is a relayer for that function), and either:
     *  a) `user` approved the caller as a relayer on the Balancer Vault, or
     *  b) a valid signature from them was appended to the calldata.
     *
     * Should only be applied to external functions.
     */
    modifier authenticateFor(address user) {
        _authenticateFor(user);
        _;
    }

    constructor(IVault vault) Authentication(bytes32(uint256(address(this)))) SignaturesValidator("Balancer V2 Vault") {
        // MultiDistributor is a singleton, so it simply uses its own address to disambiguate action identifiers
        _vault = vault;
    }

    function getVault() public view returns (IVault) {
        return _vault;
    }

    function getAuthorizer() external view returns (IAuthorizer) {
        return _getAuthorizer();
    }

    function _getAuthorizer() internal view returns (IAuthorizer) {
        return getVault().getAuthorizer();
    }

    function _canPerform(bytes32 actionId, address account) internal view override returns (bool) {
        return _getAuthorizer().canPerform(actionId, account, address(this));
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
            if (!getVault().hasApprovedRelayer(user, msg.sender)) {
                _validateSignature(user, Errors.USER_DOESNT_ALLOW_RELAYER);
            }
        }
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
                case 0x4a0e780e {
                    hash := _STAKE_TYPE_HASH
                }
                case 0x5aa347c7 {
                    hash := _UNSTAKE_TYPE_HASH
                }
                case 0x3bafec6f {
                    hash := _CLAIM_TYPE_HASH
                }
                case 0x719a3ef1 {
                    hash := _CLAIM_CB_TYPE_HASH
                }
                default {
                    hash := 0x0000000000000000000000000000000000000000000000000000000000000000
                }
        }
    }
}
