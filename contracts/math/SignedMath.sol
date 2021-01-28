// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

/**
 * @dev Wrappers over Solidity's arithmetic operations with added overflow checks.
 * Adapted from OpenZeppelin's SafeMath and SignedSafeMath
 */
library SignedMath {
    string constant private ERROR_ADD_OVERFLOW = "ERR_ADD_OVERFLOW";
    string constant private ERROR_SUB_OVERFLOW = "ERR_SUB_OVERFLOW";

    /**
     * @dev Returns the addition of two signed integers, reverting on overflow.
     */
    function add(int256 a, int256 b) internal pure returns (int256) {
        int256 c = a + b;
        require((b >= 0 && c >= a) || (b < 0 && c < a), ERROR_ADD_OVERFLOW);
        return c;
    }

    /**
     * @dev Returns the subtraction of two signed integers, reverting on overflow.
     */
    function sub(int256 a, int256 b) internal pure returns (int256) {
        int256 c = a - b;
        require((b >= 0 && c <= a) || (b < 0 && c > a), ERROR_SUB_OVERFLOW);
        return c;
    }

    /**
     * @dev Returns the absolute value of a signed integer.
     */
    function abs(int256 a) internal pure returns (uint256) {
        return uint256(a > 0 ? a : -a);
    }
}
