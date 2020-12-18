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

// Needed for struct arguments
pragma experimental ABIEncoderV2;

// Imports

import "../math/FixedPoint.sol";
import "./IVault.sol";

// Contracts

// solhint-disable var-name-mixedcase

/**
 * @title Define and manage protocol-level fees
 * @author Balancer Labs
 * @notice Defines fees for vault withdrawals, swaps, and flash loans
 * @dev With User Balance "wallets", users can remove liquidity from pools and perform swaps without
 *      fees; withdrawal fees only apply to funds leaving the vault.
 */
abstract contract Settings is IVault {
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    // State variables

    // Stores the fee collected per each token that is only withdrawable by the admin.
    mapping(IERC20 => uint256) internal _collectedProtocolFees;

    //Fee collector entity to which protocol fees are sent when withdrawn.
    address private _protocolFeeCollector;

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

    // Function declarations

    // Public functions

    /**
     * @notice Getter for the protocol fee collector address
     * @return address of the fee collector account
     */
    function protocolFeeCollector() public view returns (address) {
        return _protocolFeeCollector;
    }

    /**
     * @notice Getter for the protocol withdrawal fee
     * @return amount of the fee
     */
    function protocolWithdrawFee() public view returns (uint128) {
        return _protocolWithdrawFee;
    }

    /**
     * @notice Getter for the protocol swap fee
     * @dev This fee is a percentage of the pool's swap fee (which can be zero)
     * @return amount of the fee
     */
    function protocolSwapFee() public view returns (uint128) {
        return _protocolSwapFee;
    }

    /**
     * @notice Getter for the protocol flash loan fee
     * @return amount of the fee
     */
    function protocolFlashLoanFee() public view returns (uint256) {
        return _protocolFlashLoanFee;
    }

    // Internal functions

    function _setProtocolFeeCollector(address feeCollector) internal {
        _protocolFeeCollector = feeCollector;
    }

    function _setProtocolWithdrawFee(uint128 newFee) internal {
        require(newFee <= _MAX_PROTOCOL_WITHDRAW_FEE, "Withdraw fee too high");
        _protocolWithdrawFee = newFee;
    }

    function _calculateProtocolWithdrawFee(uint128 amount) internal view returns (uint128) {
        return amount.mul128(_protocolWithdrawFee);
    }

    function _setProtocolSwapFee(uint128 newFee) internal {
        require(newFee <= _MAX_PROTOCOL_SWAP_FEE, "Swap fee too high");
        _protocolSwapFee = newFee;
    }

    function _calculateProtocolSwapFee(uint128 swapFeeAmount) internal view returns (uint128) {
        return swapFeeAmount.mul128(_protocolSwapFee);
    }

    function _setProtocolFlashLoanFee(uint256 newFee) internal {
        require(newFee <= _MAX_PROTOCOL_FLASH_LOAN_FEE, "FlashLoan fee too high");
        _protocolFlashLoanFee = newFee;
    }

    function _calculateProtocolFlashLoanFee(uint256 swapFeeAmount) internal view returns (uint256) {
        return swapFeeAmount.mul(_protocolFlashLoanFee);
    }
}
