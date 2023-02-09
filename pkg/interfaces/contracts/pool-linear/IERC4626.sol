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

/**
 * @title IERC4626, to support the yield-bearing token standard.
 * @notice Used for ERC4626-derived Linear Pools.
 * @dev There is another version of this in /solidity-utils/misc, used in standalone-utils tests.
 * This version has an additional `previewMint` function, and is used in tests of derived Linear Pools.
 */
interface IERC4626 {
    /**
     * @dev Mints `shares` Vault shares to `receiver` by depositing exactly `amount` of underlying tokens.
     */
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    /**
     * @dev Burns exactly `shares` from `owner` and sends `assets` of underlying tokens to `receiver`.
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256 assets);

    /**
     * @dev The address of the underlying token that the Vault uses for accounting, depositing, and withdrawing.
     */
    function asset() external view returns (address);

    /**
     * @dev Total amount of the underlying asset that is “managed” by Vault.
     */
    function totalAssets() external view returns (uint256);

    /**
     * @dev The amount of `assets` that the Vault would exchange for the amount
     *      of `shares` provided, in an ideal scenario where all the conditions are met.
     */
    function convertToAssets(uint256 shares) external view returns (uint256 assets);

    /**
     * @dev The amount of `shares` that the Vault would exchange for the amount
     *      of `assets` provided, in an ideal scenario where all the conditions are met.
     */
    function convertToShares(uint256 assets) external view returns (uint256 shares);

    /**
     * @dev Allows an on-chain or off-chain user to simulate the effects of their mint at the current block,
     * given current on-chain conditions. MUST return as close to and no fewer than the exact amount of assets that
     * would be deposited in a mint call in the same transaction. I.e. mint should return the same or fewer assets
     * as previewMint if called in the same transaction.
     */
    function previewMint(uint256 shares) external view returns (uint256 assets);
}
