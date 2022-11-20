# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Stable Pools

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-pool-stable.svg)](https://www.npmjs.org/package/@balancer-labs/v2-pool-stable)

---

This package contains the source code of Balancer V2 Stable Pools, that is, Pools for tokens that all have values very close to each other (typically stablecoins).

The only flavor currently in existence is [`ComposableStablePool`](./contracts/ComposableStablePool.sol) (basic five token version).

Another useful contract is [`StableMath`](../pool-stable/contracts/StableMath.sol), which implements the low level calculations required for swaps, joins and exits.

### Deprecations

The following stable pool deployments have been deprecated.

| Description                                      | Task ID                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Stable Pools of up to 5 tokens (original)        | [`20210624-stable-pool`](./tasks/deprecated/20210624-stable-pool)                                   |
| Stable Pools V2 of up to 5 tokens ("phantom")    | [`20220609-stable-pool-v2`](./tasks/20220609-stable-pool-v2)                                        |
| Composable Stable Pools (unused)                 | `20220817-composable-stable-pool` - this was updated, renamed, and deployed as -0906                |
| Composable Stable Pools                          | [`20220906-composable-stable-pool`](./tasks/deprecated/20220906-composable-stable-pool)             |
