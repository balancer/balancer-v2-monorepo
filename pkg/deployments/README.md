# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Deployments

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-deployments.svg)](https://www.npmjs.org/package/@balancer-labs/v2-deployments)
[![GitHub Repository](https://img.shields.io/badge/github-deployments-lightgrey?logo=github)](https://github.com/balancer-labs/balancer-v2-monorepo/tree/deployments-latest/pkg/deployments)

This package contains the addresses and ABIs of all Balancer V2 deployed contracts, for Ethereum, Polygon, Arbitrum and Optimism mainnet, as well as various test networks. Each deployment consists of a deployment script (called 'task'), inputs (script configuration, such as dependencies), outputs (typically contract addresses), and ABIs of related contracts.

Addresses and ABIs can be consumed from the package in JavaScript environments, or manually retrieved from the [GitHub](https://github.com/balancer-labs/balancer-v2-monorepo/tree/master/pkg/deployments) repository.

Note that some protocol contracts are created dynamically: for example, `WeightedPool` contracts are deployed by the canonical `WeightedPoolFactory`. While the ABIs of these contracts are stored in the `abi` directory of each deployment, their addresses are not. Those can be retrieved by querying the on-chain state or processing emitted events.

## Overview

### Deploying Contracts

For more information on how to create new deployments or run existing ones in new networks, head to the [deployment guide](DEPLOYING.md).

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

## Active Deployments

| Description                                             | Task ID                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Authorizer, governance contract                         | [`20210418-authorizer`](./tasks/20210418-authorizer)                                                 |
| Vault, main protocol contract                           | [`20210418-vault`](./tasks/20210418-vault)                                                           |
| Weighted Pools of up to 8 tokens                        | [`20210418-weighted-pool`](./tasks/20210418-weighted-pool)                                           |
| Rate Provider for wstETH                                | [`20210812-wsteth-rate-provider`](./tasks/20210812-wsteth-rate-provider)                             |
| Authorizer Adaptor for extending governance             | [`20220325-authorizer-adaptor`](./tasks/20220325-authorizer-adaptor)                                 |
| Wallet for the BAL token                                | [`20220325-bal-token-holder-factory`](./tasks/20220325-bal-token-holder-factory)                     |
| Admin of the BAL token                                  | [`20220325-balancer-token-admin`](./tasks/20220325-balancer-token-admin)                             |
| Gauge Registrant                                        | [`20220325-gauge-adder`](./tasks/20220325-gauge-adder)                                               |
| Liquidity Mining: veBAL, Gauge Controller and Minter    | [`20220325-gauge-controller`](./tasks/20220325-gauge-controller)                                     |
| Mainnet Staking Gauges                                  | [`20220325-mainnet-gauge-factory`](./tasks/20220325-mainnet-gauge-factory)                           |
| Single Recipient Stakeless Gauges                       | [`20220325-single-recipient-gauge-factory`](./tasks/20220325-single-recipient-gauge-factory)         |
| Delegation of veBAL boosts                              | [`20220325-ve-delegation`](./tasks/20220325-ve-delegation)                                           |
| Linear Pools for ERC4626 Tokens V2                      | [`20220404-erc4626-linear-pool-v2`](./tasks/deprecated/20220404-erc4626-linear-pool-v2)              |
| Gauges on child networks (L2s and sidechains)           | [`20220413-child-chain-gauge-factory`](./tasks/20220413-child-chain-gauge-factory)                   |
| Arbitrum Root Gauges, for veBAL voting                  | [`20220413-arbitrum-root-gauge-factory`](./tasks/20220413-arbitrum-root-gauge-factory)               |
| Polygon Root Gauges, for veBAL voting                   | [`20220413-polygon-root-gauge-factory`](./tasks/20220413-polygon-root-gauge-factory)                 |
| veBAL Smart Wallet Checker                              | [`20220420-smart-wallet-checker`](./tasks/20220420-smart-wallet-checker)                             |
| Linear Pools for Unbutton tokens                        | [`20220425-unbutton-aave-linear-pool`](./tasks/20220425-unbutton-aave-linear-pool)                   |
| Relayer with the fix for the Double Entrypoint issue    | [`20220513-double-entrypoint-fix-relayer`](./tasks/20220513-double-entrypoint-fix-relayer)           |
| Protocol Fee Withdrawer                                 | [`20220517-protocol-fee-withdrawer`](./tasks/20220517-protocol-fee-withdrawer)                       |
| Child Chain Gauge Token Adder                           | [`20220527-child-chain-gauge-token-adder`](./tasks/20220527-child-chain-gauge-token-adder)           |
| Preseeded Voting Escrow Delegation                      | [`20220530-preseeded-voting-escrow-delegation`](./tasks/20220530-preseeded-voting-escrow-delegation) |
| Stable Pools V2 of up to 5 tokens                       | [`20220609-stable-pool-v2`](./tasks/20220609-stable-pool-v2)                                         |
| Gauge Registrant V2, supporting new networks            | [`20220628-gauge-adder-v2`](./tasks/20220628-gauge-adder-v2)                                         |
| Optimism Root Gauges, for veBAL voting                  | [`20220628-optimism-root-gauge-factory`](./tasks/20220628-optimism-root-gauge-factory)               |
| Distribution Scheduler for reward tokens on gauges      | [`20220707-distribution-scheduler`](./tasks/20220707-distribution-scheduler)                         |
| Fee Distributor for veBAL holders V2                    | [`20220714-fee-distributor-v2`](./tasks/20220714-fee-distributor-v2)                                 |
| Batch Relayer V3                                        | [`20220720-batch-relayer-v3`](./tasks/20220720-batch-relayer-v3)                                     |
| Swap, join and exit simulations (queries)               | [`20220721-balancer-queries`](./tasks/20220721-balancer-queries)                                     |
| Protocol fee percentages provider                       | [`20220725-protocol-fee-percentages-provider`](./tasks/20220725-protocol-fee-percentages-provider)   |
| Child Chain Gauge Reward Helper                         | [`20220812-child-chain-reward-helper`](./tasks/20220812-child-chain-reward-helper)                   |
| Linear Pools for Aave aTokens with built-in rebalancing | [`20220817-aave-rebalanced-linear-pool`](./tasks/20220817-aave-rebalanced-linear-pool)               |
| Composable Stable Pools                                 | [`20220817-composable-stable-pool`](./tasks/20220817-composable-stable-pool)                         |

## Scripts

These are deployments for script-like contracts (often called 'coordinators') which are typically granted some permission by Governance and then executed, after which they become useless.

| Description                                         | Task ID                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Coordination of the veBAL deployment                | [`20220325-veBAL-deployment-coordinator`](./tasks/scripts/20220325-veBAL-deployment-coordinator)           |
| Coordination of setup of L2 gauges for veBAL system | [`20220415-veBAL-L2-gauge-setup-coordinator`](./tasks/scripts/20220415-veBAL-L2-gauge-setup-coordinator)   |
| Coordination of veBAL gauges fix (Option 1)         | [`20220418-veBAL-gauge-fix-coordinator`](./tasks/scripts/20220418-veBAL-gauge-fix-coordinator)             |
| veBAL Smart Wallet Checker Coordinator              | [`20220421-smart-wallet-checker-coordinator`](./tasks/scripts/20220421-smart-wallet-checker-coordinator)   |
| Tribe BAL Minter Coordinator                        | [`20220606-tribe-bal-minter-coordinator`](./tasks/scripts/20220606-tribe-bal-minter-coordinator)           |
| Coordination of the double entrypoint issue fix     | [`20220610-snx-recovery-coordinator`](./tasks/scripts/20220610-snx-recovery-coordinator)                   |
| Coordination of the Gauge Adder migration           | [`20220721-gauge-adder-migration-coordinator`](./tasks/scripts/20220721-gauge-adder-migration-coordinator) |

## Deprecated Deployments

These deployments have been deprecated because they're either outdated and have been replaced by newer versions, or because they no longer form part of the current infrastructure. **In almost all cases they should no longer be used,** and are only kept here for historical reasons.

Go to each deprecated deployment's readme file to learn more about why it is deprecated, and what the replacement deployment is (if any).

| Description                                      | Task ID                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Stable Pools of up to 5 tokens                   | [`20210624-stable-pool`](./tasks/deprecated/20210624-stable-pool)                                   |
| Liquidity Bootstrapping Pools of up to 4 tokens  | [`20210721-liquidity-bootstrapping-pool`](./tasks/deprecated/20210721-liquidity-bootstrapping-pool) |
| Meta Stable Pools with 2 tokens and price oracle | [`20210727-meta-stable-pool`](./tasks/deprecated/20210727-meta-stable-pool)                         |
| Distributor contract for LDO rewards             | [`20210811-ldo-merkle`](./deprecated/tasks/deprecated/20210811-ldo-merkle)                          |
| Relayer for Lido stETH wrapping/unwrapping       | [`20210812-lido-relayer`](./tasks/deprecated/20210812-lido-relayer)                                 |
| Basic Investment Pools for few tokens            | [`20210907-investment-pool`](./tasks/deprecated/20210907-investment-pool)                           |
| Distributor contract for arbitrum BAL rewards    | [`20210913-bal-arbitrum-merkle`](./tasks/deprecated/20210913-bal-arbitrum-merkle)                   |
| Distributor contract for arbitrum MCB rewards    | [`20210928-mcb-arbitrum-merkle`](./tasks/deprecated/20210928-mcb-arbitrum-merkle)                   |
| Merkle Orchard Distributor                       | [`20211012-merkle-orchard`](./tasks/deprecated/20211012-merkle-orchard)                             |
| Batch Relayer                                    | [`20211203-batch-relayer`](./tasks/deprecated/20211203-batch-relayer)                               |
| Linear Pools for Aave aTokens                    | [`20211208-aave-linear-pool`](./tasks/deprecated/20211208-aave-linear-pool)                         |
| Preminted BPT Meta Stable Pools                  | [`20211208-stable-phantom-pool`](./tasks/deprecated/20211208-stable-phantom-pool)                   |
| Linear Pools for ERC4626 Tokens                  | [`20220304-erc4626-linear-pool`](./tasks/deprecated/20220304-erc4626-linear-pool)                   |
| Batch Relayer V2                                 | [`20220318-batch-relayer-v2`](./tasks/deprecated/20220318-batch-relayer-v2)                         |
| Fee Distributor for veBAL holders                | [`20220420-fee-distributor`](./tasks/deprecated/20220420-fee-distributor)                           |
