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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../lib/math/Math.sol";
import "../lib/helpers/BalancerErrors.sol";
import "../lib/helpers/InputHelpers.sol";
import "../lib/helpers/ReentrancyGuard.sol";
import "../lib/openzeppelin/SafeERC20.sol";
import "../lib/openzeppelin/SafeCast.sol";

import "./VaultAuthorization.sol";
import "./AssetTransfersHandler.sol";

abstract contract InternalBalance is ReentrancyGuard, AssetTransfersHandler, VaultAuthorization {
    using Math for uint256;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    // Stores all accounts' Internal Balances for each token.
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

    function manageUserBalance(UserBalanceOp[] memory ops) external payable override nonReentrant noEmergencyPeriod {
        IAsset asset;
        address sender;
        uint256 amount;
        address recipient;
        bool authenticated = false;
        uint256 wrappedEth = 0;

        UserBalanceOp memory op;
        for (uint256 i = 0; i < ops.length; i++) {
            op = ops[i];
            (asset, sender, recipient, amount, authenticated) = _validateUserBalanceOp(op, authenticated);

            if (op.kind == UserBalanceOpKind.WITHDRAW_INTERNAL) {
                _withdrawFromInternalBalance(asset, sender, recipient, amount);
            } else if (op.kind == UserBalanceOpKind.DEPOSIT_INTERNAL) {
                _depositToInternalBalance(asset, sender, recipient, amount);

                // Only deposits wrap ETH, in case some value was sent and there was no deposit it will be returned
                // back to the msg.sender at the end of function
                if (_isETH(asset)) {
                    wrappedEth = wrappedEth.add(amount);
                }
            } else {
                // Transfers don't support assets. Therefore, we check no ETH sentinel was used before casting
                _require(!_isETH(asset), Errors.CANNOT_USE_ETH_SENTINEL);
                // Cast asset into IERC20 with no translation.
                IERC20 token = _asIERC20(asset);

                (op.kind == UserBalanceOpKind.TRANSFER_INTERNAL)
                    ? _transferInternalBalance(token, sender, recipient, amount)
                    : _transferToExternalBalance(token, sender, recipient, amount);
            }
        }

        // Handle any used and remaining ETH.
        _handleRemainingEth(wrappedEth);
    }

    function _depositToInternalBalance(
        IAsset asset,
        address sender,
        address recipient,
        uint256 amount
    ) internal {
        _increaseInternalBalance(recipient, _translateToIERC20(asset), amount);
        _receiveAsset(asset, amount, sender, false);
    }

    function _withdrawFromInternalBalance(
        IAsset asset,
        address sender,
        address recipient,
        uint256 amount
    ) private {
        IERC20 token = _translateToIERC20(asset);
        _decreaseInternalBalance(sender, token, amount, false);
        _sendAsset(asset, amount, payable(recipient), false);
    }

    function _transferInternalBalance(
        IERC20 token,
        address sender,
        address recipient,
        uint256 amount
    ) private {
        _decreaseInternalBalance(sender, token, amount, false);
        _increaseInternalBalance(recipient, token, amount);
    }

    function _transferToExternalBalance(
        IERC20 token,
        address sender,
        address recipient,
        uint256 amount
    ) private {
        token.safeTransferFrom(sender, recipient, amount);
        emit ExternalBalanceTransfer(token, sender, recipient, amount);
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
        _internalTokenBalance[account][token] = newBalance;
        emit InternalBalanceChanged(account, token, amount.toInt256());
    }

    /**
     * @dev Decreases `account`'s Internal Balance for `token` by `amount`.
     * When `capped` the internal balance will be decreased as much as possible without reverting.
     *
     * Returns the amount that was actually deducted from Internal Balance. Note this might not be equal to `amount`
     * in case it was `capped` and the Internal Balance was actually lower.
     */
    function _decreaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount,
        bool capped
    ) internal override returns (uint256 deducted) {
        uint256 currentBalance = _getInternalBalance(account, token);
        _require(capped || (currentBalance >= amount), Errors.INSUFFICIENT_INTERNAL_BALANCE);

        deducted = Math.min(currentBalance, amount);
        uint256 newBalance = currentBalance - deducted;

        _internalTokenBalance[account][token] = newBalance;
        emit InternalBalanceChanged(account, token, -(deducted.toInt256()));
    }

    /**
     * @dev Returns `account`'s Internal Balance for `token`.
     */
    function _getInternalBalance(address account, IERC20 token) internal view returns (uint256) {
        return _internalTokenBalance[account][token];
    }

    /**
     * @dev Decodes a user balance op and validates the actual sender is allowed to operate
     */
    function _validateUserBalanceOp(UserBalanceOp memory op, bool wasAuthenticated)
        private
        view
        returns (
            IAsset asset,
            address sender,
            address recipient,
            uint256 amount,
            bool authenticated
        )
    {
        sender = op.sender;
        authenticated = wasAuthenticated;

        if (sender != msg.sender) {
            // In case we found a `sender` address that is not the actual sender (msg.sender)
            // we ensure it's a relayer allowed by the protocol. Note that we are not computing this check
            // for the next senders, it's a global authorization, we only need to check it once.
            if (!wasAuthenticated) {
                // This will revert in case the actual sender is not allowed by the protocol
                _authenticateCaller();
                authenticated = true;
            }

            // Finally we check the actual msg.sender was also allowed by the `sender`
            _authenticateCallerFor(sender);
        }

        asset = op.asset;
        amount = op.amount;
        recipient = op.recipient;
    }
}
