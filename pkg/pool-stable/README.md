# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Stable Pools

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-pool-stable.svg)](https://www.npmjs.org/package/@balancer-labs/v2-pool-stable)

# 🚧 UNDER CONSTRUCTION 🚧

Files in this directory **are not** production-ready, have not been audited by a security firm, and **could contain security issues or logic errors**. Use at your own risk.

---

This package contains the source code of Balancer V2 Stable Pools, that is, Pools for tokens that all have values very close to each other (typically stablecoins).

The only flavor currently in existence is [`StablePool`](./contracts/StablePool.sol) (basic five token version).

Another useful contract is [`StableMath`](./contracts/StableMath.sol), which implements the low level calculations required for swaps, joins and exits.
