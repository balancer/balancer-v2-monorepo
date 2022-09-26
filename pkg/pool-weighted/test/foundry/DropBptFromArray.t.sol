// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.0;

import "forge-std/Test.sol";

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

contract DropBptFromArrayTest is Test {
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
        assembly {
            mstore(add(tokens, 32), sub(mload(tokens), 1))
            tokens := add(tokens, 32)
        }

        emit log_named_array("Actual tokens without BPT", tokens);

        for (uint256 i = 0; i < expectedTokensWithoutBpt.length; i++) {
            assertEq(address(tokens[i]), address(expectedTokensWithoutBpt[i]));
        }
    }

    function testDropBptFromBalances(uint256[] memory balances) external {
        vm.assume(balances.length > 0);

        uint256[] memory expectedBalancesWithoutBpt = new uint256[](balances.length - 1);
        for (uint256 i = 0; i < expectedBalancesWithoutBpt.length; i++) {
            expectedBalancesWithoutBpt[i] = balances[i + 1];
        }

        emit log_named_array("Balances", balances);
        emit log_named_array("Expected balances without BPT", expectedBalancesWithoutBpt);

        // Note that this requires balances.length > 0 otherwise the array length will underflow.
        assembly {
            mstore(add(balances, 32), sub(mload(balances), 1))
            balances := add(balances, 32)
        }

        emit log_named_array("Actual balances without BPT", balances);

        for (uint256 i = 0; i < expectedBalancesWithoutBpt.length; i++) {
            assertEq(address(balances[i]), address(expectedBalancesWithoutBpt[i]));
        }
    }
}
