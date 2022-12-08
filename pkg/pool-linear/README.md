# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Linear Pools

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-pool-linear.svg)](https://www.npmjs.org/package/@balancer-labs/v2-pool-linear)

This package contains the source code of Balancer V2 Linear Pools. These are three-token pools which contain "Main" and "Wrapped" tokens, where the wrapped token is typically yield-bearing: e.g., USDC and aUSDC. The third token is the BPT itself, enabling "joins" and "exits" to be performed as part of a batch swap. As described below, Linear Pools are most often used as components of "Boosted Pools".

## Overview

### Installation

```console
$ npm install @balancer-labs/v2-pool-linear
```

### Usage

Linear Pools are not designed to be used independently, or accessed directly by end users. Rather, they are typically components of other pools, mainly as constituents of a `ComposableStablePool`, which enables the "Boosted Pool" behavior.

See [`v2-pool-stable`](../pool-stable) for the implementation of ComposableStablePool.

## Licensing

[GNU General Public License Version 3 (GPL v3)](../../LICENSE).
