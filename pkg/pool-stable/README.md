# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Stable Pools

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-pool-stable.svg)](https://www.npmjs.org/package/@balancer-labs/v2-pool-stable)

This package contains the source code of Balancer V2 Stable Pools, that is, Pools for tokens that all have values very close to each other (typically stablecoins).

The only flavor currently in existence is [`ComposableStablePool`](./contracts/ComposableStablePool.sol). This is a 5-token stable pool that also contains its own BPT, which enables single-token joins and exits to be performed as part of a batch swap, while still supporting multi-token joins and exits.

Another useful contract is [`StableMath`](../pool-stable/contracts/StableMath.sol), which implements the low level calculations required for swaps, joins and exits.

## Overview

### Installation

```console
$ npm install @balancer-labs/v2-pool-stable
```

### Usage

This package can be used in multiple ways, including interacting with already deployed Pools, performing local testing, or even creating new Pool types that also use the Stable Math invariant.

To get the address of deployed contracts in both mainnet and various test networks, see [`balancer-deployments` repository](https://github.com/balancer/balancer-deployments).

Sample Stable Pool that adds a proportional join.

```solidity
pragma solidity ^0.7.0;

import '@balancer-labs/v2-pool-stable/contracts/ComposableStablePool.sol';

contract ProportionalJoinStablePool is ComposableStablePool {
    ...

    /**
     * @dev Example of extending a stable pool to use an additional join type.
     * Pretending it is virtual for this example.
     */
    function _doJoin(
        uint256[] memory balances,
        uint256 currentAmp,
        uint256 preJoinExitSupply,
        uint256 preJoinExitInvariant,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal view override returns (uint256, uint256[] memory) {
        StablePoolUserData.JoinKind kind = userData.joinKind();

        if (kind == StablePoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {
            return _joinAllTokensInForExactBptOut(preJoinExitSupply, balances, userData);
        } else if (kind == StablePoolUserData.JoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT) {
            return super._doJoin(balances, currentAmp, preJoinExitSupply, preJoinExitInvariant, scalingFactors, userData);
        }
    }

    ...
}

```

## Licensing

[GNU General Public License Version 3 (GPL v3)](../../LICENSE).
