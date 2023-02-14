# 2022-09-16 - Batch Relayer V5

Deployment of the fifth `BalancerRelayer` using `BatchRelayerLibrary`, for combining multiple operations (swaps, joins, etc.) in a single transaction.

This new version provides relayers for tokens of the recently created linear pools, which is needed to manipulate the tokens inside a pool.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [BSC mainnet addresses](./output/bsc.json)
- [Gnosis mainnet addresses](./output/gnosis.json)
- [Goerli testnet addresses](./output/goerli.json)
- [`BalancerRelayer` artifact](./artifact/BalancerRelayer.json)
- [`BatchRelayerLibrary` artifact](./artifact/BatchRelayerLibrary.json)
