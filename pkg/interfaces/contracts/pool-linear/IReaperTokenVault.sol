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

pragma solidity >=0.7.0 <0.9.0;

import "../solidity-utils/openzeppelin/IERC20.sol";

// Source: https://github.com/Byte-Masons/beet-strat/blob/master/contracts/ReaperVaultv1_4.sol
// Interface definition for the ReaperTokenVault contract, a single strategy vault
// for Reaper Farm crypts. The pricePerFullShare is always represented with 18 decimals,
// regardless of the underlying token decimals.
// ie: If ppfs === 1e18, 1 USDC === 0.000_000_000_001_000_000 rfUSDC
// ie: If ppfs === 1e18, 1 DAI === 1 rfDAI
interface IReaperTokenVault is IERC20 {
    /**
     * @dev returns the address of the vault's underlying asset (mainToken)
     */
    function token() external view returns (address);

    /**
     * @dev returns the price for a single Vault share (ie rf-scfUSDT). The getPricePerFullShare is always in 1e18
     */
    function getPricePerFullShare() external view returns (uint256);

    /**
     * @notice Deposits `_amount` `token`, issuing shares to the caller.
     * If Panic is activated, deposits will not be accepted and this call will fail.
     * @param _amount The quantity of tokens to deposit.
     **/
    function deposit(uint256 _amount) external;

    /**
     * @notice Withdraws the calling account's tokens from this Vault,
     * redeeming amount `_shares` for an appropriate amount of tokens.
     **/
    function withdraw(uint256 _shares) external;

    /**
     * @dev returns the number of decimals for this vault token.
     * For reaper single-strat vaults, the decimals are fixed to 18.
     */
    function decimals() external view returns (uint8);
}
