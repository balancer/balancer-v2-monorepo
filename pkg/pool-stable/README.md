# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Stable Pools

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-pool-stable.svg)](https://www.npmjs.org/package/@balancer-labs/v2-pool-stable)

---

This package contains the source code of Balancer V2 Stable Pools, that is, Pools for tokens that all have values very close to each other (typically stablecoins).

The only flavor currently in existence is [`ComposableStablePool`](./contracts/ComposableStablePool.sol) (basic five token version).

Another useful contract is [`StableMath`](../pool-stable/contracts/StableMath.sol), which implements the low level calculations required for swaps, joins and exits.
