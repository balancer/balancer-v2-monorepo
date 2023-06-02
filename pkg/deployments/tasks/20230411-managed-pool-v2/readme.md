# 2023-04-11 - Managed Pool Factory V2

Second deployment of the `ManagedPoolFactory`, which allows creating Managed Pools using create2, reentrancy protection, and other improvements.

A Managed Pool is a Weighted Pool with mutable tokens and weights, designed to be used in conjunction with an owner contract containing specific business logic. This in turn may support many asset management use cases, such as large token counts, rebalancing through token changes, gradual weight or fee updates, fine-grained control of protocol and management fees, allowlisting of LPs, and more.

> ⚠️ **DO NOT USE DIRECTLY** ⚠️
>
> Managed Pools should always be paired with another contract acting as their owner, which should implement sensible security policies. The owner of a Managed Pool has full control over all of its assets.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [BSC mainnet addresses](./output/bsc.json)
- [Gnosis mainnet addresses](./output/gnosis.json)
- [Avalanche mainnet addresses](./output/avalanche.json)
- [Polygon zkeVM mainnet addresses](./output/zkevm.json)
- [Goerli testnet addresses](./output/goerli.json)
- [Sepolia testnet addresses](./output/sepolia.json)
- [`ManagedPoolFactory` artifact](./artifact/ManagedPoolFactory.json)
- [`ManagedPoolAddRemoveTokenLib` artifact](./artifact/ManagedPoolAddRemoveTokenLib.json)
- [`ManagedPoolAmmLib` artifact](./artifact/ManagedPoolAmmLib.json)
- [`CircuitBreakerLib` artifact](./artifact/CircuitBreakerLib.json)
