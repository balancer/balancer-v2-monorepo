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

    // Scaling factors to adjust resolution of weights from full 256 bit to 16/32 bits respectively
    uint256 private constant _MAX_UINT_16 = 2**(16) - 1;
    uint256 private constant _MAX_UINT_32 = 2**(32) - 1;

    uint256 private constant _SCALING_FACTOR_16 = 1e18 / _MAX_UINT_16;
    uint256 private constant _SCALING_FACTOR_32 = 1e18 / _MAX_UINT_32;

    /**
     * @dev Read a value from a 16-bit slot at the given offset
     */
    function read16(bytes32 word, uint256 offset) internal pure returns (uint256) {
        return word.decodeUint16(offset).mulDown(_SCALING_FACTOR_16);
    }

    /**
     * @dev Write a value into a 16-bit slot at the given offset
     */
    function write16(
        bytes32 word,
        uint256 value,
        uint256 offset
    ) internal pure returns (bytes32) {
        return word.insertUint16(value.divDown(_SCALING_FACTOR_16), offset);
    }

    /**
     * @dev Read a value from a 32-bit slot at the given offset
     */
    function read32(bytes32 word, uint256 offset) internal pure returns (uint256) {
        return word.decodeUint32(offset).mulDown(_SCALING_FACTOR_32);
    }

    /**
     * @dev Write value into a 32-bit slot at the given offset
     */
    function write32(
        bytes32 word,
        uint256 value,
        uint256 offset
    ) internal pure returns (bytes32) {
        return word.insertUint32(value.divDown(_SCALING_FACTOR_32), offset);
    }
}
