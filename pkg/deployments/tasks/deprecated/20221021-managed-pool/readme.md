# 2022-10-21 - Managed Pool Factory

> ⚠️ **DEPRECATED: do not use** ⚠️
>
> This factory and associated Pools have been deprecated due to dependencies requiring extra features: this deployment's Pools are not expected to ever be used.
>
> Superseded by this [updated version](../../20230411-managed-pool-v2), which has reentrancy protection, create2, configurable pause window, and other improvements.

Deployment of the `ManagedPoolFactory`, which allows creating Managed Pools.

A Managed Pool is a Weighted Pool with mutable tokens and weights, designed to be used in conjunction with an owner contract containing specific business logic. This in turn may support many asset management use cases, such as large token counts, rebalancing through token changes, gradual weight or fee updates, fine-grained control of protocol and management fees, allowlisting of LPs, and more.

> ⚠️ **DO NOT USE DIRECTLY** ⚠️
>
> Managed Pools should always be paired with another contract acting as their owner, which should implement sensible security policies. The owner of a Managed Pool has full control over all of its assets.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [Goerli testnet addresses](./output/goerli.json)
- [`ManagedPool` artifact](./artifact/ManagedPool.json)
- [`ManagedPoolFactory` artifact](./artifact/ManagedPoolFactory.json)
- [`ManagedPoolAddRemoveTokenLib` artifact](./artifact/ManagedPoolAddRemoveTokenLib.json)
- [`CircuitBreakerLib` artifact](./artifact/CircuitBreakerLib.json)
