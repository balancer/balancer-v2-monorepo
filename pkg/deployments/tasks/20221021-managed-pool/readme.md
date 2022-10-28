# 2022-10-21 - Managed Pool Factory

Deployment of the `ManagedPoolFactory`, which allows creating Managed Pools.

A Managed Pool is a Weighted Pool with mutable tokens and weights, designed to be used in conjunction with an owner contract containing specific business logic. This in turn may support many asset management use cases, such as large token counts, rebalancing through token changes, gradual weight or fee updates, fine-grained control of protocol and management fees, allowlisting of LPs, and more.

> ⚠️ **DO NOT USE DIRECTLY** ⚠️
>
> Managed Pools should always be paired with another contract acting as their owner, which should implement sensible security policies. The owner of a Managed Pool has full control over all of its assets.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon addresses](./output/polygon.json)
- [Arbitrum addresses](./output/arbitrum.json)
- [Optimism addresses](./output/optimism.json)
- [`ManagedPool` ABI](./abi/ManagedPool.json)
- [`ManagedPoolFactory` ABI](./abi/ManagedPoolFactory.json)
