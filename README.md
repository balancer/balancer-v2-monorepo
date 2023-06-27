# <img src="logo.svg" alt="Balancer" height="128px">

# Balancer V2 Monorepo

[![Docs](https://img.shields.io/badge/docs-%F0%9F%93%84-blue)](https://docs.balancer.fi/)
[![CI Status](https://github.com/balancer-labs/balancer-v2-monorepo/workflows/CI/badge.svg)](https://github.com/balancer-labs/balancer-v2-monorepo/actions)
[![License](https://img.shields.io/badge/License-GPLv3-green.svg)](https://www.gnu.org/licenses/gpl-3.0)

This repository contains the Balancer Protocol V2 core smart contracts, including the `Vault` and standard Pools, along with their tests.
Deployment configuration and information can be found at the [`balancer-deployments` repository](https://github.com/balancer/balancer-deployments).

For a high-level introduction to Balancer V2, see [Introducing Balancer V2: Generalized AMMs](https://medium.com/balancer-protocol/balancer-v2-generalizing-amms-16343c4563ff).

## Structure

This is a Yarn monorepo, with the packages meant to be published in the [`pkg`](./pkg) directory. Newly developed packages may not be published yet.

Active development occurs in this repository, which means some contracts in it might not be production-ready. Proceed with caution.

### Packages

- [`v2-interfaces`](./pkg/interfaces): Solidity interfaces for all contracts.
- [`v2-vault`](./pkg/vault): the [`Vault`](./pkg/vault/contracts/Vault.sol) contract and all core interfaces, including [`IVault`](./pkg/interfaces/contracts/vault/IVault.sol) and the Pool interfaces: [`IBasePool`](./pkg/interfaces/contracts/vault/IBasePool.sol), [`IGeneralPool`](./pkg/interfaces/contracts/vault/IGeneralPool.sol) and [`IMinimalSwapInfoPool`](./pkg/interfaces/contracts/vault/IMinimalSwapInfoPool.sol).
- [`v2-pool-weighted`](./pkg/pool-weighted): the [`WeightedPool`](./pkg/pool-weighted/contracts/WeightedPool.sol), and [`LiquidityBootstrappingPool`](./pkg/pool-weighted/contracts/lbp/LiquidityBootstrappingPool.sol) contracts, along with their associated factories.
- [`v2-pool-linear`](./pkg/pool-linear): the [`LinearPool`](./pkg/pool-linear/contracts/LinearPool.sol) contracts, along with its associated factory. Derived Linear Pools can be found in the [Orb Collective repo](https://github.com/orbcollective/linear-pools).
- [`v2-pool-utils`](./pkg/pool-utils): Solidity utilities used to develop Pool contracts.
- [`v2-solidity-utils`](./pkg/solidity-utils): miscellaneous Solidity helpers and utilities used in many different contracts.
- [`v2-standalone-utils`](./pkg/standalone-utils): miscellaneous standalone utility contracts.
- [`v2-liquidity-mining`](./pkg/liquidity-mining): contracts that compose the liquidity mining (veBAL) system.
- [`v2-governance-scripts`](./pkg/governance-scripts): contracts that execute complex governance actions.

## Pre-requisites

The build & test instructions below should work out of the box with Node 18. More specifically, it is recommended to use the LTS version 18.15.0; Node 19 and higher are not supported. Node 18.16.0 has a [known issue](https://github.com/NomicFoundation/hardhat/issues/3877) that makes the build flaky.

Multiple Node versions can be installed in the same system, either manually or with a version manager.
One option to quickly select the suggested Node version is using `nvm`, and running:

```bash
$ nvm use
```

## Clone

This repository uses git submodules; use `--recurse-submodules` option when cloning. For example, using https:

```bash
$ git clone --recurse-submodules https://github.com/balancer-labs/balancer-v2-monorepo.git
```

## Build and Test

Before any tests can be run, the repository needs to be prepared:

### First time build

```bash
$ yarn # install all dependencies
$ yarn workspace @balancer-labs/balancer-js build # build balancer-js first
```

### Regular build

```bash
$ yarn build # compile all contracts
```

Most tests are standalone and simply require installation of dependencies and compilation.

In order to run all tests (including those with extra dependencies), run:

```bash
$ yarn test # run all tests
```

To instead run a single package's tests, run:

```bash
$ cd pkg/<package> # e.g. cd pkg/v2-vault
$ yarn test
```

You can see a sample report of a test run [here](./audits/test-report.md).

### Foundry (Forge) tests

To run Forge tests, first [install Foundry](https://book.getfoundry.sh/getting-started/installation). The installation steps below apply to Linux or MacOS. Follow the link for additional options.

```bash
$ curl -L https://foundry.paradigm.xyz | bash
$ source ~/.bashrc # or open a new terminal
$ foundryup
```

Then, to run tests in a single package, run:
```bash
$ cd pkg/<package> # e.g. cd pkg/v2-vault
$ yarn test-fuzz
```

## Security

Multiple independent reviews and audits were performed by [Certora](https://www.certora.com/), [OpenZeppelin](https://openzeppelin.com/) and [Trail of Bits](https://www.trailofbits.com/). The latest reports from these engagements are located in the [`audits`](./audits) directory.

Bug bounties apply to most of the smart contracts hosted in this repository: head to [Balancer V2 Bug Bounties](https://docs.balancer.fi/reference/contracts/security.html#bug-bounty) to learn more.

All core smart contracts are immutable, and cannot be upgraded. See page 6 of the [Trail of Bits audit](https://github.com/balancer-labs/balancer-v2-monorepo/blob/master/audits/trail-of-bits/2021-04-02.pdf):

> Upgradeability | Not Applicable. The system cannot be upgraded.

## Licensing

Most of the Solidity source code is licensed under the GNU General Public License Version 3 (GPL v3): see [`LICENSE`](./LICENSE).

### Exceptions

- All files in the `openzeppelin` directory of the [`v2-solidity-utils`](./pkg/solidity-utils) package are based on the [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) library, and as such are licensed under the MIT License: see [LICENSE](./pkg/solidity-utils/contracts/openzeppelin/LICENSE).
- The `LogExpMath` contract from the [`v2-solidity-utils`](./pkg/solidity-utils) package is licensed under the MIT License.
- All other files, including tests and the [`pvt`](./pvt) directory are unlicensed.
