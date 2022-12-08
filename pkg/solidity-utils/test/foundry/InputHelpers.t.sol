// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../../contracts/helpers/InputHelpers.sol";

contract InputHelpersTest is Test {
    function testEnsureArrayIsSorted(address[] memory addresses) public {
        bool unsorted = false;
        for (uint256 i = 1; i < addresses.length; ++i) {
            if (addresses[i - 1] >= addresses[i]) {
                unsorted = true;
            }
        }

        if (unsorted) {
            vm.expectRevert("BAL#101");
        }
        InputHelpers.ensureArrayIsSorted(addresses);
    }
}
