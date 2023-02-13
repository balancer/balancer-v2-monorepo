# 2023-02-13 - Gearbox Linear Pool

First deployment of the `GearboxLinearPoolFactory`, for Linear Pools with a Gearbox yield-bearing token (dieselToken).
Already fixes the reentrancy issue described in https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345.
Also has a fix in the `GearboxLinearPoolRebalancer` to handle tokens which require the `SafeERC20` library for approvals.

linear-pools commit: 652861c1352be7bcd1b3289c193653b427aaaf92

## Useful Files

- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [`GearboxLinearPoolFactory` artifact](./artifact/GearboxLinearPoolFactory.json)
- [`GearboxLinearPool` artifact](./artifact/GearboxLinearPool.json)
- [`GearboxLinearPoolRebalancer` artifact](./artifact/GearboxLinearPoolRebalancer.json)
