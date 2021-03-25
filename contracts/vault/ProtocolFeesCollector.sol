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

import "../lib/helpers/InputHelpers.sol";
import "../lib/helpers/Authentication.sol";
import "../lib/helpers/ReentrancyGuard.sol";
import "../lib/openzeppelin/SafeERC20.sol";

import "./interfaces/IVault.sol";
import "./interfaces/IAuthorizer.sol";

/**
 * @dev This an auxiliary contract to the Vault, deployed by it during construction. It offloads some of the tasks the
 * Vault performs to reduce its overall bytecode size.
 *
 * The current values for all protocol fee percentages are stored here, and any protocol fees charged in the form of
 * tokens are sent to this contract, where they may be withdrawn by authorized entities. All authorization tasks are
 * delegated to the Vault's own authorizer.
 */
contract ProtocolFeesCollector is Authentication, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Absolute maximum fee percentages (1e18 = 100%, 1e16 = 1%).
    uint256 private constant _MAX_PROTOCOL_SWAP_FEE = 50e16; // 50%
    uint256 private constant _MAX_PROTOCOL_WITHDRAW_FEE = 0.5e16; // 0.5%
    uint256 private constant _MAX_PROTOCOL_FLASH_LOAN_FEE = 1e16; // 1%

    IVault public immutable vault;

    // All fees are 18-decimal fixed point numbers.

    // The withdraw fee is charged whenever tokens exit the vault (except in the case of swaps), and is a
    // percentage of the tokens exiting.
    // There are two instances where this may happen: when a Pool is exited, and when Internal Balance is withdrawn. In
    // the case of exits, this fee can be avoided by depositing the funds into Internal Balance instead, from where they
    // might be used to e.g. join a different Pool.
    //
    // There is an exceptional case where withdraw fees are not charged: when the Vault's Internal Balance is used as a
    // temporary deposit of funds within a single block. This typically happens in a single transaction that uses
    // relayers: funds from different accounts may be deposited into Internal Balance, used to perform swaps, and then
    // withdrawn. This pattern is extremely gas efficient, and is not covered by withdraw fees because tokens were
    // deposited and withdrawn in the same block.
    //
    // The way this mechanism works is by tracking how many tokens were deposited in the current block, and storing
    // those as a 'fee exempt' balance. Internal Balance withdrawals then only charge fees for non-exempt balance.
    uint256 private _withdrawFee;

    // The swap fee is charged whenever a swap occurs, as a percentage of the fee charged by the Pool. These are not
    // actually charged on each individual swap: the `Vault` relies on the Pools being honest and reporting fees due
    // when users join and exit them.
    uint256 private _swapFee;

    // The flash loan fee is charged whenever a flash loan occurs, as a percentage of the tokens lent.
    uint256 private _flashLoanFee;

    event SwapFeeChanged(uint256 newSwapFee);
    event WithdrawFeeChanged(uint256 newWithdrawFee);
    event FlashLoanFeeChanged(uint256 newFlashLoanFee);

    constructor(IVault _vault) {
        vault = _vault;
    }

    function withdrawCollectedFees(
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        address recipient
    ) external authenticate nonReentrant {
        InputHelpers.ensureInputLengthMatch(tokens.length, amounts.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];
            token.safeTransfer(recipient, amount);
        }
    }

    function setSwapFee(uint256 newSwapFee) external authenticate {
        _require(newSwapFee <= _MAX_PROTOCOL_SWAP_FEE, Errors.SWAP_FEE_TOO_HIGH);
        _swapFee = newSwapFee;
        emit SwapFeeChanged(newSwapFee);
    }

    function setWithdrawFee(uint256 newWithdrawFee) external authenticate {
        _require(newWithdrawFee <= _MAX_PROTOCOL_WITHDRAW_FEE, Errors.WITHDRAW_FEE_TOO_HIGH);
        _withdrawFee = newWithdrawFee;
        emit WithdrawFeeChanged(newWithdrawFee);
    }

    function setFlashLoanFee(uint256 newFlashLoanFee) external authenticate {
        _require(newFlashLoanFee <= _MAX_PROTOCOL_FLASH_LOAN_FEE, Errors.FLASH_LOAN_FEE_TOO_HIGH);
        _flashLoanFee = newFlashLoanFee;
        emit FlashLoanFeeChanged(newFlashLoanFee);
    }

    function getSwapFee() external view returns (uint256) {
        return _swapFee;
    }

    function getWithdrawFee() external view returns (uint256) {
        return _withdrawFee;
    }

    function getFlashLoanFee() external view returns (uint256) {
        return _flashLoanFee;
    }

    function getCollectedFees(IERC20[] memory tokens) external view returns (uint256[] memory fees) {
        fees = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            fees[i] = tokens[i].balanceOf(address(this));
        }
    }

    function getAuthorizer() external view returns (IAuthorizer) {
        return _getAuthorizer();
    }

    function _canPerform(bytes32 roleId, address account) internal view override returns (bool) {
        return _getAuthorizer().hasRole(roleId, account);
    }

    function _getAuthorizer() internal view returns (IAuthorizer) {
        return vault.getAuthorizer();
    }
}
