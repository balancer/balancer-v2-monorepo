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

import "../lib/WeightCompression.sol";

contract MockWeightCompression {
    function fullCompress(
        uint256 value,
        uint256 bitLength,
        uint256 maxUncompressedValue
    ) external pure returns (uint256) {
        return WeightCompression.compress(value, bitLength, maxUncompressedValue);
    }

    // Reverse a compression operation (normalized to a given value).
    function fullDecompress(
        uint256 value,
        uint256 bitLength,
        uint256 maxUncompressedValue
    ) external pure returns (uint256) {
        return WeightCompression.decompress(value, bitLength, maxUncompressedValue);
    }

    // If no normalization value is given, assume it is 1.
    function compress(uint256 value, uint256 bitLength) external pure returns (uint256) {
        return WeightCompression.compress(value, bitLength);
    }

    // Reverse a compression operation (normalized to 1).
    function decompress(uint256 value, uint256 bitLength) external pure returns (uint256) {
        return WeightCompression.decompress(value, bitLength);
    }
}
