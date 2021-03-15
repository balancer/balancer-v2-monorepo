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
import "../lib/math/FixedPoint.sol";
import "../lib/helpers/InputHelpers.sol";
import "../lib/helpers/ReentrancyGuard.sol";

import "./interfaces/IVault.sol";
import "./VaultAuthorization.sol";

abstract contract Fees is IVault, ReentrancyGuard, VaultAuthorization {
    using Math for uint256;
    using SafeERC20 for IERC20;

    // Stores the fee collected per each token that is only withdrawable by the admin.
    mapping(IERC20 => uint256) private _collectedProtocolFees;

    // All fixed are 18-decimal fixed point numbers.

    // The withdraw fee is charged whenever tokens exit the vault (except in the case of swaps), and is a
    // percentage of the tokens exiting.
    uint256 private _protocolWithdrawFee;

    // The swap fee is charged whenever a swap occurs, and is a percentage of the fee charged by the Pool. These are not
    // actually charged on each individual swap: the `Vault` relies on the Pools being honest and reporting due fees
    // when joined and exited.
    uint256 private _protocolSwapFee;

    // The flash loan fee is charged whenever a flash loan occurs, and is a percentage of the tokens lent.
    uint256 private _protocolFlashLoanFee;

    // Absolute maximum fee percentages (1e18 = 100%, 1e16 = 1%).
    uint256 private constant _MAX_PROTOCOL_SWAP_FEE = 50e16; // 50%
    uint256 private constant _MAX_PROTOCOL_WITHDRAW_FEE = 0.5e16; // 0.5%
    uint256 private constant _MAX_PROTOCOL_FLASH_LOAN_FEE = 1e16; // 1%

    function setProtocolFees(
        uint256 newSwapFee,
        uint256 newWithdrawFee,
        uint256 newFlashLoanFee
    ) external override nonReentrant authenticate {
        require(newSwapFee <= _MAX_PROTOCOL_SWAP_FEE, "SWAP_FEE_TOO_HIGH");
        require(newWithdrawFee <= _MAX_PROTOCOL_WITHDRAW_FEE, "WITHDRAW_FEE_TOO_HIGH");
        require(newFlashLoanFee <= _MAX_PROTOCOL_FLASH_LOAN_FEE, "FLASH_LOAN_FEE_TOO_HIGH");

        _protocolSwapFee = newSwapFee;
        _protocolWithdrawFee = newWithdrawFee;
        _protocolFlashLoanFee = newFlashLoanFee;
    }

    function getProtocolFees()
        external
        view
        override
        returns (
            uint256 swapFee,
            uint256 withdrawFee,
            uint256 flashLoanFee
        )
    {
        return (_protocolSwapFee, _protocolWithdrawFee, _protocolFlashLoanFee);
    }

    /**
     * @dev Returns the protocol swap fee percentage.
     */
    function _getProtocolSwapFee() internal view returns (uint256) {
        return _protocolSwapFee;
    }

    /**
     * @dev Returns the protocol fee to charge for a withdrawal of `amount`.
     */
    function _calculateProtocolWithdrawFeeAmount(uint256 amount) internal view returns (uint256) {
        // Fixed point multiplication introduces error: we round up, which means in certain scenarios the charged
        // percentage can be slightly higher than intended.
        return FixedPoint.mulUp(amount, _protocolWithdrawFee);
    }

    /**
     * @dev Returns the protocol fee to charge for a flash loan of `amount`.
     */
    function _calculateProtocolFlashLoanFeeAmount(uint256 amount) internal view returns (uint256) {
        // Fixed point multiplication introduces error: we round up, which means in certain scenarios the charged
        // percentage can be slightly higher than intended.
        return FixedPoint.mulUp(amount, _protocolFlashLoanFee);
    }

    function getCollectedFees(IERC20[] memory tokens) external view override returns (uint256[] memory) {
        return _getCollectedFees(tokens);
    }

    function withdrawCollectedFees(
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        address recipient
    ) external override nonReentrant authenticate {
        InputHelpers.ensureInputLengthMatch(tokens.length, amounts.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];
            _decreaseCollectedFees(token, amount);
            token.safeTransfer(recipient, amount);
        }
    }

    /**
     * @dev Increases the number of collected protocol fees for `token` by `amount`.
     */
    function _increaseCollectedFees(IERC20 token, uint256 amount) internal {
        uint256 currentCollectedFees = _collectedProtocolFees[token];
        uint256 newTotal = currentCollectedFees.add(amount);
        _setCollectedFees(token, newTotal);
    }

    /**
     * @dev Decreases the number of collected protocol fees for `token` by `amount`.
     */
    function _decreaseCollectedFees(IERC20 token, uint256 amount) internal {
        uint256 currentCollectedFees = _collectedProtocolFees[token];
        require(currentCollectedFees >= amount, "INSUFFICIENT_COLLECTED_FEES");

        uint256 newTotal = currentCollectedFees - amount;
        _setCollectedFees(token, newTotal);
    }

    /**
     * @dev Sets the number of collected protocol fees for `token` to `newTotal`.
     *
     * This costs less gas than `_increaseCollectedFees` or `_decreaseCollectedFees`, since the current collected fees
     * do not need to be read.
     */
    function _setCollectedFees(IERC20 token, uint256 newTotal) internal {
        _collectedProtocolFees[token] = newTotal;
    }

    /**
     * @dev Returns the number of collected fees for each token in the `tokens` array.
     */
    function _getCollectedFees(IERC20[] memory tokens) internal view returns (uint256[] memory fees) {
        fees = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            fees[i] = _collectedProtocolFees[tokens[i]];
        }
    }
}
