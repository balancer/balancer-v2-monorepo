// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import "forge-std/Test.sol";

import "../../contracts/math/Math.sol";

contract MathTest is Test {
    function testAbs(int256 a) external {
        uint256 referenceAbs = a > 0 ? uint256(a) : uint256(-a);
        uint256 abs = Math.abs(a);

        assertEq(abs, referenceAbs);
    }

    function testMax(uint256 a, uint256 b) external {
        uint256 referenceMax = (a < b) ? b : a;
        uint256 max = Math.max(a, b);

        assertEq(max, referenceMax);
    }

    function testMin(uint256 a, uint256 b) external {
        uint256 referenceMin = (a < b) ? a : b;
        uint256 min = Math.min(a, b);

        assertEq(min, referenceMin);
    }

    function testDivUp(uint256 a, uint256 b) external {
        if (b == 0) {
            vm.expectRevert("BAL#004"); // ZERO_DIVISION
            Math.divUp(a, b);
        } else {
            uint256 referenceDivUp = a == 0 ? 0 : 1 + (a - 1) / b;
            uint256 divUp = Math.divUp(a, b);

            assertEq(divUp, referenceDivUp);
        }
    }
}
