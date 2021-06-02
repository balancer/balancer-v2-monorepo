# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Deployments

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-deployments.svg)](https://www.npmjs.org/package/@balancer-labs/v2-deployments)

This package contains the addresses and ABIs of all Balancer V2 deployed contracts, for mainnet and various test networks. Artifacts are found in the [`deployed`](./deployed) directory, where each subdirectory represents a network.

Note that some protocol contracts are created dynamically: for example, `WeightedPool` contracts are deployed by the canonical `WeightedPoolFactory`. The ABIs of these contracts are stored in the [`extra-abis`](./extra-abis) directory, but their addresses are not. Those should be instead retrieved by querying the on-chain state, or processing emitted events.

## Overview

### Installation

```console
$ npm install @balancer-labs/v2-deployments
```

### Usage

Using [Hardhat](https://hardhat.org/):

```typescript
import { ethers } from 'hardhat';
import { Contract } from 'ethers';

// Creates an ethers Contract object for a canonical contract deployed at a network
export function getBalancerDeployedContract(
  contract: string,
  network: string
): Promise<Contract> {
  const {
    abi,
    address,
  } = require(`@balancer-labs/v2-deployments/deployed/${network}/${contract}.json`);
  return ethers.getContractAt(abi, address);
}

// Creates an ethers Contract object from a dynamically created contract at a known address
export function getBalancerContractAtAddress(
  contract: string,
  address: string
): Promise<Contract> {
  const {
    abi,
  } = require(`@balancer-labs/v2-deployments/extra-abis/${contract}.json`);
  return ethers.getContractAt(abi, address);
}
```
