// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import "forge-std/Test.sol";

import "../../contracts/math/FixedPoint.sol";

contract FixedPointTest is Test {
    function testComplement(uint256 x) external {
        uint256 referenceComplement = (x < FixedPoint.ONE) ? (FixedPoint.ONE - x) : 0;
        uint256 complement = FixedPoint.complement(x);

        assertEq(complement, referenceComplement);
    }

    function testMulUp(uint256 a, uint256 b) external {
        uint256 product = a * b;
        if (a != 0 && product / a != b) {
            vm.expectRevert("BAL#003"); // MUL_OVERFLOW
            FixedPoint.mulUp(a, b);
        } else {
            uint256 referenceMulUp = product == 0 ? 0 : ((product - 1) / FixedPoint.ONE) + 1;
            uint256 mulUp = FixedPoint.mulUp(a, b);

            assertEq(mulUp, referenceMulUp);
        }
    }

    function testDivDown(uint256 a, uint256 b) external {
        if (b == 0) {
            vm.expectRevert("BAL#004"); // ZERO_DIVISION
            FixedPoint.divDown(a, b);
        } else if (a != 0 && (a * FixedPoint.ONE) / FixedPoint.ONE != a) {
            vm.expectRevert("BAL#005"); // DIV_INTERNAL
            FixedPoint.divDown(a, b);
        } else {
            uint256 referenceDivDown = a == 0 ? 0 : (a * FixedPoint.ONE) / b;
            uint256 divDown = FixedPoint.divDown(a, b);

            assertEq(divDown, referenceDivDown);
        }
    }

    function testDivUp(uint256 a, uint256 b) external {
        if (b == 0) {
            vm.expectRevert("BAL#004"); // ZERO_DIVISION
            FixedPoint.divUp(a, b);
        } else if (a != 0 && (a * FixedPoint.ONE) / FixedPoint.ONE != a) {
            vm.expectRevert("BAL#005"); // DIV_INTERNAL
            FixedPoint.divUp(a, b);
        } else {
            uint256 referenceDivUp = a == 0 ? 0 : (a * FixedPoint.ONE - 1) / b + 1;
            uint256 divUp = FixedPoint.divUp(a, b);

            assertEq(divUp, referenceDivUp);
        }
    }
}
