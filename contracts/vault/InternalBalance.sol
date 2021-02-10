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
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../lib/math/Math.sol";
import "../lib/helpers/ReentrancyGuard.sol";

import "./Fees.sol";

abstract contract InternalBalance is ReentrancyGuard, Fees {
    using Math for uint256;
    using SafeERC20 for IERC20;

    // Stores all account's Internal Balance for each token.
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

    function depositToInternalBalance(
        address sender,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        address recipient
    ) external override nonReentrant authenticateFor(sender) {
        InputHelpers.ensureInputLengthMatch(tokens.length, amounts.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];

            _increaseInternalBalance(recipient, token, amount);
            token.safeTransferFrom(sender, address(this), amount);
        }
    }

    function withdrawFromInternalBalance(
        address sender,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        address recipient
    ) external override nonReentrant authenticateFor(sender) {
        InputHelpers.ensureInputLengthMatch(tokens.length, amounts.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];

            uint256 feeAmount = _calculateProtocolWithdrawFeeAmount(amount);
            _increaseCollectedFees(token, feeAmount);

            _decreaseInternalBalance(sender, token, amount);
            token.safeTransfer(recipient, amount.sub(feeAmount));
        }
    }

    function transferInternalBalance(
        address sender,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        address[] memory recipients
    ) external override nonReentrant authenticateFor(sender) {
        InputHelpers.ensureInputLengthMatch(tokens.length, amounts.length, recipients.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];
            address recipient = recipients[i];

            _decreaseInternalBalance(sender, token, amount);
            _increaseInternalBalance(recipient, token, amount);
        }
    }

    /**
     * @dev Increases `account`'s Internal Balance for `token` by `amount`.
     */
    function _increaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount
    ) internal {
        uint256 currentInternalBalance = _getInternalBalance(account, token);
        uint256 newBalance = currentInternalBalance.add(amount);
        _setInternalBalance(account, token, newBalance);
    }

    /**
     * @dev Decreases `account`'s Internal Balance for `token` by `amount`.
     */
    function _decreaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount
    ) internal {
        uint256 currentInternalBalance = _getInternalBalance(account, token);
        require(currentInternalBalance >= amount, "INSUFFICIENT_INTERNAL_BALANCE");
        uint256 newBalance = currentInternalBalance - amount;
        _setInternalBalance(account, token, newBalance);
    }

    /**
     * @dev Sets `account`'s Internal Balance for `token` to `balance`.
     *
     * This costs less gas than `_increaseInternalBalance` or `_decreaseInternalBalance`, since the current collected
     * fees do not need to be read.
     */
    function _setInternalBalance(
        address account,
        IERC20 token,
        uint256 balance
    ) internal {
        _internalTokenBalance[account][token] = balance;
        emit InternalBalanceChanged(account, token, balance);
    }

    /**
     * @dev Returns `account`'s Internal Balance for `token`.
     */
    function _getInternalBalance(address account, IERC20 token) internal view returns (uint256) {
        return _internalTokenBalance[account][token];
    }
}
