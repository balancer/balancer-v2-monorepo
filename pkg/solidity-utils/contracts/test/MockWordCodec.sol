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

import "../helpers/WordCodec.sol";

contract MockWordCodec {
    function insertUint(
        bytes32 word,
        uint256 value,
        uint256 offset,
        uint256 bitLength
    ) external pure returns (bytes32) {
        return WordCodec.insertUint(word, value, offset, bitLength);
    }

    function insertInt(
        bytes32 word,
        int256 value,
        uint256 offset,
        uint256 bitLength
    ) external pure returns (bytes32) {
        return WordCodec.insertInt(word, value, offset, bitLength);
    }

    function encodeUint(
        uint256 value,
        uint256 offset,
        uint256 bitLength
    ) external pure returns (bytes32) {
        return WordCodec.encodeUint(value, offset, bitLength);
    }

    function encodeInt(
        int256 value,
        uint256 offset,
        uint256 bitLength
    ) external pure returns (bytes32) {
        return WordCodec.encodeInt(value, offset, bitLength);
    }

    function decodeUint(
        bytes32 value,
        uint256 offset,
        uint256 bitLength
    ) external pure returns (uint256) {
        return WordCodec.decodeUint(value, offset, bitLength);
    }

    function decodeInt(
        bytes32 value,
        uint256 offset,
        uint256 bitLength
    ) external pure returns (int256) {
        return WordCodec.decodeInt(value, offset, bitLength);
    }
}
