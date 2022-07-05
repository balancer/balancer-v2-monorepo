# 2022-xxxx - Preminted BPT Meta Stable Pool

Deployment a new version of `StablePhantomPoolFactory`, for Meta Stable Pools with preminted BPT of up to 5 tokens, including features such as:

- a wider invariant convergence range, preventing failures in case of tokens de-pegging
- introduction of Recovery Mode, which ensures LPs will always be able to exit the Pool, even under extreme failure conditions
- support for multi-token joins and exits
- support for single-token joins and exits via the join/exit interface (on top of the swap interface support)
- streamlined protocol fee collection
- miscellaneous bug fixes

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet address](./output/arbitrum.json)
- [Optimism mainnet address](./output/optimism.json)
- [`StablePhantomPool` ABI](./abi/StablePhantomPool.json)
