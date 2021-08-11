# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Deployments

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-deployments.svg)](https://www.npmjs.org/package/@balancer-labs/v2-deployments)
[![GitHub Repository](https://img.shields.io/badge/github-master-lightgrey?logo=github)](https://github.com/balancer-labs/balancer-v2-monorepo/tree/master/pkg/deployments)

This package contains the addresses and ABIs of all Balancer V2 deployed contracts, for Ethereum and Polygon mainnet, as well as various test networks. Each deployment consists of a deployment script (called 'task'), inputs (script configuration, such as dependencies), outputs (typically contract addresses), and ABIs of related contracts. All tasks are found in the [`tasks`](./tasks) directory, where each subdirectory represents an individual deployment.

Note that some protocol contracts are created dynamically: for example, `WeightedPool` contracts are deployed by the canonical `WeightedPoolFactory`. While the ABIs of these contracts are stored in the `abi` directory of each deployment, their addresses are not. Those can be retrieved by querying the on-chain state or processing emitted events.

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

// Creates an ethers Contract object for a canonical contract deployed on a specific network
export function getBalancerDeployedContract(
  task: string,
  contract: string,
  network: string
): Promise<Contract> {
  const contracts = require(`@balancer-labs/v2-deployments/tasks/${task}/output/${network}.json`);
  const address = contracts[contract];

  return getBalancerContractAtAddress(task, contract, address);
}

// Creates an ethers Contract object from a dynamically created contract at a known address
export function getBalancerContractAtAddress(
  task: string,
  contract: string,
  address: string
): Promise<Contract> {
  const {
    abi,
  } = require(`@balancer-labs/v2-deployments/tasks/${task}/abi/${contract}.json`);
  return ethers.getContractAt(abi, address);
}
```

## Past Deployments

| Description                                     | Task ID                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Authorizer, governance contract                 | [`20210418-authorizer`](./tasks/20210418-authorizer)                                     |
| Vault, main protocol contract                   | [`20210418-vault`](./tasks/20210418-vault)                                               |
| Weighted Pools of up to 8 tokens                | [`20210418-weighted-pool`](./tasks/20210418-weighted-pool)                               |
| Weighted Pools with two tokens and price oracle | [`20210418-weighted-pool`](./tasks/20210418-weighted-pool)                               |
| Liquidity Bootstrapping Pools of up to 4 tokens | [`20210721-liquidity-bootstrapping-pool`](./tasks/20210721-liquidity-bootstrapping-pool) |
| Stable Pools of up to 5 tokens                  | [`20210624-stable-pool`](./tasks/20210624-stable-pool)                                   |
