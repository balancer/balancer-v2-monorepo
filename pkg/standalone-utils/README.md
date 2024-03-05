# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Standalone Utilities

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-standalone-utils.svg)](https://www.npmjs.org/package/@balancer-labs/v2-standalone-utils)

This package contains standalone Solidity utilities that can be used to perform advanced actions in the Balancer V2 protocol.

- [`BalancerQueries`](./contracts/BalancerQueries.sol) can be used by off-chain clients to simulate Pool joins and exits, computing the expected result of these operations.

## Overview

### Installation

```console
$ npm install @balancer-labs/v2-standalone-utils
```

### Usage

The contracts in this package are meant to be deployed as-is, and in most cases canonical deployments already exist in both mainnet and various test networks. To get their addresses and ABIs, see [`balancer-deployments` repository](https://github.com/balancer/balancer-deployments).

## Licensing

[GNU General Public License Version 3 (GPL v3)](../../LICENSE).
