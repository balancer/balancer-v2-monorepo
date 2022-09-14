// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import "forge-std/Test.sol";

import "../../contracts/test/SimpleMock.sol";

contract SimpleMockTest is Test {
    SimpleMock simpleMock;

    function setUp() public {
        simpleMock = new SimpleMock();
    }

    function testPipe(uint256 a) public {
        assertEq(simpleMock.pipe(a), a);
    }
}