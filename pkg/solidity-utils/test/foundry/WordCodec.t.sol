// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../../contracts/helpers/WordCodec.sol";

contract WordCodecTest is Test {
    function testEncodeUint255Bits(uint256 input) external {
        vm.assume(input < (1 << (255 - 1)));

        bytes32 data = WordCodec.encodeUint(input, 0, 255);
        uint256 decoded = WordCodec.decodeUint(data, 0, 255);

        assertEq(decoded, input);
    }

    function testEncodeUintMultiBits(
        uint256 input,
        uint8 bits,
        uint256 offset
    ) external {
        (input, bits, offset) = _getAdjustedValues(input, bits, offset);

        bytes32 data = WordCodec.encodeUint(input, offset, bits);
        uint256 decoded = WordCodec.decodeUint(data, offset, bits);

        assertEq(decoded, input);
    }

    function testEncodeUintOtherBitsFree(
        uint256 input,
        uint8 bits,
        uint256 offset
    ) external {
        (input, bits, offset) = _getAdjustedValues(input, bits, offset);

        bytes32 data = WordCodec.encodeUint(input, offset, bits);
        bytes32 mask = bytes32(((1 << bits) - 1) << offset);
        assertEq(data & ~mask, bytes32(0));
    }

    function _getAdjustedValues(
        uint256 input,
        uint8 bits,
        uint256 offset
    )
        private
        returns (
            uint256,
            uint8,
            uint256
        )
    {
        vm.assume(bits > 0);
        vm.assume(input < (1 << (255 - 1)));

        input = input & ((1 << bits) - 1);
        if (bits < 255) {
            offset = offset % (255 - bits);
        } else {
            offset = 0;
        }

        return (input, bits, offset);
    }

    function testInsertUint(
        bytes32 word,
        uint256 value,
        uint256 offset,
        uint256 bitLength
    ) external {
        if (offset >= 256 || !(bitLength >= 1 && bitLength <= Math.min(255, 256 - offset))) {
            vm.expectRevert("BAL#100"); // OUT_OF_BOUNDS
            WordCodec.insertUint(word, value, offset, bitLength);
        } else if (value >> bitLength != 0) {
            vm.expectRevert("BAL#436"); // CODEC_OVERFLOW
            WordCodec.insertUint(word, value, offset, bitLength);
        } else {
            uint256 mask = (1 << bitLength) - 1;
            bytes32 clearedWord = bytes32(uint256(word) & ~(mask << offset));
            bytes32 referenceInsertUint = clearedWord | bytes32(value << offset);

            bytes32 insertUint = WordCodec.insertUint(word, value, offset, bitLength);

            assertEq(insertUint, referenceInsertUint);
        }
    }

    function testInsertInt(
        bytes32 word,
        int256 value,
        uint256 offset,
        uint256 bitLength
    ) external {
        if (offset >= 256 || !(bitLength >= 1 && bitLength <= Math.min(255, 256 - offset))) {
            vm.expectRevert("BAL#100"); // OUT_OF_BOUNDS
            WordCodec.insertInt(word, value, offset, bitLength);
            return;
        } else if (value >= 0 ? value >> (bitLength - 1) != 0 : Math.abs(value + 1) >> (bitLength - 1) != 0) {
            vm.expectRevert("BAL#436"); // CODEC_OVERFLOW
            WordCodec.insertInt(word, value, offset, bitLength);
        } else {
            uint256 mask = (1 << bitLength) - 1;
            bytes32 clearedWord = bytes32(uint256(word) & ~(mask << offset));
            bytes32 referenceInsertInt = clearedWord | bytes32((uint256(value) & mask) << offset);

            bytes32 insertInt = WordCodec.insertInt(word, value, offset, bitLength);

            assertEq(insertInt, referenceInsertInt);
        }
    }

    function testInsertBool(
        bytes32 word,
        bool value,
        uint256 offset
    ) external {
        // if (offset >= 256) {
        //     vm.expectRevert("BAL#100"); // OUT_OF_BOUNDS
        //     WordCodec.insertBool(word, value, offset);
        // } else {
        bytes32 clearedWord = bytes32(uint256(word) & ~(1 << offset));
        bytes32 referenceInsertBool = clearedWord | bytes32(uint256(value ? 1 : 0) << offset);

        bytes32 insertBool = WordCodec.insertBool(word, value, offset);

        assertEq(insertBool, referenceInsertBool);
        // }
    }

    function testDecodeUint(
        bytes32 word,
        uint256 offset,
        uint256 bitLength
    ) external {
        uint256 referenceDecodeUint = uint256(word >> offset) & ((1 << bitLength) - 1);
        uint256 decodeUint = WordCodec.decodeUint(word, offset, bitLength);

        assertEq(decodeUint, referenceDecodeUint);
    }

    function testDecodeInt(
        bytes32 word,
        uint256 offset,
        uint256 bitLength
    ) external {
        vm.assume(bitLength > 0);
        int256 maxInt = int256((1 << (bitLength - 1)) - 1);
        uint256 mask = (1 << bitLength) - 1;
        int256 value = int256(uint256(word >> offset) & mask);
        int256 referenceDecodeInt = value > maxInt ? (value | int256(~mask)) : value;

        int256 decodeInt = WordCodec.decodeInt(word, offset, bitLength);

        assertEq(decodeInt, referenceDecodeInt);
    }

    function testDecodeBool(bytes32 word, uint256 offset) external {
        bool referenceDecodeBool = (uint256(word >> offset) & 1) == 1;
        bool decodeBool = WordCodec.decodeBool(word, offset);

        assertEq(decodeBool, referenceDecodeBool);
    }
}
