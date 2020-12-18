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

// Imports

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./IFlashLoanReceiver.sol";
import "./Settings.sol";

import "../math/FixedPoint.sol";

// Contracts

/**
 * @title FlashLoanProvider - base contract for implementing flash loans
 * @author Balancer Labs
 */
abstract contract FlashLoanProvider is ReentrancyGuard, Settings {
    using FixedPoint for uint256;
    using SafeERC20 for IERC20;

    // Function declarations
    
    /**
     * @notice Borrow the specified funds from this contract, send them to the receiver, and add the flash loan fees to
     *         the total collected fees. After the call, check that the funds have been returned (including fees)
     * @param receiver - contract that receives funds and implements what the caller wants to accomplish with the loan
     * @param tokens - the tokens being borrowed
     * @param amounts - the amounts being borrowed
     * @param receiverData - any other data the flash loan receiver requires
     */
    function flashLoan(
        IFlashLoanReceiver receiver,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes calldata receiverData
    )
        external
        override
        nonReentrant 
    {   
        require(tokens.length == amounts.length, "Tokens and amounts length mismatch");

        uint256[] memory feeAmounts = new uint256[](tokens.length);
        uint256[] memory preLoanBalances = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            preLoanBalances[i] = tokens[i].balanceOf(address(this));
            require(preLoanBalances[i] >= amounts[i], "Insufficient balance to borrow");

            feeAmounts[i] = _calculateProtocolFlashLoanFee(amounts[i]);

            tokens[i].safeTransfer(address(receiver), amounts[i]);
        }

        receiver.receiveFlashLoan(tokens, amounts, feeAmounts, receiverData);

        for (uint256 i = 0; i < tokens.length; ++i) {
            uint256 postLoanBalance = tokens[i].balanceOf(address(this));

            uint256 receivedFees = postLoanBalance.sub(preLoanBalances[i]);
            require(receivedFees >= feeAmounts[i], "Insufficient protocol fees");

            _collectedProtocolFees[tokens[i]] = _collectedProtocolFees[tokens[i]].add(receivedFees);
        }
    }
}
