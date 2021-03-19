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
import "./AssetTransfersHandler.sol";
import "./balances/InternalBalanceAllocation.sol";

abstract contract InternalBalance is ReentrancyGuard, AssetTransfersHandler, Fees {
    using Math for uint256;
    using SafeERC20 for IERC20;
    using InternalBalanceAllocation for bytes32;

    // Stores all account's Internal Balance for each token.
    mapping(address => mapping(IERC20 => bytes32)) private _internalTokenBalance;

    function getInternalBalance(address user, IERC20[] memory tokens)
        external
        view
        override
        returns (uint256[] memory balances)
    {
        balances = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            balances[i] = _getInternalBalance(user, tokens[i]).actual();
        }
    }

    function depositToInternalBalance(BalanceTransfer[] memory transfers)
        external
        override
        nonReentrant
        noEmergencyPeriod
    {
        for (uint256 i = 0; i < transfers.length; i++) {
            address sender = transfers[i].sender;
            _authenticateCallerFor(sender);

            IERC20 token = transfers[i].token;
            uint256 amount = transfers[i].amount;
            address recipient = transfers[i].recipient;

            _increaseInternalBalance(recipient, token, amount, true);
            token.safeTransferFrom(sender, address(this), amount);
        }
    }

    function transferToExternalBalance(BalanceTransfer[] memory transfers) external override nonReentrant {
        for (uint256 i = 0; i < transfers.length; i++) {
            address sender = transfers[i].sender;
            _authenticateCallerFor(sender);

            IERC20 token = transfers[i].token;
            uint256 amount = transfers[i].amount;
            address recipient = transfers[i].recipient;

            // Do not charge withdrawal fee, since it's just making use of the Vault's allowance
            token.safeTransferFrom(sender, recipient, amount);
        }
    }

    function withdrawFromInternalBalance(BalanceTransfer[] memory transfers) external override nonReentrant {
        for (uint256 i = 0; i < transfers.length; i++) {
            address sender = transfers[i].sender;
            _authenticateCallerFor(sender);

            IERC20 token = transfers[i].token;
            uint256 amount = transfers[i].amount;
            address recipient = transfers[i].recipient;

            uint256 amountToTransfer = amount;
            (uint256 taxableAmount, ) = _decreaseInternalBalance(sender, token, amount, false);

            if (taxableAmount > 0) {
                uint256 feeAmount = _calculateProtocolWithdrawFeeAmount(taxableAmount);
                _increaseCollectedFees(token, feeAmount);
                amountToTransfer = amount.sub(feeAmount);
            }

            token.safeTransfer(recipient, amountToTransfer);
        }
    }

    function transferInternalBalance(BalanceTransfer[] memory transfers)
        external
        override
        nonReentrant
        noEmergencyPeriod
    {
        for (uint256 i = 0; i < transfers.length; i++) {
            address sender = transfers[i].sender;
            _authenticateCallerFor(sender);

            IERC20 token = transfers[i].token;
            uint256 amount = transfers[i].amount;
            address recipient = transfers[i].recipient;

            // We ignore the taxable amount here since the assets will stay in the Vault
            _decreaseInternalBalance(sender, token, amount, false);
            // We don't track cached values to reduce the taxable amount in transfers
            _increaseInternalBalance(recipient, token, amount, false);
        }
    }

    /**
     * @dev Increases `account`'s Internal Balance for `token` by `amount`.
     */
    function _increaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount,
        bool track
    ) internal override {
        bytes32 currentInternalBalance = _getInternalBalance(account, token);
        bytes32 newBalance = currentInternalBalance.increase(amount, track);
        _setInternalBalance(account, token, newBalance);
    }

    /**
     * @dev Decreases `account`'s Internal Balance for `token` by `amount`.
     */
    function _decreaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount,
        bool capped
    ) internal override returns (uint256, uint256) {
        bytes32 currentInternalBalance = _getInternalBalance(account, token);
        (bytes32 newBalance, uint256 taxableAmount, uint256 decreasedAmount) = currentInternalBalance.decrease(
            amount,
            capped
        );
        _setInternalBalance(account, token, newBalance);
        return (taxableAmount, decreasedAmount);
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
        bytes32 balance
    ) private {
        _internalTokenBalance[account][token] = balance;
        emit InternalBalanceChanged(account, token, balance.actual());
    }

    /**
     * @dev Returns `account`'s Internal Balance for `token`.
     */
    function _getInternalBalance(address account, IERC20 token) internal view returns (bytes32) {
        return _internalTokenBalance[account][token];
    }
}
