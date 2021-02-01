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

pragma solidity ^0.7.1;

library Uint256Helpers {
    /**
     * @dev Tells if a uint256 can be downcasted to uint32.
     */
    function canCastToUint32(uint256 value) internal pure returns (bool) {
        return value < 2**32;
    }

    /**
     * @dev Tells if a uint256 can be downcasted to uint112.
     */
    function canCastToUint112(uint256 value) internal pure returns (bool) {
        return value < 2**112;
    }

    /**
     * @dev Converts an unsigned uint256 into a signed int256.
     */
    function toInt256(uint256 value) internal pure returns (int256) {
        require(value < 2**255, "ERR_CANNOT_CAST_TO_INT256");
        return int256(value);
    }
}
