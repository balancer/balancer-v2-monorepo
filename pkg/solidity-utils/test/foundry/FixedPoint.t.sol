// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../../contracts/math/FixedPoint.sol";

contract FixedPointTest is Test {
    function testComplement(uint256 x) external {
        uint256 complement = FixedPoint.complement(x);

        if (x < FixedPoint.ONE) {
            assertEq(complement, FixedPoint.ONE - x);
        } else {
            assertEq(complement, 0);
        }
    }

    function testComplementEquivalence(uint256 x) external {
        uint256 referenceComplement = (x < FixedPoint.ONE) ? (FixedPoint.ONE - x) : 0;
        uint256 complement = FixedPoint.complement(x);

        assertEq(complement, referenceComplement);
    }

    function testMulDown(uint256 a, uint256 b) external {
        uint256 product = a * b;
        if (a != 0 && product / a != b) {
            vm.expectRevert("BAL#003"); // MUL_OVERFLOW
            FixedPoint.mulDown(a, b);
        } else {
            uint256 mulDown = FixedPoint.mulDown(a, b);

            assertLe(mulDown, (a * b) / FixedPoint.ONE);
            if (mulDown < type(uint256).max) {
                assertGe(mulDown + 1, (a * b) / FixedPoint.ONE);
            }
        }
    }

    function testMulUp(uint256 a, uint256 b) external {
        uint256 product = a * b;
        if (a != 0 && product / a != b) {
            vm.expectRevert("BAL#003"); // MUL_OVERFLOW
            FixedPoint.mulUp(a, b);
        } else {
            uint256 mulUp = FixedPoint.mulUp(a, b);

            assertGe(mulUp, (a * b) / FixedPoint.ONE);
            if (mulUp > 0) {
                assertLe(mulUp - 1, (a * b) / FixedPoint.ONE);
            }
        }
    }

    function testMulUpEquivalence(uint256 a, uint256 b) external {
        uint256 product = a * b;
        vm.assume(a == 0 || product / a == b);

        uint256 referenceMulUp = product == 0 ? 0 : ((product - 1) / FixedPoint.ONE) + 1;
        uint256 mulUp = FixedPoint.mulUp(a, b);

        assertEq(mulUp, referenceMulUp);
    }

    function testDivDown(uint256 a, uint256 b) external {
        if (b == 0) {
            vm.expectRevert("BAL#004"); // ZERO_DIVISION
            FixedPoint.divDown(a, b);
        } else if (a != 0 && (a * FixedPoint.ONE) / FixedPoint.ONE != a) {
            vm.expectRevert("BAL#005"); // DIV_INTERNAL
            FixedPoint.divDown(a, b);
        } else {
            uint256 divDown = FixedPoint.divDown(a, b);

            assertLe(divDown, (a * FixedPoint.ONE) / b);
            if (divDown < type(uint256).max) {
                assertGe(divDown + 1, (a * FixedPoint.ONE) / b);
            }
        }
    }

    function testDivDownEquivalence(uint256 a, uint256 b) external {
        vm.assume(b > 0);
        vm.assume(a == 0 || (a * FixedPoint.ONE) / FixedPoint.ONE == a);

        uint256 referenceDivDown = a == 0 ? 0 : (a * FixedPoint.ONE) / b;
        uint256 divDown = FixedPoint.divDown(a, b);

        assertEq(divDown, referenceDivDown);
    }

    function testDivUp(uint256 a, uint256 b) external {
        if (b == 0) {
            vm.expectRevert("BAL#004"); // ZERO_DIVISION
            FixedPoint.divUp(a, b);
        } else if (a != 0 && (a * FixedPoint.ONE) / FixedPoint.ONE != a) {
            vm.expectRevert("BAL#005"); // DIV_INTERNAL
            FixedPoint.divUp(a, b);
        } else {
            uint256 divUp = FixedPoint.divUp(a, b);

            assertGe(divUp, (a * FixedPoint.ONE) / b);
            if (divUp > 0) {
                assertLe(divUp - 1, (a * FixedPoint.ONE) / b);
            }
        }
    }

    function testDivUpEquivalence(uint256 a, uint256 b) external {
        vm.assume(b > 0);
        vm.assume(a == 0 || (a * FixedPoint.ONE) / FixedPoint.ONE == a);

        uint256 referenceDivUp = a == 0 ? 0 : (a * FixedPoint.ONE - 1) / b + 1;
        uint256 divUp = FixedPoint.divUp(a, b);

        assertEq(divUp, referenceDivUp);
    }
}
