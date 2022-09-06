# 2022-09-08 - Weighted Pool Factory V2

Deployment of the `WeightedPoolFactory`, which allows creating Weighted Pools which include a number of improvements over [20210418-weighted-pool](../20210418-weighted-pool), including

- Optimized `FixedPoint.powDown` for cheaper swaps in common token weight ratios.
- Paying protocol fees in BPT.
- Awareness of yield-bearing tokens.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [`WeightedPool` ABI](./abi/WeightedPool.json)
- [`WeightedPoolFactory` ABI](./abi/WeightedPoolFactory.json)
