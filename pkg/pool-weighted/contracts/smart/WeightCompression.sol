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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

/**
 * @dev Library for encoding and decoding values of different bit-lengths stored inside a 256 bit word.
 */
library WeightCompression {
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    /**
     * @dev Read a value from a 16-bit slot at the given offset and convert to full FixedPoint
     */
    function uncompress16(bytes32 word, uint256 offset) internal pure returns (uint256) {
        return word.decodeUint16(offset).mulUp(FixedPoint.ONE).divUp(type(uint16).max);
    }

    /**
     * @dev Compress a FisedPoint value to 16 bits, and write to a slot at the given offset
     */
    function compress16(
        bytes32 word,
        uint256 value,
        uint256 offset
    ) internal pure returns (bytes32) {
        return word.insertUint16(value.mulUp(type(uint16).max).divUp(FixedPoint.ONE), offset);
    }

    /**
     * @dev Read a value from a 32-bit slot at the given offset and convert to full FixedPoint
     */
    function uncompress32(bytes32 word, uint256 offset) internal pure returns (uint256) {
        return word.decodeUint32(offset).mulUp(FixedPoint.ONE).divUp(type(uint32).max);
    }

    /**
     * @dev Compress a FisedPoint value to 32 bits, and write to a slot at the given offset
     */
    function compress32(
        bytes32 word,
        uint256 value,
        uint256 offset
    ) internal pure returns (bytes32) {
        return word.insertUint32(value.mulUp(type(uint32).max).divUp(FixedPoint.ONE), offset);
    }
}
