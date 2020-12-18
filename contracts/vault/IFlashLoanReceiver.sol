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

// Inspired by Aave Protocol's IFlashLoanReceiver

// Imports

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Interfaces

/**
 * @title Interface for receiving flash loans
 * @author Balancer Labs
 */
interface IFlashLoanReceiver {
    /**
     * @notice Contracts implementing flash loans must override this function
     * @param tokens - the tokens being borrowed
     * @param amounts - the amount of each token
     * @param feeAmounts - fees charged by the protocol (must return funds + fees)
     * @param receiverData - any extra data required by the loan contract
     */
    function receiveFlashLoan(
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        uint256[] calldata feeAmounts,
        bytes calldata receiverData
    ) external;
}
