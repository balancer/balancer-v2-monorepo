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
pragma experimental ABIEncoderV2;

import "./IBasePoolFactory.sol";

interface ILastCreatedPoolFactory is IBasePoolFactory {
    /**
     * @dev Returns the address of the last Pool created by this factory.
     *
     * This is typically only useful in complex Pool deployment schemes, where multiple subsystems need to know about
     * each other. Note that this value will only be updated once construction of the last created Pool finishes.
     */
    function getLastCreatedPool() external view returns (address);
}
