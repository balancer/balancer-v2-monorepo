// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

/**
 * @dev Wrappers over Solidity's arithmetic operations with added overflow checks.
 * Adapted from OpenZeppelin's SafeMath and SignedSafeMath
 */
library Math {
    string private constant _ERROR_ADD_OVERFLOW = "ERR_ADD_OVERFLOW";
    string private constant _ERROR_SUB_OVERFLOW = "ERR_SUB_OVERFLOW";

    /**
     * @dev Returns the addition of two unsigned integers of 256 bits, reverting on overflow.
     */
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, _ERROR_ADD_OVERFLOW);
        return c;
    }

    /**
     * @dev Returns the addition of two unsigned integers of 128 bits, reverting on overflow.
     */
    function add128(uint128 a, uint128 b) internal pure returns (uint128) {
        uint128 c = a + b;
        require(c >= a, _ERROR_ADD_OVERFLOW);
        return c;
    }

    /**
     * @dev Returns the subtraction of two unsigned integers of 256 bits, reverting on overflow.
     */
    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b <= a, _ERROR_SUB_OVERFLOW);
        uint256 c = a - b;
        return c;
    }

    /**
     * @dev Returns the subtraction of two unsigned integers of 128 bits, reverting on overflow.
     */
    function sub128(uint128 a, uint128 b) internal pure returns (uint128) {
        require(b <= a, _ERROR_SUB_OVERFLOW);
        uint128 c = a - b;
        return c;
    }

    /**
     * @dev Returns the smallest of two numbers of 128 bits.
     */
    function min128(uint128 a, uint128 b) internal pure returns (uint128) {
        return a < b ? a : b;
    }
}
