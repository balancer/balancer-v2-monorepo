# 2023-02-13 - Gearbox Linear Pool

First deployment of the `GearboxLinearPoolFactory`, for Linear Pools with a Gearbox yield-bearing token (dieselToken).
Already fixes the reentrancy issue described in https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345.
Also has a fix in the `GearboxLinearPoolRebalancer` to handle tokens which require the `SafeERC20` library for approvals.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [`GearboxLinearPoolFactory` artifact](./artifact/GearboxLinearPoolFactory.json)
- [`GearboxLinearPool` artifact](./artifact/GearboxLinearPool.json)
- [`GearboxLinearPoolRebalancer` artifact](./artifact/GearboxLinearPoolRebalancer.json)
