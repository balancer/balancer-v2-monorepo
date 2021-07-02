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

import "../math/LogExpMath.sol";

/**
 * @dev Library for encoding and decoding values stored inside a 256 bit word. Typically used to pack multiple values in
 * a single storage slot, saving gas by performing less storage accesses.
 *
 * Each value is defined by its size and the least significant bit in the word, also known as offset. For example, two
 * 128 bit values may be encoded in a word by assigning one an offset of 0, and the other an offset of 128.
 */
library LogCompression {
    int256 private constant _LOG_COMPRESSION_FACTOR = 1e14;
    int256 private constant _HALF_LOG_COMPRESSION_FACTOR = 0.5e14;

    /**
     * @dev Returns the natural logarithm of `value`, dropping most of the decimal places to arrive at a value that,
     * when passed to `fromLowResLog`, will have a maximum relative error of ~0.05% compared to `value`.
     *
     * Values returned from this function should not be mixed with other fixed-point values (as they have a different
     * number of digits), but can be added or subtracted. Use `fromLowResLog` to undo this process and return to an
     * 18 decimal places fixed point value.
     *
     * Because so much precision is lost, the logarithmic values can be stored using much fewer bits than the original
     * value required.
     */
    function toLowResLog(uint256 value) internal pure returns (int256) {
        int256 ln = LogExpMath.ln(int256(value));

        // Rounding division for signed numerator
        int256 lnWithError = (ln > 0 ? ln + _HALF_LOG_COMPRESSION_FACTOR : ln - _HALF_LOG_COMPRESSION_FACTOR);
        return lnWithError / _LOG_COMPRESSION_FACTOR;
    }

    /**
     * @dev Restores `value` from logarithmic space. `value` is expected to be the result of a call to `toLowResLog`,
     * any other function that returns 4 decimals fixed point logarithms, or the sum of such values.
     */
    function fromLowResLog(int256 value) internal pure returns (uint256) {
        return uint256(LogExpMath.exp(value * _LOG_COMPRESSION_FACTOR));
    }
}
