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

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../lib/helpers/BalancerErrors.sol";
import "../lib/openzeppelin/ReentrancyGuard.sol";
import "../lib/openzeppelin/SafeERC20.sol";

import "./Fees.sol";
import "./interfaces/IFlashLoanReceiver.sol";

abstract contract FlashLoanProvider is Fees, ReentrancyGuard, EmergencyPeriod {
    using SafeERC20 for IERC20;

    function flashLoan(
        IFlashLoanReceiver receiver,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes memory receiverData
    ) external override nonReentrant noEmergencyPeriod {
        InputHelpers.ensureInputLengthMatch(tokens.length, amounts.length);

        uint256[] memory feeAmounts = new uint256[](tokens.length);
        uint256[] memory preLoanBalances = new uint256[](tokens.length);

        IERC20 previousToken = IERC20(0);
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];

            // Prevents duplicate tokens
            _require(token > previousToken, IERC20(0) == token ? Errors.ZERO_TOKEN : Errors.UNSORTED_TOKENS);
            previousToken = token;

            // Not checking amount against current balance, transfer will revert if it is exceeded
            preLoanBalances[i] = token.balanceOf(address(this));
            feeAmounts[i] = _calculateFlashLoanFee(amount);

            token.safeTransfer(address(receiver), amount);
        }

        receiver.receiveFlashLoan(tokens, amounts, feeAmounts, receiverData);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            uint256 preLoanBalance = preLoanBalances[i];

            uint256 postLoanBalance = token.balanceOf(address(this));
            _require(postLoanBalance >= preLoanBalance, Errors.INVALID_POST_LOAN_BALANCE);

            uint256 receivedFees = postLoanBalance - preLoanBalance;
            _require(receivedFees >= feeAmounts[i], Errors.INSUFFICIENT_COLLECTED_FEES);

            _payFee(token, receivedFees);
        }
    }
}
