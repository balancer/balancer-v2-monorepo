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
pragma experimental ABIEncoderV2;

import { Test } from "forge-std/Test.sol";

import "../../contracts/lib/ValueCompression.sol";

contract ValueCompressionTest is Test {
    /**
     * @notice Finds the zero-based index of the first one in the binary representation of x.
     * @dev See the note on msb in the "Find First Set" Wikipedia article https://en.wikipedia.org/wiki/Find_first_set
     * @param x The uint256 number for which to find the index of the most significant bit.
     * @return msb The index of the most significant bit as an uint256.
     */
    function mostSignificantBit(uint256 x) private pure returns (uint256 msb) {
        if (x >= 2**128) {
            x >>= 128;
            msb += 128;
        }
        if (x >= 2**64) {
            x >>= 64;
            msb += 64;
        }
        if (x >= 2**32) {
            x >>= 32;
            msb += 32;
        }
        if (x >= 2**16) {
            x >>= 16;
            msb += 16;
        }
        if (x >= 2**8) {
            x >>= 8;
            msb += 8;
        }
        if (x >= 2**4) {
            x >>= 4;
            msb += 4;
        }
        if (x >= 2**2) {
            x >>= 2;
            msb += 2;
        }
        if (x >= 2**1) {
            // No need to shift x any more.
            msb += 1;
        }
    }

    function testCompression(
        uint256 value,
        uint8 bitLength,
        uint256 maxUncompressedValue
    ) external {
        maxUncompressedValue = bound(maxUncompressedValue, 1, type(uint256).max);
        value = bound(value, 0, maxUncompressedValue);
        bitLength = uint8(bound(bitLength, uint256(2), 255));

        // Prevent internal overflows
        vm.assume(bitLength < 256 - mostSignificantBit(maxUncompressedValue));

        uint256 reconstructedValue = ValueCompression.decompress(
            ValueCompression.compress(value, bitLength, maxUncompressedValue),
            bitLength,
            maxUncompressedValue
        );
        assertApproxEqAbs(
            reconstructedValue,
            value,
            ValueCompression.maxCompressionError(bitLength, maxUncompressedValue)
        );
    }
}
