# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Liquidity Mining System

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-liquidity-mining.svg)](https://www.npmjs.org/package/@balancer-labs/v2-liquidity-mining)

This package contains the source code of Balancer V2's Liquidity Mining system, which is composed of multiple contracts. Among those stand out the [`VotingEscrow`](./contracts/VotingEscrow.vy), the [`BalancerMinter`](./contracts/BalancerMinter.sol), and the [`GaugeController`](./contracts/GaugeController.vy)., as well as all [core interfaces](./contracts/interfaces).

## Overview

The Liquidity Mining system is an automated program which governs all minting of the BAL token, based on on-chain voting by holders of the veBAL token. veBAL is obtained by joining the canonical 80/20 BAL/ETH Weighted Pool and then locking the Pool shares token (often called BPT, for 'Balancer Pool Token') for a time duration. The longer the 80/20 BPT is locked for, the more veBAL and voting power is obtained.

This system very closely mirrors that of Curve DAO: indeed, most of the smart contract source code is either an almost exact copy of the Curve version, or a very close port of the original Vyper code into Solidity. One of the design goals has been to modify Curve's original work as little as possible in order to reduce smart contract risk.

### Balancer Token Admin

An important job of the Liquidity Mining program is to provide upper bounds on all future minting of the Balancer Token. In Curve's case, these restrictions are embedded in the CRV token itself. The BAL token contract however lacks such constraints, allowing its admins to mint arbitrary amounts of BAL, so the CRV code had to be adapted.

BAL uses OpenZeppelin's `AccessControl` contracts to manage minting permissions over it, which makes it simple to setup a two-contract system that emulates the original CRV behavior. The `BalancerTokenAdmin` acts as the sole account in the entire network with BAL minting permission, creating a thin wrapper around BAL's mechanism with two added behaviors: a minting schedule is put into place, which creates an upper bound on the amount of BAL that can exist at any point in time, and minting authorization is delegated to the Balancer DAO via the `Authorizer` contract. Once `BalancerTokenAdmin` is setup, BAL's admin configuration becomes immutable, locking-in these constraints forever.

The source code that computes the amount of BAL available to be minted is a direct port of CRV's Vyper code into Solidity, preserving variable names and ABI. The initial minting rate was also adjusted to reflect BAL's.

### Balancer Minter

The `BalancerMinter` is granted permission by the `Authorizer` to mint BAL (via `BalancerTokenAdmin`, which enforces the minting schedule). It does so by relying on the `GaugeController` to keep a registry of authorized gauge contracts, and then mints whatever token amounts the different gauges report. This means gauges are a single point of failure, since just one faulty gauge can cause for arbitrary amounts of BAL (up to the emissions limit) to be minted. This can only be mitigated through revoking the `BalancerMinter`'s permission to mint BAL, in effect shutting down all gauges.

`BalancerMinter` is generally inspired by `CurveMinter`, although a few extra functions were added for convenience (such as `setMinterApprovalWithSignature`).

### Authorizer Adaptor

Curve relies greatly on contract admin accounts, and so favors a single-admin pattern in all of its contracts. On the other hand, Balancer's access control solution is the `Authorizer` contract, which holds all permissions in the network, and is queried by other contracts when permissioned actions are performed. In order to solve this discrepancy without modifying Curve's source code nor changing how Balancer's authorizations work, the `AuthorizerAdaptor` contract was created.

This singleton entity is meant to be setup as the admin of all of these single-admin contracts. It adapts their behavior to the `Authorizer` pattern by implementing the `performAction` function, which forwards on arbitrary external calls while enforcing that the caller has permissions on the `Authorizer` to make the provided function call to the target contract. Contracts which have the `AuthorizerAdaptor` set as their admin then inherit the `Authorizer`'s access control mechanism.

### Gauge Controller

The `GaugeController` serves as the gauge registry, and is also the place where veBAL holders vote to allocate BAL emissions towards gauges of their choosing.

It is almost an exact copy of Curve's implementation, with the few differences being usage of a newer version of the Vyper compiler, replacement of storage variables for the new `immutable` type, and removal of dummy functions introduced for Aragon compatibility.

### Liquidity Gauge

`LiquidityGaugeV5` is the primary kind of gauge contract on the Ethereum network, letting Liquidity Providers (LPs) deposit their BPT to participate in the Liquidity Mining program. These gauges distribute tokens by both minting BAL for them on demand (via `BalancerMinter`), as well as by having administrators deposit other tokens beforehand.

It is almost an exact copy of Curve's implementation, with the few differences being usage of a newer version of the Vyper compiler, addition of an initialization function to make Solidity-based gauge factory contracts possible, replacement of storage variables for the new `immutable` type, and removal of dummy functions introduced for Aragon compatibility.

### Voting Escrow

`VotingEscrow` is the veBAL contract, which allows LPs to deposit and lock 80/20 BPT in exchange for veBAL. The maximum lock time has been shortened from 4 years to 1 year.

It is almost an exact copy of Curve's implementation, with the few differences being usage of a newer version of the Vyper compiler, replacement of storage variables for the new `immutable` type, and removal of dummy functions introduced for Aragon compatibility.

### Voting Escrow Delegation

`VotingEscrowDelegation` lets veBAL holders share their boost factor to other accounts.

It is almost an exact copy of Curve's implementation, with the few differences being usage of a newer version of the Vyper compiler, replacement of storage variables for the new `immutable` type, and removal of dummy functions introduced for Aragon compatibility.

## Licensing

- All Vyper files are based on the [Curve DAO Contracts](https://github.com/curvefi/curve-dao-contracts), and as such are licensed under the MIT License.
- All other files are licensed under the [GNU General Public License Version 3 (GPL v3)](../../LICENSE).
