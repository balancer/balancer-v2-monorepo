# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Deployments

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-deployments.svg)](https://www.npmjs.org/package/@balancer-labs/v2-deployments)

This package contains the addresses and ABIs of all Balancer V2 deployed contracts, for both the main network and different test ones. Artifacts are found in the [`deployed`](./deployed) directory, where each subdirectory represents a network.

Note that some protocol contracts are created dynamically: those will not be found in this package. For example, the canonical `WeightedPool` contracts are deployed by the canonical `WeightedPoolFactory`, and not listed here: their addresses should be retrieved by querying the on-chain state, or processing emitted events.
