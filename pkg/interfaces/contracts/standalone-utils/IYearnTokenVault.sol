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

import "../solidity-utils/openzeppelin/IERC20.sol";

interface IYearnTokenVault is IERC20 {
    /**
     * @dev returns the address of the vault's underlying asset (mainToken)
     */
    function token() external view returns (address);

    /**
     * @dev returns the price for a single Vault share (ie yvDAI). The pricePerShare is represented
     * in the same decimals as the underlying asset (ie: 6 decimals for USDC)
     */
    function pricePerShare() external view returns (uint256);

    /**
     * @notice Deposits `_amount` `token`, issuing shares to `recipient`.
     * If the Vault is in Emergency Shutdown, deposits will not be accepted and this call will fail.
     * @param _amount The quantity of tokens to deposit, defaults to all.
     * @param recipient The address to issue the shares in this Vault to. Defaults to the caller's address.
     * @return The issued Vault shares.
     */
    function deposit(uint256 _amount, address recipient) external returns (uint256);

    /**
     * @notice Withdraws the calling account's tokens from this Vault,
     * redeeming amount `_shares` for an appropriate amount of tokens.
     * See note on `setWithdrawalQueue` for further details of withdrawal ordering and behavior.
     * @param maxShares How many shares to try and redeem for tokens, defaults to all.
     * @param recipient The address to issue the shares in this Vault to. Defaults to the caller's address.
     * @return redeemed: The quantity of tokens redeemed for `_shares`.
     */
    function withdraw(uint256 maxShares, address recipient) external returns (uint256);
}
