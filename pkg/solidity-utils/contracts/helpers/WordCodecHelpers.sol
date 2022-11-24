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

library WordCodecHelpers {
    function clearWordAtPosition(
        bytes32 word,
        uint256 offset,
        uint256 bitLength
    ) internal pure returns (bytes32 clearedWord) {
        uint256 mask = (1 << bitLength) - 1;
        clearedWord = bytes32(uint256(word) & ~(mask << offset));
    }

    function isOtherStateUnchanged(
        bytes32 oldPoolState,
        bytes32 newPoolState,
        uint256 offset,
        uint256 bitLength
    ) internal pure returns (bool) {
        bytes32 clearedOldState = clearWordAtPosition(oldPoolState, offset, bitLength);
        bytes32 clearedNewState = clearWordAtPosition(newPoolState, offset, bitLength);

        return clearedNewState == clearedOldState;
    }
}
