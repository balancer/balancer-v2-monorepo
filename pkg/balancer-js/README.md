# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer.js SDK

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/balancer-js.svg)](https://www.npmjs.org/package/@balancer-labs/balancer-js)

Balancer.js is a JavaScript SDK which provides commonly used utilities for interacting with the V2 Balancer Protocol. It is especially useful for working with different kinds of data that must be supplied in encoded form, such as the `userData` for joins and exits, or extracting information from data encoded by the protocol, such as the Pool IDs. Each subdirectory contains utilities for working with a particular module. Utils contains general utilities, such as helpers for working with signatures, and mapping encoded smart contract error codes to text.

## Overview

### Installation

```console
$ npm install @balancer-labs/balancer-js
```

### Usage

Some examples of common uses for Balancer.js are shown below

#### Pool ID decoding

Each Balancer pool is referenced by its own unique pool ID. This ID contains various information about the pool in an encoded form. Balancer.js exposes functions to easily extract various information from this ID.

Sample code that calculates a pool's address from its pool ID to allow approving another address to move the user's BPT:

```typescript
import { getPoolAddress } from "@balancer-labs/balancer-js";
import { IERC20Abi } from ./IERC20.json

const poolId = "0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014"
const poolAddress = getPoolAddress(poolId)
// poolAddress = "0x5c6ee304399dbdb9c8ef030ab642b10820db8f56"
const bptToken = new Contract(poolAddress, IERC20Abi, provider)

await bptToken.approve("0x012345....", "10000")

```

#### Encoding userData

To provide liquidity to a Balancer pool, various fields must be provided in an encoded form as the `userData` field within the `joinPool` call. Balancer.js exposes functions to simplify encoding the `userData` field used for joining and exiting various pool types to prevent errors. Similar utilities are available for `exitPool`. Note that different pool types may support a different set of join and exit calls, so make sure you're using the correct encoder.

Sample code that provides the initial liquidity to a WeightedPool:

```typescript
import { WeightedPoolEncoder } from "@balancer-labs/balancer-js";

const poolId = "0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014"
const tokens = ["0x012345....", "0x789ABC...."]
const amountsIn = [BigNumber.from("10000"), BigNumber.from("10000")];

const tx = await vault.joinPool(
    poolId,
    userAddress,
    userAddress,
    {
        assets: tokens,
        maxAmountsIn: amountsIn,
        fromInternalBalance: true,
        userData: WeightedPoolEncoder.joinInit(amountsIn),
    }
);
```



## Licensing

[GNU General Public License Version 3 (GPL v3)](../../LICENSE).
