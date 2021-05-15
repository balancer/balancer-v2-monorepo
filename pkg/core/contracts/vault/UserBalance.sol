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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeCast.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "./AssetTransfersHandler.sol";
import "./VaultAuthorization.sol";

/**
 * Implement User Balance interactions, which combine Internal Balance and using the Vault's ERC20 allowance.
 *
 * Users can deposit tokens into the Vault, where they are allocated to their Internal Balance, and later
 * transferred or withdrawn. It can also be used as a source of tokens when joining Pools, as a destination
 * when exiting them, and as either when performing swaps. This usage of Internal Balance results in greatly reduced
 * gas costs when compared to relying on plain ERC20 transfers, leading to large savings for frequent users.
 *
 * Internal Balance management features batching, which means a single contract call can be used to perform multiple
 * operations of different kinds, with different senders and recipients, at once.
 */
abstract contract UserBalance is ReentrancyGuard, AssetTransfersHandler, VaultAuthorization {
    using Math for uint256;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    // Internal Balance for each token, for each account.
    mapping(address => mapping(IERC20 => uint256)) private _internalTokenBalance;

    function getInternalBalance(address user, IERC20[] memory tokens)
        external
        view
        override
        returns (uint256[] memory balances)
    {
        balances = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            balances[i] = _getInternalBalance(user, tokens[i]);
        }
    }

    function manageUserBalance(UserBalanceOp[] memory ops) external payable override nonReentrant {
        // We need to track how much of the received ETH was used and wrapped into WETH to return any excess.
        uint256 ethWrapped = 0;

        // Cache for these checks so we only perform them once (if at all).
        bool checkedCallerIsRelayer = false;
        bool checkedNotPaused = false;

        for (uint256 i = 0; i < ops.length; i++) {
            UserBalanceOpKind kind;
            IAsset asset;
            uint256 amount;
            address sender;
            address payable recipient;

            // This destructuring by calling `_validateUserBalanceOp` seems odd, but results in reduced bytecode size.
            (kind, asset, amount, sender, recipient, checkedCallerIsRelayer) = _validateUserBalanceOp(
                ops[i],
                checkedCallerIsRelayer
            );

            if (kind == UserBalanceOpKind.WITHDRAW_INTERNAL) {
                // Internal Balance withdrawals can always be performed by an authorized account.
                _withdrawFromInternalBalance(asset, sender, recipient, amount);
            } else {
                // All other operations are blocked if the contract is paused.

                // We cache the result of the pause check and skip it for other operations in this same transaction
                // (if any).
                if (!checkedNotPaused) {
                    _ensureNotPaused();
                    checkedNotPaused = true;
                }

                if (kind == UserBalanceOpKind.DEPOSIT_INTERNAL) {
                    _depositToInternalBalance(asset, sender, recipient, amount);

                    // Keep track of all ETH wrapped into WETH as part of a deposit.
                    if (_isETH(asset)) {
                        ethWrapped = ethWrapped.add(amount);
                    }
                } else {
                    // Transfers don't support ETH.
                    _require(!_isETH(asset), Errors.CANNOT_USE_ETH_SENTINEL);
                    IERC20 token = _asIERC20(asset);

                    if (kind == UserBalanceOpKind.TRANSFER_INTERNAL) {
                        _transferInternalBalance(token, sender, recipient, amount);
                    } else {
                        // TRANSFER_EXTERNAL
                        _transferToExternalBalance(token, sender, recipient, amount);
                    }
                }
            }
        }

        // Handle any remaining ETH.
        _handleRemainingEth(ethWrapped);
    }

    function _depositToInternalBalance(
        IAsset asset,
        address sender,
        address recipient,
        uint256 amount
    ) private {
        _increaseInternalBalance(recipient, _translateToIERC20(asset), amount);
        _receiveAsset(asset, amount, sender, false);
    }

    function _withdrawFromInternalBalance(
        IAsset asset,
        address sender,
        address payable recipient,
        uint256 amount
    ) private {
        // A partial decrease of Internal Balance is disallowed: `sender` must have the full `amount`.
        _decreaseInternalBalance(sender, _translateToIERC20(asset), amount, false);
        _sendAsset(asset, amount, recipient, false);
    }

    function _transferInternalBalance(
        IERC20 token,
        address sender,
        address recipient,
        uint256 amount
    ) private {
        // A partial decrease of Internal Balance is disallowed: `sender` must have the full `amount`.
        _decreaseInternalBalance(sender, token, amount, false);
        _increaseInternalBalance(recipient, token, amount);
    }

    function _transferToExternalBalance(
        IERC20 token,
        address sender,
        address recipient,
        uint256 amount
    ) private {
        if (amount > 0) {
            token.safeTransferFrom(sender, recipient, amount);
            emit ExternalBalanceTransfer(token, sender, recipient, amount);
        }
    }

    /**
     * @dev Increases `account`'s Internal Balance for `token` by `amount`.
     */
    function _increaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount
    ) internal override {
        uint256 currentBalance = _getInternalBalance(account, token);
        uint256 newBalance = currentBalance.add(amount);
        _setInternalBalance(account, token, newBalance, amount.toInt256());
    }

    /**
     * @dev Decreases `account`'s Internal Balance for `token` by `amount`. If `allowPartial` is true, this function
     * doesn't revert if `account` doesn't have enough balance, and sets it to zero and returns the deducted amount
     * instead.
     */
    function _decreaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount,
        bool allowPartial
    ) internal override returns (uint256 deducted) {
        uint256 currentBalance = _getInternalBalance(account, token);
        _require(allowPartial || (currentBalance >= amount), Errors.INSUFFICIENT_INTERNAL_BALANCE);

        deducted = Math.min(currentBalance, amount);
        // By construction, `deducted` is lower or equal to `currentBalance`, so we don't need to use checked
        // arithmetic.
        uint256 newBalance = currentBalance - deducted;
        _setInternalBalance(account, token, newBalance, -(deducted.toInt256()));
    }

    /**
     * @dev Sets `account`'s Internal Balance for `token` to `newBalance`.
     *
     * Emits an `InternalBalanceChanged` event. This event includes `delta`, which is the amount the balance increased
     * (if positive) or decreased (if negative). To avoid reading the current balance in order to compute the delta,
     * this function relies on the caller providing it directly.
     */
    function _setInternalBalance(
        address account,
        IERC20 token,
        uint256 newBalance,
        int256 delta
    ) private {
        _internalTokenBalance[account][token] = newBalance;
        emit InternalBalanceChanged(account, token, delta);
    }

    /**
     * @dev Returns `account`'s Internal Balance for `token`.
     */
    function _getInternalBalance(address account, IERC20 token) internal view returns (uint256) {
        return _internalTokenBalance[account][token];
    }

    /**
     * @dev Destructures a User Balance operation, validating that the contract caller is allowed to perform it.
     */
    function _validateUserBalanceOp(UserBalanceOp memory op, bool checkedCallerIsRelayer)
        private
        view
        returns (
            UserBalanceOpKind,
            IAsset,
            uint256,
            address,
            address payable,
            bool
        )
    {
        // The only argument we need to validate is `sender`, which can only be either the contract caller, or a
        // relayer approved by `sender`.
        address sender = op.sender;

        if (sender != msg.sender) {
            // We need to check both that the contract caller is a relayer, and that `sender` approved them.

            // Because the relayer check is global (i.e. independent of `sender`), we cache that result and skip it for
            // other operations in this same transaction (if any).
            if (!checkedCallerIsRelayer) {
                _authenticateCaller();
                checkedCallerIsRelayer = true;
            }

            _require(_hasApprovedRelayer(sender, msg.sender), Errors.USER_DOESNT_ALLOW_RELAYER);
        }

        return (op.kind, op.asset, op.amount, sender, op.recipient, checkedCallerIsRelayer);
    }
}
