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

import "../openzeppelin/IERC20.sol";

interface IERC4626 is IERC20 {
    /**
     * @dev `sender` has exchanged `assets` for `shares`, and transferred those `shares` to `receiver`.
     */
    event Deposit(address indexed sender, address indexed receiver, uint256 assets, uint256 shares);

    /**
     * @dev `sender` has exchanged `shares` for `assets`, and transferred those `assets` to `receiver`.
     */
    event Withdraw(address indexed sender, address indexed receiver, uint256 assets, uint256 shares);

    /**
     * @dev Mints `shares` Vault shares to `receiver` by depositing exactly `amount` of underlying tokens.
     */
    function deposit(uint256 assets, address receiver) external returns (uint256);

    /**
     * @dev Redeems `shares` from `owner` and sends `assets` of underlying tokens to `receiver`.
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256);

    /**
     * @dev The address of the underlying token that the Vault uses for accounting, depositing, and withdrawing.
     */
    function asset() external view returns (address);

    /**
     * @dev Total amount of the underlying asset that is “managed” by Vault
     **/
    function totalAssets() external view returns (uint256);
}
