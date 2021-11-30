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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "./BalancerRelayer.sol";
import "../interfaces/IBalancerRelayer.sol";
import "../interfaces/IBaseRelayerLibrary.sol";

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
 */
contract BaseRelayerLibrary is IBaseRelayerLibrary {
    using Address for address;

    IVault private immutable _vault;
    IBalancerRelayer private immutable _entrypoint;

    constructor(IVault vault) IBaseRelayerLibrary(vault.WETH()) {
        _vault = vault;
        _entrypoint = new BalancerRelayer(vault, address(this));
    }

    function getVault() public view override returns (IVault) {
        return _vault;
    }

    function getEntrypoint() public view returns (IBalancerRelayer) {
        return _entrypoint;
    }

    /**
     * @notice Sets whether a particular relayer is authorised to act on behalf of the user
     */
    function setRelayerApproval(
        address relayer,
        bool approved,
        bytes calldata authorisation
    ) external payable {
        require(relayer == address(this) || !approved, "Relayer can only approve itself");
        bytes memory data = abi.encodePacked(
            abi.encodeWithSelector(_vault.setRelayerApproval.selector, msg.sender, relayer, approved),
            authorisation
        );

        address(_vault).functionCall(data);
    }

    /**
     * @notice Approves the Vault to use tokens held in the relayer
     * @dev This is needed to avoid having to send intermediate tokens back to the user
     */
    function approveVault(IERC20 token, uint256 amount) public override {
        // TODO: gas golf this a bit
        token.approve(address(getVault()), amount);
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
        return
            (amount & 0xffff000000000000000000000000000000000000000000000000000000000000) ==
            0xba10000000000000000000000000000000000000000000000000000000000000;
    }

    /**
     * @dev Stores `value` as the amount referenced by chained reference `ref`.
     */
    function _setChainedReferenceValue(uint256 ref, uint256 value) internal override {
        bytes32 slot = _getTempStorageSlot(ref);

        // Since we do manual calculation of storage slots, it is easier (and cheaper) to rely on internal assembly to
        // access it.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(slot, value)
        }
    }

    /**
     * @dev Returns the amount referenced by chained reference `ref`. Reading an amount clears it, so they can each
     * only be read once.
     */
    function _getChainedReferenceValue(uint256 ref) internal override returns (uint256 value) {
        bytes32 slot = _getTempStorageSlot(ref);

        // Since we do manual calculation of storage slots, it is easier (and cheaper) to rely on internal assembly to
        // access it.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            value := sload(slot)
            sstore(slot, 0)
        }
    }

    // solhint-disable-next-line var-name-mixedcase
    bytes32 private immutable _TEMP_STORAGE_SUFFIX = keccak256("balancer.base-relayer-library");

    function _getTempStorageSlot(uint256 ref) private view returns (bytes32) {
        // This replicates the mechanism Solidity uses to allocate storage slots for mappings, but using a hash as the
        // mapping's storage slot, and subtracting 1 at the end. This should be more than enough to prevent collisions
        // with other state variables this or derived contracts might use.
        // See https://docs.soliditylang.org/en/v0.8.9/internals/layout_in_storage.html

        return bytes32(uint256(keccak256(abi.encodePacked(ref, _TEMP_STORAGE_SUFFIX))) - 1);
    }
}
