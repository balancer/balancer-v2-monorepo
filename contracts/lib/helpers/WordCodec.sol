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

library WordCodec {
    int256 private constant _MASK_20 = 2**(20) - 1;
    int256 private constant _MASK_54 = 2**(54) - 1;
    uint256 private constant _MASK_32 = 2**(32) - 1;

    int256 private constant _MAX_INT_20 = 2**(19) - 1;
    int256 private constant _MAX_INT_54 = 2**(53) - 1;

    /**
     * @dev Decodes a 32-bits unsigned integer from a word discarding a number of least-significant bits.
     */
    function decodeUint32(bytes32 data, uint256 discard) internal pure returns (uint256) {
        return uint256(data >> discard) & _MASK_32;
    }

    /**
     * @dev Decodes a 20-bits signed integer from a word discarding a number of least-significant bits.
     */
    function decodeInt20(bytes32 data, uint256 discard) internal pure returns (int256) {
        int256 value = int256(data >> discard) & _MASK_20;
        // In case the decoded value is greater than the max positive integer that can be represented with 20 bits,
        // we know it was originally a negative integer. Therefore, we mask it to restore the sign in the 256 bits
        // representation.
        return value > _MAX_INT_20 ? (value | ~_MASK_20) : value;
    }

    /**
     * @dev Decodes a 54-bits signed integer from a word discarding a number of least-significant bits.
     */
    function decodeInt54(bytes32 data, uint256 discard) internal pure returns (int256) {
        int256 value = int256(data >> discard) & _MASK_54;
        // In case the decoded value is greater than the max positive integer that can be represented with 54 bits,
        // we know it was originally a negative integer. Therefore, we mask it to restore the sign in the 256 bits
        // representation.
        return value > _MAX_INT_54 ? (value | ~_MASK_54) : value;
    }
}
