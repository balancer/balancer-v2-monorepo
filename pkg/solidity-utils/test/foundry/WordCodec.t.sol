// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

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
}
