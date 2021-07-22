# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Deployments

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-deployments.svg)](https://www.npmjs.org/package/@balancer-labs/v2-deployments)

This package contains the addresses and ABIs of all Balancer V2 deployed contracts, for Ethereum and Polygon mainnet, as well as various test networks. Each deployment consists of a deployment script (called 'task'), inputs (script configuration, such as dependencies), outputs (typically contract addresses), and ABIs of related contracts. All tasks are found in the [`tasks`](./tasks) directory, where each subdirectory represents an individual deployment.

Note that some protocol contracts are created dynamically: for example, `WeightedPool` contracts are deployed by the canonical `WeightedPoolFactory`. While the ABIs of these contracts are stored in the `abi` directory of each deployment, their addresses are not. Those can be retrieved by querying the on-chain state or processing emitted events.

## Past Deployments

- [`Authorizer`: the governance contract](./tasks/20210418-authorizer)
- [`Vault`: main protocol contract](./tasks/20210418-vault)
- Pool factories:
  - [Weighted Pools of up to 8 tokens](./tasks/20210418-weighted-pool)
  - [Weighted Pools with two tokens and price oracle](./tasks/20210418-weighted-pool)
  - [Liquidity Bootstrapping Pools of up to 4 tokens](./tasks/20210721-liquidity-bootstrapping-pool)
  - [Stable Pools of up to 5 tokens](./tasks/20210624-stable-pool)
