# 2022-12-07 - Aave Rebalanced Linear Pool v3

Deployment of the `AaveLinearPoolFactory`, for Linear Pools with a wrapped aToken. This new deployment includes:

- A fix for the `AaveLinearPool` being susceptible to spoofed revert data from the external call to fetch the wrapped token rate, potentially resulting in manipulation of the exchange rate used by `AaveLinearPoolRebalancer`.
- A fix for the `AaveLinearPoolRebalancer` to handle tokens which do not allow setting an approval without first setting the approval to zero.

This is version 3 because it is the third generation of Aave Linear Pools, the other two being `20211208-aave-linear-pool` and `20220817-aave-rebalanced-linear-pool`.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet address](./output/arbitrum.json)
- [Optimism mainnet address](./output/optimism.json)
- [`AaveLinearPool` artifact](./artifact/AaveLinearPool.json)
- [`AaveLinearPoolFactory` artifact](./artifact/AaveLinearPoolFactory.json)
- [`AaveLinearPoolRebalancer` artifact](./artifact/AaveLinearPoolRebalancer.json)
