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

// This flash loan provider was based on the Aave protocol's open source
// implementation and terminology and interfaces are intentionally kept
// similar

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../lib/helpers/ReentrancyGuard.sol";

import "./Fees.sol";
import "./interfaces/IFlashLoanReceiver.sol";

abstract contract FlashLoanProvider is ReentrancyGuard, Fees {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    function flashLoan(
        IFlashLoanReceiver receiver,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes calldata receiverData
    ) external override nonReentrant {
        require(tokens.length == amounts.length, "Tokens and amounts length mismatch");

        uint256[] memory feeAmounts = new uint256[](tokens.length);
        uint256[] memory preLoanBalances = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];

            preLoanBalances[i] = token.balanceOf(address(this));
            require(preLoanBalances[i] >= amount, "Insufficient balance to borrow");

            feeAmounts[i] = _calculateProtocolFlashLoanFeeAmount(amount);

            token.safeTransfer(address(receiver), amount);
        }

        receiver.receiveFlashLoan(tokens, amounts, feeAmounts, receiverData);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            uint256 preLoanBalance = preLoanBalances[i];

            uint256 postLoanBalance = token.balanceOf(address(this));
            require(postLoanBalance >= preLoanBalance, "ERR_INVALID_POST_LOAN_BALANCE");

            uint256 receivedFees = postLoanBalance - preLoanBalance;
            require(receivedFees >= feeAmounts[i], "ERR_NOT_ENOUGH_COLLECTED_FEES");

            _increaseCollectedFees(token, receivedFees);
        }
    }
}
