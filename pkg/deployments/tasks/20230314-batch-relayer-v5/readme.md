# 2023-03-14 - Batch Relayer V5

Deployment of the fifth `BalancerRelayer` using `BatchRelayerLibrary`, for combining multiple operations (swaps, joins, etc.) in a single transaction.

This new version provides full support for all versions of Stable Pools: in particular, V2 and higher, which support proportional joins and exits.
It also adds support for many new protocol wrappers: CompoundV2 (Midas), Euler, Gearbox, Silo, Tetu, and Yearn.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [BSC mainnet addresses](./output/bsc.json)
- [Gnosis mainnet addresses](./output/gnosis.json)
- [Avalanche mainnet addresses](./output/avalanche.json)
- [Goerli testnet addresses](./output/goerli.json)
- [`BatchRelayerLibrary` artifact](./artifact/BatchRelayerLibrary.json)
