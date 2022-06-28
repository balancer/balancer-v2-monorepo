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

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

/**
 * @dev Library for compressing and decompressing numbers by using smaller types.
 * All values are 18 decimal fixed-point numbers, so heavier compression (fewer bits)
 * results in fewer decimals.
 */
library WeightCompression {
    using FixedPoint for uint256;

    /**
     * @dev Compress a 256 bit value into `bitLength` bits.
     * To compress a value down to n bits, you first "normalize" it over the full input range.
     * For instance, if the maximum value were 10_000, and the `value` is 2_000, it would be
     * normalized to 0.2.
     *
     * Finally, "scale" that normalized value into the output range: adapting [0, maxUncompressedValue]
     * to [0, max n-bit value]. For n=8 bits, the max value is 255, so 0.2 corresponds to 51.
     * Likewise, for 16 bits, 0.2 would be stored as 13_107.
     */
    function compress(
        uint256 value,
        uint256 bitLength,
        uint256 maxUncompressedValue
    ) internal pure returns (uint256) {
        // It's not meaningful to compress 1-bit values (2 bits is also a bit silly, but theoretically possible).
        // 255 would likewise not be very helpful, but is technically valid.
        _require(bitLength >= 2 && bitLength <= 255, Errors.OUT_OF_BOUNDS);
        // The value cannot exceed the input range, or the compression would not "fit" in the output range.
        _require(value <= maxUncompressedValue, Errors.OUT_OF_BOUNDS);

        // There is another way this can fail: maxUncompressedValue * value can overflow, if either or both
        // are too big. Essentially, the maximum bitLength will be about 256 - (# bits needed for maxUncompressedValue).
        // It's not worth it to test for this: the caller is responsible for many things anyway, notably ensuring
        // compress and decompress are called with the same arguments, and packing the resulting value properly
        // (the most common use is to assist in packing several variables into a 256-bit word).

        uint256 maxCompressedValue = (1 << bitLength) - 1;

        return value.mulDown(maxCompressedValue).divDown(maxUncompressedValue);
    }

    /**
     * @dev Reverse a compression operation, and restore the 256 bit value from a compressed value of
     * length `bitLength`. The compressed value is in the range [0, 2^(bitLength) - 1], and we are mapping
     * it back onto the uncompressed range [0, maxUncompressedValue].
     *
     * It is very important that the bitLength and maxUncompressedValue arguments are the
     * same for compress and decompress, or the results will be meaningless. This must be validated
     * externally.
     */
    function decompress(
        uint256 value,
        uint256 bitLength,
        uint256 maxUncompressedValue
    ) internal pure returns (uint256) {
        // It's not meaningful to compress 1-bit values (2 bits is also a bit silly, but theoretically possible).
        // 255 would likewise not be very helpful, but is technically valid.
        _require(bitLength >= 2 && bitLength <= 255, Errors.OUT_OF_BOUNDS);
        uint256 maxCompressedValue = (1 << bitLength) - 1;
        // The value must not exceed the maximum compressed value (2**(bitLength) - 1), or it will exceed the max
        // uncompressed value.
        _require(value <= maxCompressedValue, Errors.OUT_OF_BOUNDS);

        return value.mulUp(maxUncompressedValue).divDown(maxCompressedValue);
    }

    // Special case overloads

    /**
     * @dev It is very common for the maximum value to be one: Weighted Pool weights, for example.
     * Overload for this common case, passing FixedPoint.ONE to the general `compress` function.
     */
    function compress(uint256 value, uint256 bitLength) internal pure returns (uint256) {
        return compress(value, bitLength, FixedPoint.ONE);
    }

    /**
     * @dev It is very common for the maximum value to be one: Weighted Pool weights, for example.
     * Overload for this common case, passing FixedPoint.ONE to the general `decompress` function.
     */
    function decompress(uint256 value, uint256 bitLength) internal pure returns (uint256) {
        return decompress(value, bitLength, FixedPoint.ONE);
    }
}
