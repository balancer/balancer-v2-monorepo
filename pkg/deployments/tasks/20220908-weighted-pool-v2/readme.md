# 2022-09-08 - Weighted Pool Factory V2

Deployment of the `WeightedPoolFactory`, which allows creating Weighted Pools which include a number of improvements, including:

- Optimized `FixedPoint.powDown` for cheaper swaps in common token weight ratios.
- Paying protocol fees in BPT.
- Awareness of yield-bearing tokens.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon addresses](./output/polygon.json)
- [Arbitrum addresses](./output/arbitrum.json)
- [Optimism addresses](./output/optimism.json)
- [`WeightedPool` ABI](./abi/WeightedPool.json)
- [`WeightedPoolFactory` ABI](./abi/WeightedPoolFactory.json)
