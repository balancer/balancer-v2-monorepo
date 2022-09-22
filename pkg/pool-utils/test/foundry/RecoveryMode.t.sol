// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import "forge-std/Test.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

import "../../contracts/RecoveryMode.sol";
import "../../contracts/test/MockRecoveryMode.sol";

contract RecoveryModeTest is Test {
    using FixedPoint for uint256;

    uint256 private constant _DEFAULT_MINIMUM_BPT = 1e6;
    uint256 private constant _MAX_TOKENS = 50;

    MockRecoveryMode private _mock;

    function setUp() external {
        _mock = new MockRecoveryMode(address(0));
    }

    function testComputeProportionalAmountsOut(
        uint256[_MAX_TOKENS] memory fixedBalances,
        uint256 totalTokens,
        uint256 bptAmountIn,
        uint256 totalSupply
    ) public {
        totalSupply = bound(totalSupply, _DEFAULT_MINIMUM_BPT, type(uint112).max);
        bptAmountIn = bound(bptAmountIn, 0, totalSupply);

        totalTokens = bound(totalTokens, 2, _MAX_TOKENS);
        uint256[] memory balances = new uint256[](totalTokens);
        for (uint256 i = 0; i < totalTokens; i++) {
            balances[i] = bound(fixedBalances[i], 1, type(uint112).max);
        }

        uint256[] memory amountsOut = _mock.computeProportionalAmountsOut(balances, totalSupply, bptAmountIn);
        assertEq(amountsOut.length, totalTokens);

        emit log_named_array("balances", balances);
        emit log_named_array("amountsOut", amountsOut);
        emit log_named_uint("totalSupply", totalSupply);
        emit log_named_uint("bptAmountIn", bptAmountIn);

        uint256 poolOwnershipPercentage = bptAmountIn.divDown(totalSupply);
        for (uint256 i = 0; i < totalTokens; i++) {
            assertEq(amountsOut[i], balances[i].mulDown(poolOwnershipPercentage));
        }
    }
}
