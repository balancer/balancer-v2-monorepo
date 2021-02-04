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

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../lib/math/Math.sol";
import "../lib/math/FixedPoint.sol";
import "../lib/helpers/ReentrancyGuard.sol";

import "./interfaces/IVault.sol";
import "./Authorization.sol";

abstract contract Fees is IVault, ReentrancyGuard, Authorization {
    using Math for uint256;
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    // Stores the fee collected per each token that is only withdrawable by the admin.
    mapping(IERC20 => uint256) private _collectedProtocolFees;

    // The withdraw fee is charged whenever tokens exit the vault (except in the case of swaps), and is a
    // percentage of the tokens exiting
    uint256 private _protocolWithdrawFee;

    // The swap fee is charged whenever a swap occurs, and is a percentage of the fee charged by the Pool.
    // The Vault relies on the Pool being honest and reporting the actual fee it charged.
    uint256 private _protocolSwapFee;

    // The flash loan fee is charged whenever a flash loan occurs, and is a percentage of the tokens lent
    uint256 private _protocolFlashLoanFee;

    // solhint-disable-next-line var-name-mixedcase
    uint256 private constant _MAX_PROTOCOL_WITHDRAW_FEE = 0.02e18; // 2%

    // solhint-disable-next-line var-name-mixedcase
    uint256 private constant _MAX_PROTOCOL_SWAP_FEE = 0.5e18; // 50%

    // solhint-disable-next-line var-name-mixedcase
    uint256 private constant _MAX_PROTOCOL_FLASH_LOAN_FEE = 0.5e18; // 50%

    function getProtocolWithdrawFee() public view override returns (uint256) {
        return _protocolWithdrawFee;
    }

    function _calculateProtocolWithdrawFeeAmount(uint256 amount) internal view returns (uint256) {
        return amount.mul(_protocolWithdrawFee);
    }

    function getProtocolSwapFee() public view override returns (uint256) {
        return _protocolSwapFee;
    }

    function getProtocolFlashLoanFee() public view override returns (uint256) {
        return _protocolFlashLoanFee;
    }

    function _calculateProtocolFlashLoanFeeAmount(uint256 swapFeeAmount) internal view returns (uint256) {
        return swapFeeAmount.mul(_protocolFlashLoanFee);
    }

    function setProtocolWithdrawFee(uint256 newFee) external override nonReentrant {
        require(getAuthorizer().canSetProtocolWithdrawFee(msg.sender), "CANNOT_SET_WITHDRAW_FEE");
        require(newFee <= _MAX_PROTOCOL_WITHDRAW_FEE, "WITHDRAW_FEE_TOO_HIGH");

        _protocolWithdrawFee = newFee;
    }

    function setProtocolSwapFee(uint256 newFee) external override nonReentrant {
        require(getAuthorizer().canSetProtocolSwapFee(msg.sender), "CANNOT_SET_SWAP_FEE");
        require(newFee <= _MAX_PROTOCOL_SWAP_FEE, "SWAP_FEE_TOO_HIGH");

        _protocolSwapFee = newFee;
    }

    function setProtocolFlashLoanFee(uint256 newFee) external override nonReentrant {
        require(getAuthorizer().canSetProtocolFlashLoanFee(msg.sender), "CANNOT_SET_FLASHLOAN_FEE");
        require(newFee <= _MAX_PROTOCOL_FLASH_LOAN_FEE, "FLASHLOAN_FEE_TOO_HIGH");

        _protocolFlashLoanFee = newFee;
    }

    function getCollectedFees(IERC20[] memory tokens) external view override returns (uint256[] memory fees) {
        return _getCollectedFees(tokens);
    }

    function withdrawCollectedFees(
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        address recipient
    ) external override nonReentrant {
        require(tokens.length == amounts.length, "ARRAY_LENGTH_MISMATCH");

        IAuthorizer authorizer = getAuthorizer();
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            require(authorizer.canWithdrawCollectedFees(msg.sender, token), "CANNOT_WITHDRAW_FEES");

            uint256 amount = amounts[i];
            _decreaseCollectedFees(token, amount);
            token.safeTransfer(recipient, amount);
        }
    }

    function _increaseCollectedFees(IERC20 token, uint256 amount) internal {
        uint256 currentCollectedFees = _getCollectedFeesByToken(token);
        uint256 newTotal = currentCollectedFees.add(amount);
        _setCollectedFees(token, newTotal);
    }

    function _decreaseCollectedFees(IERC20 token, uint256 amount) internal {
        uint256 currentCollectedFees = _getCollectedFeesByToken(token);
        require(currentCollectedFees >= amount, "INSUFFICIENT_COLLECTED_FEES");

        uint256 newTotal = currentCollectedFees - amount;
        _setCollectedFees(token, newTotal);
    }

    function _setCollectedFees(IERC20 token, uint256 newTotal) internal {
        _collectedProtocolFees[token] = newTotal;
    }

    function _getCollectedFees(IERC20[] memory tokens) internal view returns (uint256[] memory fees) {
        fees = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            fees[i] = _collectedProtocolFees[tokens[i]];
        }
    }

    function _getCollectedFeesByToken(IERC20 token) internal view returns (uint256) {
        return _collectedProtocolFees[token];
    }
}
