# 2022-06-09 - Stable Pool V2

Deployment of a new version of `StablePoolFactory` corresponding to the [Phase I milestone](https://github.com/balancer-labs/balancer-v2-monorepo/milestone/13) of the re-release of Stable Pools, including features such as:

- a wider invariant convergence range, preventing failures in case of tokens de-pegging
- introduction of Recovery Mode, which ensures LPs will always be able to exit the Pool, even under extreme failure conditions
- miscellaneous bug fixes

## Useful Files

- [Ethereum addresses](./output/mainnet.json)
- [Polygon addresses](./output/polygon.json)
- [Arbitrum addresses](./output/arbitrum.json)
- [Optimism addresses](./output/optimism.json)
- [`StablePool` ABI](./abi/StablePool.json)
- [`StablePoolFactory` ABI](./abi/StablePoolFactory.json)
