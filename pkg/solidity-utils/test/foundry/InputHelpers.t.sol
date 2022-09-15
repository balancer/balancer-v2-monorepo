// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import "forge-std/Test.sol";

import "../../contracts/helpers/InputHelpers.sol";

contract MockInputHelpers {
    function ensureArrayIsSorted(address[] memory addresses) external pure {
        InputHelpers.ensureArrayIsSorted(addresses);
    }
}

contract InputHelpersTest is Test {
    MockInputHelpers mock;

    function setUp() external {
        mock = new MockInputHelpers();
    }

    function testEnsureArrayIsSorted(address[] memory addresses) public {
        (bool success, ) = address(mock).call(abi.encodeWithSelector(mock.ensureArrayIsSorted.selector, addresses));

        if (success) {
            for (uint256 i = 1; i < addresses.length; ++i) {
                assertTrue(addresses[i - 1] < addresses[i]);
            }
        } else {
            bool unsorted = false;
            for (uint256 i = 1; i < addresses.length; ++i) {
                if (addresses[i - 1] >= addresses[i]) {
                    unsorted = true;
                }
            }

            assertTrue(unsorted);
        }
    }
}
