# 2022-03-15 - Silo Linear Pool

> ⚠️ **DEPRECATED: do not use** ⚠️
> This deployment has been deprecated in favor of a new version that uses create2 for pool deployments: [silo-linear-pool-v2](../../20230410-silo-linear-pool-v2/).

First deployment of the `SiloLinearPoolFactory`, for Linear Pools with a Silo yield-bearing token (shareToken).
Already fixes the reentrancy issue described in https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345.
Also has a fix in the `SiloLinearPoolRebalancer` to handle tokens which require the `SafeERC20` library for approvals.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Goerli testnet addresses](./output/goerli.json)
- [`SiloLinearPool` artifact](./artifact/SiloLinearPool.json)
- [`SiloLinearPoolFactory` artifact](./artifact/SiloLinearPoolFactory.json)
- [`SiloLinearPoolRebalancer` artifact](./artifact/SiloLinearPoolRebalancer.json)
