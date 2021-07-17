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

/**
 * @dev Library for encoding and decoding values stored inside a 256 bit word. Typically used to pack multiple values in
 * a single storage slot, saving gas by performing less storage accesses.
 *
 * Each value is defined by its size and the least significant bit in the word, also known as offset. For example, two
 * 128 bit values may be encoded in a word by assigning one an offset of 0, and the other an offset of 128.
 */
library WordCodec {
    // Masks are values with the least significant N bits set. They can be used to extract an encoded value from a word,
    // or to insert a new one replacing the old.
    uint256 private constant _MASK_1 = 2**(1) - 1;
    uint256 private constant _MASK_10 = 2**(10) - 1;
    uint256 private constant _MASK_16 = 2**(16) - 1;
    uint256 private constant _MASK_22 = 2**(22) - 1;
    uint256 private constant _MASK_31 = 2**(31) - 1;
    uint256 private constant _MASK_32 = 2**(32) - 1;
    uint256 private constant _MASK_53 = 2**(53) - 1;
    uint256 private constant _MASK_64 = 2**(64) - 1;
    uint256 private constant _MASK_128 = 2**(128) - 1;
    uint256 private constant _MASK_192 = 2**(192) - 1;

    // Largest positive values that can be represented as N bits signed integers.
    int256 private constant _MAX_INT_22 = 2**(21) - 1;
    int256 private constant _MAX_INT_53 = 2**(52) - 1;

    // In-place insertion

    /**
     * @dev Inserts a boolean value shifted by an offset into a 256 bit word, replacing the old value. Returns the new
     * word.
     */
    function insertBoolean(
        bytes32 word,
        bool value,
        uint256 offset
    ) internal pure returns (bytes32) {
        bytes32 clearedWord = bytes32(uint256(word) & ~(_MASK_1 << offset));
        return clearedWord | bytes32(uint256(value ? 1 : 0) << offset);
    }

    // Unsigned

    /**
     * @dev Inserts a 10 bit unsigned integer shifted by an offset into a 256 bit word, replacing the old value. Returns
     * the new word.
     *
     * Assumes `value` only uses its least significant 10 bits, otherwise it may overwrite sibling bytes.
     */
    function insertUint10(
        bytes32 word,
        uint256 value,
        uint256 offset
    ) internal pure returns (bytes32) {
        bytes32 clearedWord = bytes32(uint256(word) & ~(_MASK_10 << offset));
        return clearedWord | bytes32(value << offset);
    }

    /**
     * @dev Inserts a 16 bit unsigned integer shifted by an offset into a 256 bit word, replacing the old value.
     * Returns the new word.
     *
     * Assumes `value` only uses its least significant 16 bits, otherwise it may overwrite sibling bytes.
     */
    function insertUint16(
        bytes32 word,
        uint256 value,
        uint256 offset
    ) internal pure returns (bytes32) {
        bytes32 clearedWord = bytes32(uint256(word) & ~(_MASK_16 << offset));
        return clearedWord | bytes32(value << offset);
    }

    /**
     * @dev Inserts a 31 bit unsigned integer shifted by an offset into a 256 bit word, replacing the old value. Returns
     * the new word.
     *
     * Assumes `value` can be represented using 31 bits.
     */
    function insertUint31(
        bytes32 word,
        uint256 value,
        uint256 offset
    ) internal pure returns (bytes32) {
        bytes32 clearedWord = bytes32(uint256(word) & ~(_MASK_31 << offset));
        return clearedWord | bytes32(value << offset);
    }

    /**
     * @dev Inserts a 32 bit unsigned integer shifted by an offset into a 256 bit word, replacing the old value. Returns
     * the new word.
     *
     * Assumes `value` only uses its least significant 32 bits, otherwise it may overwrite sibling bytes.
     */
    function insertUint32(
        bytes32 word,
        uint256 value,
        uint256 offset
    ) internal pure returns (bytes32) {
        bytes32 clearedWord = bytes32(uint256(word) & ~(_MASK_32 << offset));
        return clearedWord | bytes32(value << offset);
    }

    /**
     * @dev Inserts a 64 bit unsigned integer shifted by an offset into a 256 bit word, replacing the old value. Returns
     * the new word.
     *
     * Assumes `value` only uses its least significant 64 bits, otherwise it may overwrite sibling bytes.
     */
    function insertUint64(
        bytes32 word,
        uint256 value,
        uint256 offset
    ) internal pure returns (bytes32) {
        bytes32 clearedWord = bytes32(uint256(word) & ~(_MASK_64 << offset));
        return clearedWord | bytes32(value << offset);
    }

    // Signed

    /**
     * @dev Inserts a 22 bits signed integer shifted by an offset into a 256 bit word, replacing the old value. Returns
     * the new word.
     *
     * Assumes `value` can be represented using 22 bits.
     */
    function insertInt22(
        bytes32 word,
        int256 value,
        uint256 offset
    ) internal pure returns (bytes32) {
        bytes32 clearedWord = bytes32(uint256(word) & ~(_MASK_22 << offset));
        // Integer values need masking to remove the upper bits of negative values.
        return clearedWord | bytes32((uint256(value) & _MASK_22) << offset);
    }

    // Bytes

    /**
     * @dev Inserts 192 bit shifted by an offset into a 256 bit word, replacing the old value. Returns the new word.
     *
     * Assumes `value` can be represented using 192 bits.
     */
    function insertBits192(
        bytes32 word,
        bytes32 value,
        uint256 offset
    ) internal pure returns (bytes32) {
        bytes32 clearedWord = bytes32(uint256(word) & ~(_MASK_192 << offset));
        return clearedWord | bytes32((uint256(value) & _MASK_192) << offset);
    }

    // Encoding

    // Unsigned

    /**
     * @dev Encodes an unsigned integer shifted by an offset. This performs no size checks: it is up to the caller to
     * ensure that the values are bounded.
     *
     * The return value can be logically ORed with other encoded values to form a 256 bit word.
     */
    function encodeUint(uint256 value, uint256 offset) internal pure returns (bytes32) {
        return bytes32(value << offset);
    }

    // Signed

    /**
     * @dev Encodes a 22 bits signed integer shifted by an offset.
     *
     * The return value can be logically ORed with other encoded values to form a 256 bit word.
     */
    function encodeInt22(int256 value, uint256 offset) internal pure returns (bytes32) {
        // Integer values need masking to remove the upper bits of negative values.
        return bytes32((uint256(value) & _MASK_22) << offset);
    }

    /**
     * @dev Encodes a 53 bits signed integer shifted by an offset.
     *
     * The return value can be logically ORed with other encoded values to form a 256 bit word.
     */
    function encodeInt53(int256 value, uint256 offset) internal pure returns (bytes32) {
        // Integer values need masking to remove the upper bits of negative values.
        return bytes32((uint256(value) & _MASK_53) << offset);
    }

    // Decoding

    /**
     * @dev Decodes and returns a boolean shifted by an offset from a 256 bit word.
     */
    function decodeBool(bytes32 word, uint256 offset) internal pure returns (bool) {
        return (uint256(word >> offset) & _MASK_1) == 1;
    }

    // Unsigned

    /**
     * @dev Decodes and returns a 10 bit unsigned integer shifted by an offset from a 256 bit word.
     */
    function decodeUint10(bytes32 word, uint256 offset) internal pure returns (uint256) {
        return uint256(word >> offset) & _MASK_10;
    }

    /**
     * @dev Decodes and returns a 16 bit unsigned integer shifted by an offset from a 256 bit word.
     */
    function decodeUint16(bytes32 word, uint256 offset) internal pure returns (uint256) {
        return uint256(word >> offset) & _MASK_16;
    }

    /**
     * @dev Decodes and returns a 31 bit unsigned integer shifted by an offset from a 256 bit word.
     */
    function decodeUint31(bytes32 word, uint256 offset) internal pure returns (uint256) {
        return uint256(word >> offset) & _MASK_31;
    }

    /**
     * @dev Decodes and returns a 32 bit unsigned integer shifted by an offset from a 256 bit word.
     */
    function decodeUint32(bytes32 word, uint256 offset) internal pure returns (uint256) {
        return uint256(word >> offset) & _MASK_32;
    }

    /**
     * @dev Decodes and returns a 64 bit unsigned integer shifted by an offset from a 256 bit word.
     */
    function decodeUint64(bytes32 word, uint256 offset) internal pure returns (uint256) {
        return uint256(word >> offset) & _MASK_64;
    }

    /**
     * @dev Decodes and returns a 128 bit unsigned integer shifted by an offset from a 256 bit word.
     */
    function decodeUint128(bytes32 word, uint256 offset) internal pure returns (uint256) {
        return uint256(word >> offset) & _MASK_128;
    }

    // Signed

    /**
     * @dev Decodes and returns a 22 bits signed integer shifted by an offset from a 256 bit word.
     */
    function decodeInt22(bytes32 word, uint256 offset) internal pure returns (int256) {
        int256 value = int256(uint256(word >> offset) & _MASK_22);
        // In case the decoded value is greater than the max positive integer that can be represented with 22 bits,
        // we know it was originally a negative integer. Therefore, we mask it to restore the sign in the 256 bit
        // representation.
        return value > _MAX_INT_22 ? (value | int256(~_MASK_22)) : value;
    }

    /**
     * @dev Decodes and returns a 53 bits signed integer shifted by an offset from a 256 bit word.
     */
    function decodeInt53(bytes32 word, uint256 offset) internal pure returns (int256) {
        int256 value = int256(uint256(word >> offset) & _MASK_53);
        // In case the decoded value is greater than the max positive integer that can be represented with 53 bits,
        // we know it was originally a negative integer. Therefore, we mask it to restore the sign in the 256 bit
        // representation.

        return value > _MAX_INT_53 ? (value | int256(~_MASK_53)) : value;
    }
}
