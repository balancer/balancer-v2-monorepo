# 2022-03-18 - Batch Relayer V2

Deployment of the second `BalancerRelayer` using `BatchRelayerLibrary`, for combining multiple operations (swaps, joins, etc.) in a single transaction. This version focuses on adding new wrapping functionality for various types of linear pools. It is only deployed to Polygon for the benefit of a specific use case pending the all-networks launch of Batch Relayer V3.

## Useful Files

- [Polygon addresses](./output/polygon.json)
- [`BalancerRelayer` ABI](./abi/BalancerRelayer.json)
- [`BatchRelayerLibrary` ABI](./abi/BatchRelayerLibrary.json)
