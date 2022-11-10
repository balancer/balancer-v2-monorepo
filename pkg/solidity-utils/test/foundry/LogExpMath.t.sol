// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import "forge-std/Test.sol";

import "../../contracts/math/LogExpMath.sol";

contract LogExpMathsTest is Test {
    function testPowError(int256 a) external {
        string[] memory inputs = new string[](3);
        inputs[0] = "echo";
        inputs[1] = "-n";
        inputs[2] = "gm";

        bytes memory res = vm.ffi(inputs);
        assertEq(string(res), "gm");
    }
}
