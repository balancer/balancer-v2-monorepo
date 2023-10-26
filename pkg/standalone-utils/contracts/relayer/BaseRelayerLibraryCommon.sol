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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IBalancerRelayer.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "./IBaseRelayerLibrary.sol";
import "./BalancerRelayer.sol";

/**
 * @title Base Relayer Library
 * @notice Core functionality of a relayer. Allow users to use a signature to approve this contract
 * to take further actions on their behalf.
 * @dev
 * Relayers are composed of two contracts:
 *  - A `BalancerRelayer` contract, which acts as a single point of entry into the system through a multicall function
 *  - A library contract such as this one, which defines the allowed behaviour of the relayer

 * NOTE: Only the entrypoint contract should be allowlisted by Balancer governance as a relayer, so that the Vault
 * will reject calls from outside the entrypoint context.
 *
 * This contract should neither be allowlisted as a relayer, nor called directly by the user.
 * No guarantees can be made about fund safety when calling this contract in an improper manner.
 *
 * All functions that are meant to be called from the entrypoint via `multicall` must be payable so that they
 * do not revert in a call involving ETH. This also applies to functions that do not alter the state and would be
 * usually labeled as `view`.
 */
abstract contract BaseRelayerLibraryCommon is IBaseRelayerLibrary {
    using Address for address;
    using SafeERC20 for IERC20;

    IVault private immutable _vault;

    constructor(IVault vault) IBaseRelayerLibrary(vault.WETH()) {
        _vault = vault;
    }

    function getVault() public view override returns (IVault) {
        return _vault;
    }

    /**
     * @notice Approves the Vault to use tokens held in the relayer
     * @dev This is needed to avoid having to send intermediate tokens back to the user
     */
    function approveVault(IERC20 token, uint256 amount) external payable override {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }
        // TODO: gas golf this a bit
        token.safeApprove(address(getVault()), amount);
    }

    /**
     * @notice Returns the amount referenced by chained reference `ref`.
     * @dev It does not alter the reference (even if it's marked as temporary).
     *
     * This function does not alter the state in any way. It is not marked as view because it has to be `payable`
     * in order to be used in a batch transaction.
     *
     * Use a static call to read the state off-chain.
     */
    function peekChainedReferenceValue(uint256 ref) external payable override returns (uint256 value) {
        (, value) = _peekChainedReferenceValue(ref);
    }

    function _pullToken(
        address sender,
        IERC20 token,
        uint256 amount
    ) internal override {
        if (amount == 0) return;
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = token;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        _pullTokens(sender, tokens, amounts);
    }

    function _pullTokens(
        address sender,
        IERC20[] memory tokens,
        uint256[] memory amounts
    ) internal override {
        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            ops[i] = IVault.UserBalanceOp({
                asset: IAsset(address(tokens[i])),
                amount: amounts[i],
                sender: sender,
                recipient: payable(address(this)),
                kind: IVault.UserBalanceOpKind.TRANSFER_EXTERNAL
            });
        }

        getVault().manageUserBalance(ops);
    }

    /**
     * @dev Returns true if `amount` is not actually an amount, but rather a chained reference.
     */
    function _isChainedReference(uint256 amount) internal pure override returns (bool) {
        // First 3 nibbles are enough to determine if it's a chained reference.
        return
            (amount & 0xfff0000000000000000000000000000000000000000000000000000000000000) ==
            0xba10000000000000000000000000000000000000000000000000000000000000;
    }

    /**
     * @dev Returns true if `ref` is temporary reference, i.e. to be deleted after reading it.
     */
    function _isTemporaryChainedReference(uint256 amount) internal pure returns (bool) {
        // First 3 nibbles determine if it's a chained reference.
        // If the 4th nibble is 0 it is temporary; otherwise it is considered read-only.
        // In practice, we shall use '0xba11' for read-only references.
        return
            (amount & 0xffff000000000000000000000000000000000000000000000000000000000000) ==
            0xba10000000000000000000000000000000000000000000000000000000000000;
    }

    /**
     * @dev Stores `value` as the amount referenced by chained reference `ref`.
     */
    function _setChainedReferenceValue(uint256 ref, uint256 value) internal override {
        bytes32 slot = _getStorageSlot(ref);

        // Since we do manual calculation of storage slots, it is easier (and cheaper) to rely on internal assembly to
        // access it.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(slot, value)
        }
    }

    /**
     * @dev Returns the amount referenced by chained reference `ref`.
     * If the reference is temporary, it will be cleared after reading it, so they can each only be read once.
     * If the reference is not temporary (i.e. read-only), it will not be cleared after reading it
     * (see `_isTemporaryChainedReference` function).
     */
    function _getChainedReferenceValue(uint256 ref) internal override returns (uint256) {
        (bytes32 slot, uint256 value) = _peekChainedReferenceValue(ref);

        if (_isTemporaryChainedReference(ref)) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                sstore(slot, 0)
            }
        }
        return value;
    }

    /**
     * @dev Returns the storage slot for reference `ref` as well as the amount referenced by it.
     * It does not alter the reference (even if it's marked as temporary).
     */
    function _peekChainedReferenceValue(uint256 ref) private view returns (bytes32 slot, uint256 value) {
        slot = _getStorageSlot(ref);

        // Since we do manual calculation of storage slots, it is easier (and cheaper) to rely on internal assembly to
        // access it.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            value := sload(slot)
        }
    }

    // solhint-disable-next-line var-name-mixedcase
    bytes32 private immutable _TEMP_STORAGE_SUFFIX = keccak256("balancer.base-relayer-library");

    function _getStorageSlot(uint256 ref) private view returns (bytes32) {
        // This replicates the mechanism Solidity uses to allocate storage slots for mappings, but using a hash as the
        // mapping's storage slot, and subtracting 1 at the end. This should be more than enough to prevent collisions
        // with other state variables this or derived contracts might use.
        // See https://docs.soliditylang.org/en/v0.8.9/internals/layout_in_storage.html

        return bytes32(uint256(keccak256(abi.encodePacked(_removeReferencePrefix(ref), _TEMP_STORAGE_SUFFIX))) - 1);
    }

    /**
     * @dev Returns a reference without its prefix.
     * Use this function to calculate the storage slot so that it's the same for temporary and read-only references.
     */
    function _removeReferencePrefix(uint256 ref) private pure returns (uint256) {
        return (ref & 0x0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
    }
}
