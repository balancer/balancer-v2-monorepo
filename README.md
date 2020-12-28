<a href="https://circleci.com/gh/balancer-labs/balancer-core-v2">
  <img src="https://circleci.com/gh/balancer-labs/balancer-core-v2.svg?style=svg&circle-token=7beca30a3a74abfa193c2ec87e6d2ae5594c1c6d" />
</a>

# balancer-core-v2

Prototypes for the v2 architecture

## Requirements

- [Node.js](https://nodejs.org/en) ^12
- [Yarn](https://classic.yarnpkg.com/lang/en)

## Installation

Run `yarn` to download all dependencies.

## Usage

All common tasks are implemented as scripts in the `package.json`, and can be run by passing them as arguments to `yarn`.

`yarn compile` and `yarn test` are the two main Solidity workflow tasks, and both have watch modes variants (`yarn test:watch`).

## Directories

- `contracts`: source code for all smart contracts in the system. The `test` subdirectory holds contracts that are only used for testing purposes, often with lax access control patterns and other 'unsafe' properties.
- `test`: unit tests for each smart contract, using [ethers](https://docs.ethers.io/v5/) and [waffle chai matchers](https://ethereum-waffle.readthedocs.io/en/latest/matchers.html). The `helpers` subdirectory holds utilities used to simplify writing assertions, deploying test contracts, etc., with the overall goal of making tests more ergonomic and less verbose.
- `scripts`: these execute tasks unrelated to testing, such as gas benchmarking, deployment, etc. The `helpers` subdirectory contains specialized utilities for our project to e.g. make deployment easier - some of these are also used in the tests.
