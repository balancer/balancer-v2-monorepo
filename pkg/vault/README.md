# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Vault

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-vault.svg)](https://www.npmjs.org/package/@balancer-labs/v2-vault)
[![Docs](https://img.shields.io/badge/docs-%F0%9F%93%84-blue)](https://docs.balancer.fi/developers/smart-contracts/apis/vault)

This package contains the source code of Balancer V2's main contract, the [`Vault`](./contracts/Vault.sol), as well as all [core interfaces](./contracts/interfaces).

The [Vault interface](./contracts/interfaces/IVault.sol) itself is required for multiple tasks, including swaps, joins and exits, but some scenario require using a few additional ones. Particularly useful interfaces include:

- [`IBasePool`](./contracts/interfaces/IBasePool.sol), [`IGeneralPool`](./contracts/interfaces/IGeneralPool.sol) and [`IMinimalSwapInfoPool`](./contracts/interfaces/IMinimalSwapInfoPool.sol) for developing Pools
- [`IFlashLoanRecipient`](./contracts/interfaces/IFlashLoanRecipient.sol) for performing Flash Loans
- [`IProtocolFeesCollector`](./contracts/interfaces/IProtocolFeesCollector.sol) for querying protocol fee percentages
