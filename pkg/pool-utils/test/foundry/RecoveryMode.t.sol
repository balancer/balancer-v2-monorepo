// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import "forge-std/Test.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

import "../../contracts/RecoveryMode.sol";
import "../../contracts/test/MockRecoveryMode.sol";

contract RecoveryModeTest is Test {
    using FixedPoint for uint256;

    uint256 private constant _TOTAL_SUPPLY = type(uint16).max;
    uint256 private constant _DEFAULT_MINIMUM_BPT = 1e6;
    uint256 private constant _MAX_TOKENS = 50;

    MockRecoveryMode private _mock;

    function setUp() external {
        _mock = new MockRecoveryMode(address(0));
    }

    function testComputeProportionalAmountsOut(uint256[] memory balances, uint16 bptAmountOut) public {
      vm.assume(balances.length <= _MAX_TOKENS);

      for (uint256 i = 0; i < balances.length; i++) {
        balances[i] = bound(balances[i], _DEFAULT_MINIMUM_BPT, type(uint112).max);
      }

      uint256[] memory amountsOut = _mock.computeProportionalAmountsOut(
          balances,
          _TOTAL_SUPPLY,
          bptAmountOut
      );

      uint256 ratio = uint256(bptAmountOut).divDown(_TOTAL_SUPPLY);

      for (uint256 i = 0; i < balances.length; i++) {
        assertEq(amountsOut[i], balances[i].mulDown(ratio));
      }
    }
}
