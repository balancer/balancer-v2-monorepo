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
import "../lib/helpers/InputHelpers.sol";
import "../lib/helpers/ReentrancyGuard.sol";

import "./AssetTransfersHandler.sol";
import "./Fees.sol";

abstract contract InternalBalance is ReentrancyGuard, AssetTransfersHandler, Fees {
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

    function depositToInternalBalance(BalanceTransfer[] memory transfers)
        external
        override
        nonReentrant
        noEmergencyPeriod
    {
        for (uint256 i = 0; i < transfers.length; i++) {
            address sender = transfers[i].sender;
            _authenticateCallerFor(sender);

            IAsset asset = transfers[i].asset;
            uint256 amount = transfers[i].amount;
            address recipient = transfers[i].recipient;

            _receiveAsset(asset, amount, sender, false);
            _increaseInternalBalance(recipient, _translateToIERC20(asset), amount);
        }
    }

    function transferToExternalBalance(BalanceTransfer[] memory transfers) external override nonReentrant {
        for (uint256 i = 0; i < transfers.length; i++) {
            address sender = transfers[i].sender;
            _authenticateCallerFor(sender);

            require(!_isETH(transfers[i].asset), "INVALID_ETH_EXTERNAL_TRANSFER");

            IERC20 token = _asIERC20(transfers[i].asset);
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

            IAsset asset = transfers[i].asset;
            uint256 amount = transfers[i].amount;
            address payable recipient = transfers[i].recipient;

            uint256 feeAmount = _sendAsset(asset, amount, recipient, false, true);

            IERC20 token = _translateToIERC20(asset);
            _decreaseInternalBalance(sender, token, amount);
            _increaseCollectedFees(token, feeAmount);
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

            IAsset asset = transfers[i].asset;
            uint256 amount = transfers[i].amount;
            address recipient = transfers[i].recipient;

            require(!_isETH(asset), "INVALID_ETH_TRANSFER");

            IERC20 token = _asIERC20(asset);
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
    ) internal override {
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
     * @dev Same as _decreaseInternalBalance, except it doesn't revert of `account` doesn't have enough balance, and
     * instead decreases it by as much as possible.
     *
     * Returns the amount of Internal Balance deducted.
     */
    function _decreaseRemainingInternalBalance(
        address account,
        IERC20 token,
        uint256 amount
    ) internal override returns (uint256) {
        uint256 currentInternalBalance = _getInternalBalance(account, token);
        uint256 toDeduct = Math.min(currentInternalBalance, amount);

        // toDeduct is by construction smaller or equal than currentInternalBalance, so we don't need checked
        // arithmetic.
        _setInternalBalance(account, token, currentInternalBalance - toDeduct);

        return toDeduct;
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
