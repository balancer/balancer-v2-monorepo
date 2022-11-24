# 2022-07-20 - Batch Relayer V3

> ⚠️ **DEPRECATED: do not use** ⚠️
>
> This relayer has been deprecated in favor of an [updated version](../../20220916-batch-relayer-v4) with new features, such as read-only references and a 'peek' reference public method.

Deployment of the second `BalancerRelayer` using `BatchRelayerLibrary`, for combining multiple operations (swaps, joins, etc.) in a single transaction.

This new version adds support for Liquidity Gauge interactions, including staking, unstaking, minting, etc.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [`BalancerRelayer` artifact](./artifact/BalancerRelayer.json)
- [`BatchRelayerLibrary` artifact](./artifact/BatchRelayerLibrary.json)
