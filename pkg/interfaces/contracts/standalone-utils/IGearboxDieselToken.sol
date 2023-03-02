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

interface IGearboxDieselToken is IERC20 {
    /**
     * @dev returns the address of the vault
     */
    function owner() external view returns (address);
}

interface IGearboxVault {
    /**
     * @dev returns the address of the underlying asset
     */
    function underlyingToken() external view returns (address);

    /**
     * @dev returns a 27 decimal fixed point 'ray' value so a rate of 1 is represented as 1e27
     */
    // solhint-disable-next-line func-name-mixedcase
    function getDieselRate_RAY() external view returns (uint256);

    /**
     * @dev converts diesel token amount to main token amount
     */
    function fromDiesel(uint256) external view returns (uint256);

    /**
     * @dev converts main token amount to diesel token amount
     */
    function toDiesel(uint256) external view returns (uint256);

    /**
     * @dev Adds liquidity to pool and sends diesel (LP) tokens back to the liquidity provider
     * The Referral code can be 0
     */
    function addLiquidity(
        uint256 underlyingAmount,
        address onBehalfOf,
        uint256 referralCode
    ) external;

    /**
     * @dev Removes liquidity from the pool and sends the underlying tokens to the `to` address
     */
    function removeLiquidity(uint256 dieselAmount, address to) external;
}
