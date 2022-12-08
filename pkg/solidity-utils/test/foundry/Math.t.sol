// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../../contracts/math/Math.sol";

contract MathTest is Test {
    function testAbs(int256 a) external {
        uint256 abs = Math.abs(a);

        if (a >= 0) {
            assertEq(int256(abs), a);
        } else {
            assertEq(int256(abs), -a);
        }
    }

    function testAbsEquivalence(int256 a) external {
        uint256 abs = Math.abs(a);
        uint256 referenceAbs = a > 0 ? uint256(a) : uint256(-a);

        assertEq(abs, referenceAbs);
    }

    function testMax(uint256 a, uint256 b) external {
        uint256 max = Math.max(a, b);

        assertGe(max, a);
        assertGe(max, b);
        assertTrue((max == a) || (max == b));
    }

    function testMaxEquivalence(uint256 a, uint256 b) external {
        uint256 max = Math.max(a, b);
        uint256 referenceMax = (a < b) ? b : a;

        assertEq(max, referenceMax);
    }

    function testMin(uint256 a, uint256 b) external {
        uint256 min = Math.min(a, b);

        assertLe(min, a);
        assertLe(min, b);
        assertTrue((min == a) || (min == b));
    }

    function testMinEquivalence(uint256 a, uint256 b) external {
        uint256 min = Math.min(a, b);
        uint256 referenceMin = (a < b) ? a : b;

        assertEq(min, referenceMin);
    }

    function testDivDown(uint256 a, uint256 b) external {
        if (b == 0) {
            vm.expectRevert("BAL#004"); // ZERO_DIVISION
            Math.divDown(a, b);
        } else {
            uint256 divDown = Math.divDown(a, b);

            assertLe(divDown, a / b);
            if (divDown < type(uint256).max) {
                assertGe(divDown + 1, a / b);
            }
        }
    }

    function testDivUp(uint256 a, uint256 b) external {
        if (b == 0) {
            vm.expectRevert("BAL#004"); // ZERO_DIVISION
            Math.divUp(a, b);
        } else {
            uint256 divUp = Math.divUp(a, b);

            assertGe(divUp, a / b);
            if (divUp > 0) {
                assertLe(divUp - 1, a / b);
            }
        }
    }

    function testDivUpEquivalence(uint256 a, uint256 b) external {
        vm.assume(b > 0);

        uint256 referenceDivUp = a == 0 ? 0 : 1 + (a - 1) / b;
        uint256 divUp = Math.divUp(a, b);

        assertEq(divUp, referenceDivUp);
    }
}
