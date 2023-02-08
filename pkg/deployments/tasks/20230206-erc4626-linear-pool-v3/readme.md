# 2023-02-06 - ERC4626 Linear Pool V=3

Third deployment of the `ERC4626LinearPoolFactory`, for Linear Pools with a ERC4626 yield-bearing token.
Supersedes `20220404-erc4626-linear-pool-v2`, fixing the reentrancy issue described in https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345.
Also has a fix in the `ERC4727LinearPoolRebalancer` to handle tokens which do not allow setting an approval without first setting the approval to zero.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [Gnosis mainnet addresses](./output/gnosis.json)
- [Goerli testnet addresses](./output/goerli.json)
- [`ERC4626LinearPool` artifact](./artifact/ERC4626LinearPool.json)
