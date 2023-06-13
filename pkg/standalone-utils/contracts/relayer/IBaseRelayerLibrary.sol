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

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-vault/contracts/AssetHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

/**
 * @title IBaseRelayerLibrary
 */
abstract contract IBaseRelayerLibrary is AssetHelpers {
    using SafeERC20 for IERC20;

    constructor(IWETH weth) AssetHelpers(weth) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function getVault() public view virtual returns (IVault);

    function approveVault(IERC20 token, uint256 amount) external payable virtual;

    function peekChainedReferenceValue(uint256 ref) external payable virtual returns (uint256);

    function _pullToken(
        address sender,
        IERC20 token,
        uint256 amount
    ) internal virtual;

    function _pullTokens(
        address sender,
        IERC20[] memory tokens,
        uint256[] memory amounts
    ) internal virtual;

    function _isChainedReference(uint256 amount) internal pure virtual returns (bool);

    function _setChainedReferenceValue(uint256 ref, uint256 value) internal virtual;

    function _getChainedReferenceValue(uint256 ref) internal virtual returns (uint256);

    /**
     * @dev This reuses `_resolveAmountAndPullToken` to adjust the `amount` in case it is a chained reference,
     * then pull that amount of `token` to the relayer. Additionally, it approves the `spender` to enable
     * wrapping operations. The spender is usually a token, but could also be another kind of contract (e.g.,
     * a protocol or gauge).
     */
    function _resolveAmountPullTokenAndApproveSpender(
        IERC20 token,
        address spender,
        uint256 amount,
        address sender
    ) internal returns (uint256 resolvedAmount) {
        resolvedAmount = _resolveAmountAndPullToken(token, amount, sender);

        token.safeApprove(spender, resolvedAmount);
    }

    /**
     * @dev Extract the `amount` (if it is a chained reference), and pull that amount of `token` to
     * this contract.
     */
    function _resolveAmountAndPullToken(
        IERC20 token,
        uint256 amount,
        address sender
    ) internal returns (uint256 resolvedAmount) {
        resolvedAmount = _resolveAmount(amount);

        // The wrap caller is the implicit sender of tokens, so if the goal is for the tokens
        // to be sourced from outside the relayer, we must first pull them here.
        if (sender != address(this)) {
            require(sender == msg.sender, "Incorrect sender");
            _pullToken(sender, token, resolvedAmount);
        }
    }

    /**
     * @dev Resolve an amount from a possible chained reference. This is internal, since some wrappers
     * call it independently.
     */
    function _resolveAmount(uint256 amount) internal returns (uint256) {
        return _isChainedReference(amount) ? _getChainedReferenceValue(amount) : amount;
    }

    /**
     * @dev Transfer the given `amount` of `token` to `recipient`, then call `_setChainedReference`
     * with that amount, in case it needs to be encoded as an output reference.
     */
    function _transferAndSetChainedReference(
        IERC20 token,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) internal {
        if (recipient != address(this)) {
            token.safeTransfer(recipient, amount);
        }

        _setChainedReference(outputReference, amount);
    }

    /**
     * @dev Check for a chained output reference, and encode the given `amount` if necessary.
     * This is internal, since some wrappers call it independently.
     */
    function _setChainedReference(uint256 outputReference, uint256 amount) internal {
        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, amount);
        }
    }
}
