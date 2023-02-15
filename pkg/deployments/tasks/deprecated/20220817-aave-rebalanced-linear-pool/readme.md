# 2022-08-17 - Aave Rebalanced Linear Pool

> ⚠️ **DEPRECATED: do not use** ⚠️
>
> This relayer was deprecated in favor of an [updated version (also now deprecated)](../20221207-aave-rebalanced-linear-pool-v3), which improves the Rebalancer contract to handle more tokens and fixes a potential issue where a malicious contract being called while fetching the wrapped token rate could extract value from the pool.

Deployment of the `AaveLinearPoolFactory`, for Linear Pools with a wrapped aToken. This new deployment includes a permissionless rebalancing contract that has Asset Manager privileges.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet address](./output/arbitrum.json)
- [Optimism mainnet address](./output/optimism.json)
- [`AaveLinearPoolFactory` artifact](./artifact/AaveLinearPoolFactory.json)
