# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Linear Pools

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-pool-linear.svg)](https://www.npmjs.org/package/@balancer-labs/v2-pool-linear)
[![Docs](https://img.shields.io/badge/docs-%F0%9F%93%84-blue)](https://docs.balancer.fi/concepts/pools/boosted.html#boosted-pools)

This package contains the source code of Balancer V2 Linear Pools. These are three-token pools which contain "Main" and "Wrapped" tokens, where the wrapped token is typically yield-bearing: e.g., USDC and aUSDC. The third token is the BPT itself, enabling "joins" and "exits" to be performed as part of a batch swap.

Linear Pools are not designed to be accessed directly by end users. Rather, they are typically components of other pools, mainly as constituents of a `ComposableStablePool`, which enables the ["Boosted Pool"](https://docs.balancer.fi/concepts/pools/boosted.html#boosted-pools) behavior.

## Overview

### Installation

```console
$ npm install @balancer-labs/v2-pool-linear
```

### Usage

This package includes the [`LinearPool`](./contracts/LinearPool.sol) base condtract. Derived Linear Pool that integrate with the [Aave Protocol](https://aave.com/) and hold [aTokens](https://docs.aave.com/developers/tokens/atoken) as their "Wrapped" token can be found in the [Orb Collective repo](https://github.com/orbcollective/linear-pools).

However, some users might want to develop their own kind of Linear Pool, potentially integrating with a different protocol. In order to do this, you must inherit the [`LinearPool`](./contracts/LinearPool.sol) contract and implement the `_getWrappedTokenRate()` function:

```solidity
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import '@balancer-labs/v2-pool-linear/contracts/LinearPool.sol';

contract CustomLinearPool is LinearPool {
  /**
   * @dev Returns a 18-decimal fixed point value that represents the value of the wrapped token in terms of the main
   * token. The final wrapped token scaling factor is this value multiplied by the wrapped token's decimal scaling
   * factor.
   *
   * WARNING: care must be take if calling external contracts from here, even `view` or `pure` functions. If said
   * calls revert, any revert data must not be bubbled-up directly but instead passed to `bubbleUpNonMaliciousRevert`
   * from `ExternalCallLib` (located in the `v2-pool-utils` package). See the following example:
   *
   *  try externalContract.someCall() returns (uint256 value) {
   *    return value;
   *  } catch (bytes memory revertData) {
   *    // Don't automatically bubble-up revert data.
   *    ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
   *  }
   */
  function _getWrappedTokenRate() internal view override returns (uint256) {}
}

```

_Note: this example is missing some details, like calling the constructor of `LinearPool`._

Additionally, users might want to also take advantage of the [`LinearPoolRebalancer`](./contracts/LinearPoolRebalancer.sol) contract to have a simple, permissionless and highly efficient way of rebalancing their Pools.

To do this, inherit from `LinearPoolRebalancer` and implement the `_wrapTokens`, `_unwrapTokens` and `_getRequiredTokensToWrap` functions. See [`AaveLinearPoolRebalancer`](https://github.com/orbcollective/linear-pools/blob/master/pkg/linear-pools/contracts/aave-v2-linear-pool/AaveLinearPoolRebalancer.sol) for an example.

## Licensing

[GNU General Public License Version 3 (GPL v3)](../../LICENSE).
