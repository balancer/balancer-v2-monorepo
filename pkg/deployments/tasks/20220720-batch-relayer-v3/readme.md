# 2022-07-20 - Batch Relayer V3

Deployment of the second `BalancerRelayer` using `BatchRelayerLibrary`, for combining multiple operations (swaps, joins, etc.) in a single transaction.

This new version adds support for Liquidity Gauge interactions, including staking, unstaking, minting, etc.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [`BalancerRelayer` ABI](./abi/BalancerRelayer.json)
- [`BatchRelayerLibrary` ABI](./abi/BatchRelayerLibrary.json)
