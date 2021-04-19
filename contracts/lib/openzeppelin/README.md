## Ports from OpenZeppelin Contracts

Files in this directory are based on the [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) library, and as such licensed under the MIT License, see [LICENSE](./LICENSE).

Most of the modifications fall under one of these categories:

- removal of functions unused in Balancer V2 source code
- replacement of `require` statements for usage of the `_require` function from the `BalancerErrors.sol` contract
- modification or addition of functionality to provide reduced bytecode size (see `ReentrancyGuard.sol`) or gas usage (see `EnumerableSet`, `EnumerableMap` or `SafeERC20`)

Non-trivial modifications of this last category have associated source-code comments that explain the changes and motivation.
