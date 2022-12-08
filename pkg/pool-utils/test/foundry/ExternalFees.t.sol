// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "../../contracts/external-fees/ExternalFees.sol";

contract ExternalFeesTest is Test {
    function testNoPercentage(uint128 totalSupply) external {
        assertEq(ExternalFees.bptForPoolOwnershipPercentage(totalSupply, 0), 0);
    }

    function testNoSupply(uint64 expectedOwnershipPercentage) external {
        vm.assume(expectedOwnershipPercentage < 1e18);
        assertEq(ExternalFees.bptForPoolOwnershipPercentage(0, expectedOwnershipPercentage), 0);
    }

    function testPostOwnershipPercentage(uint128 totalSupply, uint64 expectedOwnershipPercentage) external {
        vm.assume(totalSupply > 1e6);
        vm.assume(expectedOwnershipPercentage < 1e18);
        uint256 fees = ExternalFees.bptForPoolOwnershipPercentage(totalSupply, expectedOwnershipPercentage);

        // Ownership of the fees should result in overall Pool ownership at least as large as the expected one (it may
        // be lower due to rounding errors that favor the other LPs).
        uint256 actualOwnershipPercentage = FixedPoint.divDown(fees, fees + totalSupply);
        assertLe(actualOwnershipPercentage, expectedOwnershipPercentage);

        // If we minted just one more token, the recipient of the fees would have ownership of the Pool no smaller than
        // the expected value (potentially equal in extreme rounding cases), meaning we're not rounding down
        // excessively.
        uint256 largerActualOwnershipPercentage = FixedPoint.divDown((fees + 1), (fees + 1) + totalSupply);
        assertGe(largerActualOwnershipPercentage, expectedOwnershipPercentage);
    }
}
