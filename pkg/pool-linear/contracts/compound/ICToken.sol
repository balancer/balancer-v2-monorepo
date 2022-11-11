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

pragma solidity >=0.5.0 <0.9.0;

interface ICToken {
    /**
     * @dev returns the address of the cToken's underlying asset
     */
    function underlying() external view returns (address);

    /**
     * @dev Adds the tokens to compounds liquidity pool. Get back wrapped token in exchange
     */
    function mint(uint256) external returns (uint256);

    /**
     * @dev Withdraws unwrapped tokens from compounds liquidity pool in exchange for wrapped token
     */
    function redeem(uint) external returns (uint);

    /**
     * @dev Gets the current exchange rate
     */
    function exchangeRateStored() external view returns (uint256);
}



