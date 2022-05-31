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
 * All values are 18 decimal fixed-point numbers in the [0.0, 1.0] range,
 * so heavier compression (fewer bits) results in fewer decimals.
 */
library WeightCompression {
    using FixedPoint for uint256;

    // If no normalization value is given, assume it is 1.
    function compress(uint256 value, uint256 bitLength) internal pure returns (uint256) {
        return compress(value, bitLength, FixedPoint.ONE);
    }

    // If a normalization factor is given (e.g., 10_000), normalize against that.
    function compress(
        uint256 value,
        uint256 bitLength,
        uint256 normalizedTo
    ) internal pure returns (uint256) {
        uint256 maxValue = (1 << bitLength) - 1;

        return value.mulUp(maxValue).divUp(normalizedTo);
    }

    // Reverse a compression operation (normalized to 1).
    function decompress(uint256 value, uint256 bitLength) internal pure returns (uint256) {
        return decompress(value, bitLength, FixedPoint.ONE);
    }

    // Reverse a compression operation (normalized to a given value).
    function decompress(
        uint256 value,
        uint256 bitLength,
        uint256 normalizedTo
    ) internal pure returns (uint256) {
        uint256 maxValue = (1 << bitLength) - 1;

        return value.mulUp(normalizedTo).divUp(maxValue);
    }
}
