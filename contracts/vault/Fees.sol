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

import "../math/FixedPoint.sol";

import "./interfaces/IVault.sol";
import "./Authorization.sol";

abstract contract Fees is IVault, Authorization {
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    // Stores the fee collected per each token that is only withdrawable by the admin.
    mapping(IERC20 => uint256) internal _collectedProtocolFees;

    // The withdraw fee is charged whenever tokens exit the vault (except in the case of swaps), and is a
    // percentage of the tokens exiting
    uint128 private _protocolWithdrawFee;

    // The swap fee is charged whenever a swap occurs, and is a percentage of the fee charged by the trading strategy.
    // The Vault relies on the trading strategy being honest and reporting the actuall fee it charged.
    uint128 private _protocolSwapFee;

    uint128 private immutable _MAX_PROTOCOL_WITHDRAW_FEE = FixedPoint.ONE.mul128(2).div128(100); // 0.02 (2%)

    // The flash loan fee is charged whenever a flash loan occurs, and is a percentage of the tokens lent
    uint256 private _protocolFlashLoanFee;

    uint128 private immutable _MAX_PROTOCOL_SWAP_FEE = FixedPoint.ONE.mul128(50).div128(100); // 0.5 (50%)

    uint256 private immutable _MAX_PROTOCOL_FLASH_LOAN_FEE = FixedPoint.ONE.mul128(50).div128(100); // 0.5 (50%)

    function protocolWithdrawFee() public view returns (uint128) {
        return _protocolWithdrawFee;
    }

    function _calculateProtocolWithdrawFeeAmount(uint128 amount) internal view returns (uint128) {
        return amount.mul128(_protocolWithdrawFee);
    }

    function protocolSwapFee() public view returns (uint128) {
        return _protocolSwapFee;
    }

    function protocolFlashLoanFee() public view returns (uint256) {
        return _protocolFlashLoanFee;
    }

    function _calculateProtocolFlashLoanFeeAmount(uint256 swapFeeAmount) internal view returns (uint256) {
        return swapFeeAmount.mul(_protocolFlashLoanFee);
    }

    function setProtocolWithdrawFee(uint128 newFee) external {
        require(getAuthorizer().canSetProtocolWithdrawFee(msg.sender), "Caller cannot set protocol withdraw fee");
        require(newFee <= _MAX_PROTOCOL_WITHDRAW_FEE, "Withdraw fee too high");

        _protocolWithdrawFee = newFee;
    }

    function setProtocolSwapFee(uint128 newFee) external {
        require(getAuthorizer().canSetProtocolSwapFee(msg.sender), "Caller cannot set protocol swap fee");
        require(newFee <= _MAX_PROTOCOL_SWAP_FEE, "Swap fee too high");

        _protocolSwapFee = newFee;
    }

    function setProtocolFlashLoanFee(uint128 newFee) external {
        require(getAuthorizer().canSetProtocolFlashLoanFee(msg.sender), "Caller cannot set protocol flash loan fee");
        require(newFee <= _MAX_PROTOCOL_FLASH_LOAN_FEE, "FlashLoan fee too high");

        _protocolFlashLoanFee = newFee;
    }

    //Protocol Fees
    /**
     * @dev Returns the amount in protocol fees collected for a specific `token`.
     */
    function getCollectedFeesByToken(IERC20 token) external view override returns (uint256) {
        return _collectedProtocolFees[token];
    }

    function withdrawProtocolFees(
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        address recipient
    ) external override {
        require(tokens.length == amounts.length, "Tokens and amounts length mismatch");

        IAuthorizer authorizer = getAuthorizer();
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            require(authorizer.canCollectProtocolFees(msg.sender, token), "Caller cannot withdraw protocol fees");

            uint256 amount = amounts[i];
            require(_collectedProtocolFees[token] >= amount, "Insufficient protocol fees");
            _collectedProtocolFees[token] -= amount;
            token.safeTransfer(recipient, amount);
        }
    }
}
