# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Interfaces

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-interfaces.svg)](https://www.npmjs.org/package/@balancer-labs/v2-interfaces)

This package contains interfaces used in dependent packages, which makes building systems that interact with Balancer contracts simpler, as the implementation information is not included.

## Overview

### Installation

```console
$ npm install @balancer-labs/v2-interfaces
```

### Usage

This package can be used in multiple ways, including interacting with already deployed Pools, or performing local testing. It contains all interfaces used in the system, from the foundational [Vault](contracts/vault/IVault.sol) to very specific contracts (e.g., [Optimism Gas Limit Provider](contracts/liquidity-mining/IOptimismGasLimitProvider.sol)).

.
```solidity
pragma solidity ^0.7.0;

// Import Vault interface, error messages, and library for decoding join/exit data.
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-weighted/WeightedPoolUserData.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IAsset.sol";

// Import ERC20Helpers for `_asIAsset`
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";

contract JoinBalancerPool {
    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    function getVault() public view returns (IVault) {
        return _vault;
    }

    function joinBalancerPool(bytes32 poolId, address sender, address recipient, uint256[] memory amountsIn, uint256 minBptAmountOut) external {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(poolId);
        
        // Use BalancerErrors to validate input
        _require(amountsIn.length == tokens.length, Errors.INPUT_LENGTH_MISMATCH);

        // Encode the userData for a multi-token join
        bytes memory userData = abi.encode(WeightedPoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, amountsIn, minBptAmountOut);

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _asIAsset(tokens),
            maxAmountsIn: amountsIn,
            userData: userData,
            fromInternalBalance: false
        });
        
        // Call the Vault to join the pool
        getVault().joinPool(poolId, sender, recipient, request);
    }

    ...
}

```

### Notes

In addition to interfaces, it also includes a small number of libraries that encapsulate enum types for particular pools (e.g., [StablePoolUserData](contracts/pool-stable/StablePoolUserData.sol), and functions for working with encoding and decoding `userData`. (See the `balancer-js` package for TypeScript versions of these utilities.)

One of the most commonly included libraries is [BalancerErrors](contracts/solidity-utils/helpers/BalancerErrors.sol). To save bytecode, Balancer V2 does not use the standard `require(<condition>, 'error string')`. Instead, BalancerErrors defines `_require` and `_revert` functions. These take a numerical constant instead of a string, and return a fixed-length code, which can be converted to plain text using TypeScript utilities.

## Licensing

[GNU General Public License Version 3 (GPL v3)](../../LICENSE).
