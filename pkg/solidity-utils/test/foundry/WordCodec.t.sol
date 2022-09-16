// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import "forge-std/Test.sol";

import "../../contracts/helpers/WordCodec.sol";

contract WordCodecTest is Test {
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

    function testDecodeBool(bytes32 word, uint256 offset) external {
        bool referenceDecodeBool = (uint256(word >> offset) & 1) == 1;
        bool decodeBool = WordCodec.decodeBool(word, offset);

        assertEq(decodeBool, referenceDecodeBool);
    }
}
