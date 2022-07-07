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

import "./ILendingPool.sol";

interface IStaticAToken {
    /**
     * @dev returns the address of the staticAToken's underlying asset
     */
    // solhint-disable-next-line func-name-mixedcase
    function ASSET() external view returns (address);

    /**
     * @dev returns the address of the staticAToken's lending pool
     */
    // solhint-disable-next-line func-name-mixedcase
    function LENDING_POOL() external view returns (ILendingPool);

    /**
     * @dev returns a 27 decimal fixed point 'ray' value so a rate of 1 is represented as 1e27
     */
    function rate() external view returns (uint256);
}
