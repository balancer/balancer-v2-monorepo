# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer.js SDK

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/balancer-js.svg)](https://www.npmjs.org/package/@balancer-labs/balancer-js)

Balancer.js is a JavaScript SDK which provides commonly used utilties for interacting with Balancer Protocol V2.

## Overview

### Installation

```console
$ npm install @balancer-labs/balancer-js
```

### Usage

Some examples of common uses for Balancer.js are shown below

#### Pool ID decoding

Each Balancer pool is referenced by its own unique pool ID. This ID contains various information about the pool which is in an encoded form. Balancer.js exposes functions to easily extract various information from this ID.

Sample code that calculates a pool's address from it's pool ID to allow approving another address to move the user's BPT:

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

To provide liquidity to a Balancer pool, various fields must be provided in an encoded form as the `userData` field within the `joinPool` call. Balancer.js exposes functions to simplify encoding the `userData` field used for joining and exiting various pool types to prevent errors.

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
