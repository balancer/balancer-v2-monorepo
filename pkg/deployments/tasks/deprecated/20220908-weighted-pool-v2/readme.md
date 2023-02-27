# 2022-09-08 - Weighted Pool Factory V2

> ⚠️ **DEPRECATED: do not use** ⚠️
> This deployment has been deprecated in favor of a new version with critical fixes: [weighted-pool-v3](../../20230206-weighted-pool-v3/).
> See this [forum post](https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345) for more details about the fixed vulnerability.


Deployment of the `WeightedPoolFactory`, which allows creating Weighted Pools which include a number of improvements, including:

- Optimized `FixedPoint.powDown` for cheaper swaps in common token weight ratios.
- Paying protocol fees in BPT.
- Awareness of yield-bearing tokens.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [BSC mainnet addresses](./output/bsc.json)
- [Gnosis mainnet addresses](./output/gnosis.json)
- [Goerli testnet addresses](./output/goerli.json)
- [`WeightedPoolFactory` artifact](./artifact/WeightedPoolFactory.json)
