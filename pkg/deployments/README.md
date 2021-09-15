# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Deployments

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-deployments.svg)](https://www.npmjs.org/package/@balancer-labs/v2-deployments)
[![GitHub Repository](https://img.shields.io/badge/github-deployments-lightgrey?logo=github)](https://github.com/balancer-labs/balancer-v2-monorepo/tree/deployments-latest/pkg/deployments)

This package contains the addresses and ABIs of all Balancer V2 deployed contracts, for Ethereum, Polygon and Arbitrum mainnet, as well as various test networks. Each deployment consists of a deployment script (called 'task'), inputs (script configuration, such as dependencies), outputs (typically contract addresses), and ABIs of related contracts.

Addresses and ABIs can be used consumed from the package in JavaScript environments, or manually retrieved from the [GitHub](https://github.com/balancer-labs/balancer-v2-monorepo/tree/deployments-latest/pkg/deployments) repository.

Note that some protocol contracts are created dynamically: for example, `WeightedPool` contracts are deployed by the canonical `WeightedPoolFactory`. While the ABIs of these contracts are stored in the `abi` directory of each deployment, their addresses are not. Those can be retrieved by querying the on-chain state or processing emitted events.

## Overview

### Installation

```console
$ npm install @balancer-labs/v2-deployments
```

### Usage

Import `@balancer-labs/v2-deployments` to access the different ABIs and deployed addresses. To see all Task IDs and their associated contracts, head to [Past Deployments](#past-deployments).

---

- **async function getBalancerContract(taskID, contract, network)**

Returns an [Ethers](https://docs.ethers.io/v5/) contract object for a canonical deployment (e.g. the Vault, or a Pool factory).

_Note: requires using [Hardhat](https://hardhat.org/) with the [`hardhat-ethers`](https://hardhat.org/plugins/nomiclabs-hardhat-ethers.html) plugin._

- **async function getBalancerContractAt(taskID, contract, address)**

Returns an [Ethers](https://docs.ethers.io/v5/) contract object for a contract dynamically created at a known address (e.g. a Pool created from a factory).

_Note: requires using [Hardhat](https://hardhat.org/) with the [`hardhat-ethers`](https://hardhat.org/plugins/nomiclabs-hardhat-ethers.html) plugin._

- **async function getBalancerContractAbi(taskID, contract)**

Returns a contract's [ABI](https://docs.soliditylang.org/en/latest/abi-spec.html).

- **async function getBalancerContractBytecode(taskID, contract)**

Returns a contract's [creation code](https://docs.soliditylang.org/en/latest/contracts.html#creating-contracts).

- **async function getBalancerContractAddress(taskID, contract, network)**

Returns the address of a contract's canonical deployment.

- **async function getBalancerDeployment(taskID, network)**

Returns an object with all contracts from a deployment and their addresses.

## Past Deployments

| Description                                      | Task ID                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Authorizer, governance contract                  | [`20210418-authorizer`](./tasks/20210418-authorizer)                                     |
| Vault, main protocol contract                    | [`20210418-vault`](./tasks/20210418-vault)                                               |
| Weighted Pools of up to 8 tokens                 | [`20210418-weighted-pool`](./tasks/20210418-weighted-pool)                               |
| Weighted Pools with two tokens and price oracle  | [`20210418-weighted-pool`](./tasks/20210418-weighted-pool)                               |
| Liquidity Bootstrapping Pools of up to 4 tokens  | [`20210721-liquidity-bootstrapping-pool`](./tasks/20210721-liquidity-bootstrapping-pool) |
| Stable Pools of up to 5 tokens                   | [`20210624-stable-pool`](./tasks/20210624-stable-pool)                                   |
| Meta Stable Pools with 2 tokens and price oracle | [`20210727-meta-stable-pool`](./tasks/20210727-meta-stable-pool)                         |
| Relayer for Lido stETH wrapping/unwrapping       | [`20210812-lido-relayer`](./tasks/20210812-lido-relayer)                                 |
| Distributor contract for LDO rewards             | [`20210811-ldo-merkle`](./tasks/20210811-ldo-merkle)                                     |
| Rate Provider for wstETH                         | [`20210812-wsteth-rate-provider`](./tasks/20210812-wsteth-rate-provider)                 |
| Distributor contract for arbitrum BAL rewards    | [`20210913-bal-arbitrum-merkle`](./tasks/20210913-bal-arbitrum-merkle)                   |
