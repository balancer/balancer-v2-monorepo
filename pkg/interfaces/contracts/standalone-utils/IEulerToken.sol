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

interface IEulerToken is IERC20 {
    /**
     * @dev Convert an eToken balance to an underlying amount, taking into account current exchange rate
     * @param balance eToken balance, in internal book-keeping units (18 decimals)
     * @return Amount in underlying units, (same decimals as underlying token)
     */
    // https://github.com/euler-xyz/euler-contracts/blob/b1ee3265853628d5a529081d7908c38404201b4e/contracts/modules/EToken.sol#L104
    // solhint-disable-previous-line max-line-length
    function convertBalanceToUnderlying(uint256 balance) external view returns (uint256);

    /**
     * @dev Convert an underlying amount to an eToken balance, taking into account current exchange rate
     * @param underlyingAmount Amount in underlying units (same decimals as underlying token)
     * @return eToken balance, in internal book-keeping units (18 decimals)
     */
    // https://github.com/euler-xyz/euler-contracts/blob/b1ee3265853628d5a529081d7908c38404201b4e/contracts/modules/EToken.sol#L114
    // solhint-disable-previous-line max-line-length
    function convertUnderlyingToBalance(uint256 underlyingAmount) external view returns (uint256);

    /**
     * @dev Transfer underlying tokens from sender to the Euler pool, and increase account's eTokens
     */
    function deposit(uint256 subAccountId, uint256 amount) external;

    /**
     * @dev Transfer underlying tokens from Euler pool to sender, and decrease account's eTokens
     */
    function withdraw(uint256 subAccountId, uint256 amount) external;

    /**
     * @dev Address of underlying asset
     */
    function underlyingAsset() external view returns (address);
}
