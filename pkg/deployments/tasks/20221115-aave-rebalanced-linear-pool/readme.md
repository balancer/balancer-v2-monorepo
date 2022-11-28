# 2022-11-15 - Aave Rebalanced Linear Pool

Deployment of the `AaveLinearPoolFactory`, for Linear Pools with a wrapped aToken. This new deployment includes:

- A fix for the `AaveLinearPool` being susceptible to spoofed revert data from the external call to fetch the wrapped token rate, potentially resulting in manipulation of the exchange rate used by `AaveLinearPoolRebalancer`.
- A fix for the `AaveLinearPoolRebalancer` to handle tokens which do not allow setting an approval without first setting the approval to zero.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet address](./output/arbitrum.json)
- [Optimism mainnet address](./output/optimism.json)
- [`AaveLinearPool` artifact](./artifact/AaveLinearPool.json)
- [`AaveLinearPoolFactory` artifact](./artifact/AaveLinearPoolFactory.json)
- [`AaveLinearPoolRebalancer` artifact](./artifact/AaveLinearPoolRebalancer.json)
