# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Weighted Pools

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-pool-weighted.svg)](https://www.npmjs.org/package/@balancer-labs/v2-pool-weighted)

This package contains the source code for Balancer V2 Weighted Pools, that is, Pools that swap tokens by enforcing a Constant Weighted Product invariant.

The pool currently in existence is [`WeightedPool`](./contracts/WeightedPool.sol) (basic twenty token version).

There are subdirectories for common variants, which automatically updates some of their attributes to support more complex use cases. Examples are [`LiquidityBootstrappingPool`](./contracts/lbp/LiquidityBootstrappingPool.sol) for auction-like mechanisms, and [`ManagedPool`](./contracts/managed/ManagedPool.sol) for managed portfolios.

The `lib` directory contains internal and external common libraries, such as [`CircuitBreakerLib`](./contracts/lib/CircuitBreakerLib.sol).

| :warning: | Managed Pools are still undergoing development and may contain bugs and/or change significantly. |
| --------- | :-------------------------------------------------------------------------------------------------- |

Another useful contract is [`WeightedMath`](./contracts/WeightedMath.sol), which implements the low level calculations required for swaps, joins, exits and price calculations.

## Overview

### Installation

```console
$ npm install @balancer-labs/v2-pool-weighted
```

### Usage

This package can be used in multiple ways, including interacting with already deployed Pools, performing local testing, or even creating new Pool types that also use the Constant Weighted Product invariant.

To get the address of deployed contracts in both mainnet and various test networks, see [`balancer-deployments` repository](https://github.com/balancer/balancer-deployments).

Sample Weighted Pool that computes weights dynamically on every swap, join and exit:

```solidity
pragma solidity ^0.7.0;

import '@balancer-labs/v2-pool-weighted/contracts/BaseWeightedPool.sol';

contract DynamicWeightedPool is BaseWeightedPool {
    uint256 private immutable _creationTime;

    constructor() {
        _creationTime = block.timestamp;
    }

    function _getNormalizedWeightsAndMaxWeightIndex() internal view override returns (uint256[] memory) {
        uint256[] memory weights = new uint256[](2);

        // Change weights from 50-50 to 30-70 one month after deployment
        if (block.timestamp < (_creationTime + 1 month)) {
          weights[0] = 0.5e18;
          weights[1] = 0.5e18;
        } else {
          weights[0] = 0.3e18;
          weights[1] = 0.7e18;
        }

        return (weights, 1);
    }

    ...
}

```

## Licensing

[GNU General Public License Version 3 (GPL v3)](../../LICENSE).
