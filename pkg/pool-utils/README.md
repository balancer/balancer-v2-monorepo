# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Pool Utilities

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-pool-utils.svg)](https://www.npmjs.org/package/@balancer-labs/v2-pool-utils)
[![Docs](https://img.shields.io/badge/docs-%F0%9F%93%84-blue)](https://docs.balancer.fi/concepts/pools/#pools)

This package contains Solidity utilities for developing Balancer V2 Pools, implementing common patterns such as token decimal scaling, caller checks on hooks, etc.

The most useful contracts are [`BaseGeneralPool`](./contracts/BaseGeneralPool.sol) and [`BaseMinimalSwapInfoPool`](./contracts/BaseMinimalSwapInfoPool.sol), used as base contracts for Pools with the General and MinimalSwapInfo/TwoTokens specializations respectively.

The recommended pattern is to create new Pools from factory contracts, as that lets other systems reason about Pool logic by checking whether a Pool was deployed from a given factory. [`BasePoolFactory`](./contracts/factories/BasePoolFactory.sol) can be used for this purpose.

## Overview

### Installation

```console
$ npm install @balancer-labs/v2-pool-utils
```

### Usage

Contracts in this package are meant to be used via inheritance to develop new Pools. The [`BaseGeneralPool`](./contracts/BaseGeneralPool.sol) and [`BaseMinimalSwapInfoPool`](./contracts/BaseMinimalSwapInfoPool.sol) contracts are `abstract`, meaning some `virtual` functions (such as `_onJoinPool` or `_onSwapGivenIn`) are not defined: derived contracts must `override` them and provide an implementation.

See [`v2-pool-weighted`](../pool-weighted) for the implementation of Pools with a Constant Weighted Product invariant using these base contracts.

## Licensing

[GNU General Public License Version 3 (GPL v3)](../../LICENSE).
