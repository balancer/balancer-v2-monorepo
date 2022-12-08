// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../../contracts/lib/ComposablePoolLib.sol";

contract ComposablePoolLibTest is Test {
    event log_named_array(string key, IERC20[] val);

    function testDropBptFromTokens(IERC20[] memory tokens) external {
        vm.assume(tokens.length > 0);

        IERC20[] memory expectedTokensWithoutBpt = new IERC20[](tokens.length - 1);
        for (uint256 i = 0; i < expectedTokensWithoutBpt.length; i++) {
            expectedTokensWithoutBpt[i] = tokens[i + 1];
        }

        emit log_named_array("Tokens", tokens);
        emit log_named_array("Expected tokens without BPT", expectedTokensWithoutBpt);

        // Note that this requires tokens.length > 0 otherwise the array length will underflow.
        tokens = ComposablePoolLib.dropBptFromTokens(tokens);

        emit log_named_array("Actual tokens without BPT", tokens);

        assertEq(tokens.length, expectedTokensWithoutBpt.length);
        for (uint256 i = 0; i < expectedTokensWithoutBpt.length; i++) {
            assertEq(address(tokens[i]), address(expectedTokensWithoutBpt[i]));
        }
    }

    function testDropBptFromBalances(uint256 totalSupply, uint256[] memory balances) external {
        vm.assume(balances.length > 0);
        totalSupply = bound(totalSupply, balances[0], type(uint256).max);

        uint256 expectedVirtualSupply = totalSupply - balances[0];

        uint256[] memory expectedBalancesWithoutBpt = new uint256[](balances.length - 1);
        for (uint256 i = 0; i < expectedBalancesWithoutBpt.length; i++) {
            expectedBalancesWithoutBpt[i] = balances[i + 1];
        }

        emit log_named_array("Balances", balances);
        emit log_named_array("Expected balances without BPT", expectedBalancesWithoutBpt);

        // Note that this requires balances.length > 0 otherwise the array length will underflow.
        uint256 virtualSupply;
        (virtualSupply, balances) = ComposablePoolLib.dropBptFromBalances(totalSupply, balances);

        emit log_named_array("Actual balances without BPT", balances);

        assertEq(virtualSupply, expectedVirtualSupply);

        assertEq(balances.length, expectedBalancesWithoutBpt.length);
        for (uint256 i = 0; i < expectedBalancesWithoutBpt.length; i++) {
            assertEq(address(balances[i]), address(expectedBalancesWithoutBpt[i]));
        }
    }
}
