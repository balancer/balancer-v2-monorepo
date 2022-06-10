# Deploying Balancer Contracts

The deployments package aims to provide a robust mechanism to run and verify deployments on multiple networks. This document describes the rationale, what guarantees it provides, and how to create and run deployments.

## Overview

Each deployment unit is called a 'task'. Tasks have a unique ID, which is often prefixed with the date on which they were first executed (to e.g. differentiate the April 2021 deployment of Weighted Pools from the one deployed in July 2022, which might have wildly different behavior).

A task is made up of multiple components:

- one or multiple build information JSON files, located in the `build-info` directory.
- an `input.ts` file, containing information on dependencies and deployment parameters (which might differ across networks).
- an `index.ts` file, with the instructions for the actual deployment.
- the `output`, `abi` and `bytecode` directories, with JSON files containing the deployment addresses of the tasks' contracts in each network as well as additional information.
- optional fork tests in the `test` directory.

### Why `build-info`

When Hardhat compiles a Solidity project, in addition to the traditional contract artifacts it also produces a special file in the `artifacts/build-info` directory, which includes all of the compilation inputs (full source code, compiler version and settings, etc.) and all of the compilation outputs (creation bytecode, ABI, AST, etc.). By storing this file in the repository and using it as the source of truth for deployments, we fully break the dependency on the source code and are able to modify it and update it after a deployment is created, while guaranteeing that all deployments of a given task will be identical (since they share the same build information).

As part of our development process, we frequently alter the source code of contracts that have already been deployed, and keep no historical versions: the deployment data is fully stored in the build information file.

## Creating Tasks

A new task is created by placing a new directory named after the task ID in the `tasks`, and populating the `build-info` directory and writing appropiate `input.ts` and `index.ts` files. The `output`, `abi` and `bytecode` directories are automatically generated and populated.

The build information should be generated on a clean commit, so that it can be verified by other parties. On the project directory, delete the `artifacts` directory and run `yarn hardhat compile` for a clean compilation. The file will be then be located at `artifacts/build-info`.

Inputs and task instructions are plain TypeScript files that call appropriate functions - there's no DSL. The recommended way to write them is to copy the structure from the `input.ts` and `index.ts` files from a similar task, and then edit those as needed.

### Vyper Compilation

Hardhat does not generate build information for Vyper contracts - those must be created manually.

## Verifying Tasks

There are three things to verify from a task:

- the build information
- the inputs
- the deployment script

The last two can be performed with simple manual inspection, that is, reviewing `input.ts` and `index.ts` and checking that they have sensible inputs and correct constructor arguments.

In order to check the `build-info` contents, follow these steps:

```bash
$ git checkout <build-info-generation-commit>
$ cd <contract package> # e.g. pkg/v2-pool-weighted
$ rm -rf artifacts # clean prior builds
$ yarn hardhat compile
$ diff artifacts/build-info/<actual-build-info>.json ../deployments/tasks/<task-id>/build-info/<expected-build-info>.json
```

The final `diff` command will produce no output if the build information files match.

## Running Tasks

### Prerequisites

Tasks require an EOA private key to sign transactions with, an RPC endpoint to broadcast them, and an Etherscan API key to submit source code for verification.

This data is accessed via the [`local-networks-config`](https://www.npmjs.com/package/hardhat-local-networks-config-plugin) Hardhat plugin, which expects a JSON file to be located at `~/.hardhat/networks.json` with the following contents (replace accordingly):

```json
{
  "networks": {
    "mainnet": {
      "url": "https://mainnet.rpc.endpoint/myAPIKey",
      "verificationAPIKey": "mainnet-etherscan-API-key"
    },
    "polygon": {
      "url": "https://polygon.rpc.endpoint/myAPIKey",
      "verificationAPIKey": "polygon-etherscan-API-key"
    },
    "arbitrum": {
      "url": "https://arbitrum.rpc.endpoint/myAPIKey",
      "verificationAPIKey": "arbitrum-etherscan-API-key"
    },
    "optimism": {
      "url": "https://optimism.rpc.endpoint/myAPIKey",
      "verificationAPIKey": "optimism-etherscan-API-key"
    },
    "kovan": {
      "url": "https://kovan.rpc.endpoint/myAPIKey",
      "verificationAPIKey": "kovan-etherscan-API-key"
    },
    "goerli": {
      "url": "https://goerli.rpc.endpoint/myAPIKey",
      "verificationAPIKey": "goerli-etherscan-API-key"
    }
  },
  "defaultConfig": {
    "gasPrice": "auto",
    "gasMultiplier": 1,
    "accounts": ["0x-eoa-private-key"]
  }
}
```

### `deploy`

Once all prerequisites are met and the task is ready, its contracts can be deployed via the custom `deploy` Hardhat task, which can be run via:

```bash
$ yarn hardhat deploy --id <task-id> --network <network>
```

Deployment addresses will be automatically saved to the appropriate file in the tasks's `output` directory, and source code submittted to Etherscan for verification[^1].

Further runs of the task will not attempt to redeploy contracts for which an output already exists: use the `--force` flag to do a redeployment.

## Checking Deployments

The deployments package is able to verify that the addresses found in the `output` directories correspond exactly to a run of the task as described by `index.ts`, using the inputs at `input.ts` and the data from the `build-info` directory.

This can be done manually by running the `check-deployments` Hardhat task (`yarn hardhat check-deployments --network <network>`), but it is also done automatically on CI. Like deployment, [this also requires access to an RPC endpoint](#prerequisites).

## Running Tests

Some tasks define fork tests, which consist of creating a local fork from a real network at a given block, running the task on said fork, and then performing tests.

Unlike regular deployments, this requires access to an _archive node_ instead of a regular RPC endpoint. [Alchemy](https://www.alchemy.com/) provides access to these on their free tier. They are configured the same way as [regular deployment endpoints](#prerequisites) (it is possible to simply use the archive endpoint for all purposes, including contract deployment).

Once that is set up, fork tests can be run:

```bash
$ yarn test
```

### Writing Fork Tests

These are fairly involved, as they use a lot of custom utilities related to loading other tasks, impersonating accounts, etc. The suggested way to write them is to copy one for a similar task and then edit as needed.

[^1]: Etherscan verification typically fails the first time a task is run, as some time must pass for the newly deployed bytecode to be indexed by their servers. Running the task again should fix the issue.
