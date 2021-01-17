// SPDX-License-Identifier: MIT

pragma solidity ^0.7.1;

import "../pools/BalancerPoolToken.sol";

contract MockBalancerPoolToken is BalancerPoolToken {
    constructor (
        string memory name,
        string memory symbol,
        address initialAccount,
        uint256 initialBalance
    ) payable BalancerPoolToken(name, symbol) {
        _mintPoolTokens(initialAccount, initialBalance);
    }

    function getChainId() external view returns (uint256 chainId) {
        // silence state mutability warning without generating bytecode
        // - see https://github.com/ethereum/solidity/issues/2691
        this;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            chainId := chainid()
        }
    }
}
