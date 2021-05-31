# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Weighted Pools

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-pool-weighted.svg)](https://www.npmjs.org/package/@balancer-labs/v2-pool-weighted)

This package contains the source code for Balancer V2 Weighted Pools, that is, Pools that swap tokens by enforcing a Constant Weighted Product invariant.

The two flavors currently in existence are [`WeightedPool`](./contracts/WeightedPool.sol) (basic eight token version) and [`WeightedPool2Tokens`](./contracts/WeightedPool2Tokens.sol) (limited to two tokens, but supporting price oracles).

Other useful contracts include [`WeightedMath`](./contracts/WeightedMath.sol), which implements the low level calculations required for swaps, joins, exits and price calculations, and [`IPriceOracle`](./contracts/IPriceOracle.sol), used to make price oracle queries.

## Overview

### Installation

```console
$ npm install @balancer-labs/v2-pool-weighted
```

### Usage

This package can be used in multiple ways, including interacting with already deployed Pools, performing local testing, or even create new Pool types that also use the Constant Weighted Product invariant.

To get the address of deployed contracts in both mainnet and various test networks, see [`v2-deployments`](../deployments).

Sample contract that performs an action conditionally using a Pool as a price oracle:

```solidity
pragma solidity ^0.7.0;

import "@balancer-labs/v2-pool-weighted/contracts/IPriceOracle.sol";

contract SimpleOracleQuery {
    IPriceOracle private constant oracle = "0x0b09deA16768f0799065C475bE02919503cB2a35"; // WETH-DAI Pool

    function performAction() external {
      IPriceOracle.OracleAverageQuery[] memory queries = new IPriceOracle.OracleAverageQuery[](1);

      // Average price over the last hour
      queries[0] = IPriceOracle.OracleAverageQuery({
        variable: IPriceOracle.Variable.PAIR_PRICE,
        secs: 3600,
        ago: 0
      });

      uint256[] memory results = oracle.getTimeWeightedAverage(queries);
      if (results[0] >= 4000) {
        ...
      } else {
        ...
      }
    }
}
```

Sample Weighted Pool that computes weights dynamically on every swap, join and exit:

```solidity
pragma solidity ^0.7.0;

import '@balancer-labs/v2-pool-weighted/contracts/BaseWeightedPool.sol';

contract DynamicWeightedPool is BaseWeightedPool {
    uint256 private immutable _creationTime;

    constructor() {
        _creationTime = block.timestamp;
    }

    function _getNormalizedWeights() internal view override returns (uint256[] memory);
        uint256[] memory weights = new uint256[](2);

        // Change weights from 50-50 to 30-70 one month after deployment
        if (block.timestamp < (_creationTime + 1 month)) {
          weights[0] = 0.5e18;
          weights[1] = 0.5e18;
        } else {
          weights[0] = 0.3e18;
          weights[1] = 0.7e18;
        }

        return weights;
    }

    ...
}

```

## Licensing

[GNU General Public License Version 3 (GPL v3)](../../LICENSE).
