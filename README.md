# <img src="logo.svg" alt="Balancer" height="128px">

# Balancer V2

[![CI Status](https://github.com/balancer-labs/balancer-core-v2/workflows/CI/badge.svg)](https://github.com/balancer-labs/balancer-core-v2/actions)
[![License](https://img.shields.io/badge/License-GPLv3-green.svg)](https://www.gnu.org/licenses/gpl-3.0)

This repository contains Balancer Protocol V2's core smart contract, the [`Vault`](./contracts/vault/Vault.sol), along with auxiliary contracts such as the [`WeightedPoolFactory`](./contracts/pools/weighted/WeightedPoolFactory.sol).

For a high-level introduction to Balancer V2, see [Introducing Balancer V2: Generalized AMMs](https://medium.com/balancer-protocol/balancer-v2-generalizing-amms-16343c4563ff).

## Structure

Active development occurs in this repository, which means some contracts in it may not be production-ready. Proceed with proper care.

### Directories

- `contracts`: source code for all smart contracts in the system.
  - `vault` stores the `Vault` contract, which is split across many files for separation of concerns and clarity.
  - `pools` keeps the code for the different Pool types and related contracts, such as factories.
  - `test` holds contracts that are only used for testing purposes, often with lax access control patterns and other unsafe properties.
- `test`: unit tests for each smart contract, using [ethers](https://docs.ethers.io/v5/) and [waffle chai matchers](https://ethereum-waffle.readthedocs.io/en/latest/matchers.html). The `helpers` subdirectory holds utilities used to simplify writing assertions, deploying test contracts, etc., with the overall goal of making tests more ergonomic and less verbose.
- `lib`: miscellaneous files used for deployment, gas benchmarking, testing and so on.

This repository will soon be migrated into a monorepo, making the different contracts, interfaces and libraries easier to use by third parties. Stay tuned!

## Security

Multiple independent reviews and audits were performed by [Certora](https://www.certora.com/), [OpenZeppelin](https://openzeppelin.com/) and [Trail of Bits](https://www.trailofbits.com/). The latest reports from these engagements are located in the `audits` directory.

Bug bounties apply to most of the smart contracts hosted in this repository: head to [Balancer V2 Bug Bounties](https://docs.balancer.fi/core-concepts/security/bug-bounties) to learn more.

## Licensing

Most of the source code is licensed under the GNU General Public License Version 3 (GPL v3): see [`LICENSE`](./LICENSE).

### Exceptions

- All files under `contracts/lib/openzeppelin`, are based on the [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) library, and as such are licensed under the MIT License: see [LICENSE](./contracts/lib/openzeppelin/LICENSE).
- `contracts/lib/math/LogExpMath.sol` is licensed under the MIT License.
- All other files under `lib` and `test` are unlicensed.
