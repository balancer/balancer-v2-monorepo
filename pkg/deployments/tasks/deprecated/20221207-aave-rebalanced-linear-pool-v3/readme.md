# 2022-12-07 - Aave Rebalanced Linear Pool v3

> ⚠️ **DEPRECATED: do not use** ⚠️
>
> Superseded by [Aave Linear Pool V4](../../20230206-aave-rebalanced-linear-pool-v4/), which fixes the reentrancy issue described in this [forum post](https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345).

Deployment of the `AaveLinearPoolFactory`, for Linear Pools with a wrapped aToken. This new deployment includes:

- A fix for the `AaveLinearPool` being susceptible to spoofed revert data from the external call to fetch the wrapped token rate, potentially resulting in manipulation of the exchange rate used by `AaveLinearPoolRebalancer`.
- A fix for the `AaveLinearPoolRebalancer` to handle tokens which do not allow setting an approval without first setting the approval to zero.

This is version 3 because it is the third generation of Aave Linear Pools, the other two being `20211208-aave-linear-pool` and `20220817-aave-rebalanced-linear-pool`.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [BSC mainnet addresses](./output/bsc.json)
- [Gnosis mainnet addresses](./output/gnosis.json)
- [Goerli testnet addresses](./output/goerli.json)
- [`AaveLinearPoolFactory` artifact](./artifact/AaveLinearPoolFactory.json)
