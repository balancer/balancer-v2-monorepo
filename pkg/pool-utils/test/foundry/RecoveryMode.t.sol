// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import "forge-std/Test.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

import "../../contracts/RecoveryMode.sol";
import "../../contracts/test/MockRecoveryMode.sol";

contract RecoveryModeTest is Test {
    using FixedPoint for uint256;

    uint16 private constant _TOTAL_SUPPLY = type(uint16).max;
    uint256 private constant _MAX_TOKENS = 50;

    MockRecoveryMode private _mock;

    function setUp() external {
        _mock = new MockRecoveryMode(address(0));
    }

    function testComputeProportionalAmountsOut(uint112[] memory balances, uint16 bptAmountOut) public {
      vm.assume(balances.length <= _MAX_TOKENS);

      uint256[] memory amounts = new uint256[](balances.length);
      for (uint256 i = 0; i < balances.length; i++) {
        amounts[i] = balances[i];
      }

      uint256[] memory amountsOut = _mock.computeProportionalAmountsOut(
          amounts,
          uint256(_TOTAL_SUPPLY).mulUp(FixedPoint.ONE),
          uint256(bptAmountOut).mulUp(FixedPoint.ONE)
      );

      uint256 ratio = uint256(bptAmountOut).mulDown(FixedPoint.ONE).divDown(_TOTAL_SUPPLY);

      for (uint256 i = 0; i < balances.length; i++) {
        assertEq(amountsOut[i], amounts[i].mulDown(ratio));
      }
    }
}
