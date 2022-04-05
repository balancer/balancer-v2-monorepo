# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Vault

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-vault.svg)](https://www.npmjs.org/package/@balancer-labs/v2-vault)
[![Docs](https://img.shields.io/badge/docs-%F0%9F%93%84-blue)](https://docs.balancer.fi/developers/smart-contracts/apis/vault)

This package contains the source code of Balancer V2's main contract, the [`Vault`](./contracts/Vault.sol), as well as all [core interfaces](./contracts/interfaces).

The [Vault interface](./contracts/interfaces/IVault.sol) itself is required for multiple tasks, including swaps, joins and exits, but some scenarios require functionality provided through other contracts. Particularly useful interfaces include:

- [`IBasePool`](./contracts/interfaces/IBasePool.sol), [`IGeneralPool`](./contracts/interfaces/IGeneralPool.sol) and [`IMinimalSwapInfoPool`](./contracts/interfaces/IMinimalSwapInfoPool.sol) for developing Pools
- [`IFlashLoanRecipient`](./contracts/interfaces/IFlashLoanRecipient.sol) for performing Flash Loans
- [`IProtocolFeesCollector`](./contracts/interfaces/IProtocolFeesCollector.sol) for querying protocol fee percentages

## Overview

### Installation

```console
$ npm install @balancer-labs/v2-vault
```

### Usage

The main purpose of this package is to provide the Solidity interfaces of core components, which are found in the [`/contracts/interfaces`](./contracts/interfaces] directory. The Vault contract itself is also useful for testing.

To get the address of deployed contracts in both mainnet and various test networks, see [`v2-deployments`](../deployments).

Sample contract that performs Internal Balance deposits:

```solidity
pragma solidity ^0.7.0;

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

contract SimpleDepositor {
    IVault private constant vault = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

    function depositFunds(
        IERC20[] memory tokens,
        uint256[] memory amounts,
    ) external {
      IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](tokens.length);

      for (uint256 i = 0; i < tokens.length; ++i) {
        ops[i] = IVault.UserBalanceOp({
          kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL,
          asset: IAsset(tokens[i]),
          amount: amounts[i],
          sender: address(this),
          recipient: address(this)
        });
      }

      vault.manageUserBalance(ops);
    }
}
```

Sample contract that performs Flash Loans:

```solidity
pragma solidity ^0.7.0;

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IFlashLoanRecipient.sol";

contract FlashLoanRecipient is IFlashLoanRecipient {
    IVault private constant vault = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

    function makeFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external {
      vault.flashLoan(this, tokens, amounts, userData);
    }

    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external override {
        require(msg.sender == vault);
        ...
    }
}
```

## Licensing

[GNU General Public License Version 3 (GPL v3)](../../LICENSE).
