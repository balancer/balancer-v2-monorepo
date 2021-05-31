# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Weighted Pools

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-pool-weighted.svg)](https://www.npmjs.org/package/@balancer-labs/v2-pool-weighted)

This package contains the source code for Balancer V2 Weighted Pools, that is, Pools that swap tokens by enforcing a Constant Weighted Product invariant.

The two flavors currently in existence are [`WeightedPool`](./contracts/WeightedPool.sol) (basic eight token version) and [`WeightedPool2Tokens`](./contracts/WeightedPool2Tokens.sol) (limited to two tokens, but supporting price oracles).

Other useful contracts include [`WeightedMath`](./contracts/WeightedMath.sol), which implements the low level calculations required for swaps, joins, exits and price calculations, and [`IPriceOracle`](./contracts/IPriceOracle.sol), used to make price oracle queries.
