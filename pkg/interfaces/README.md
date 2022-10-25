# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Interfaces

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-interfaces.svg)](https://www.npmjs.org/package/@balancer-labs/v2-interfaces)

This package contains interfaces used in dependent packages. This not only makes building systems that interact with Balancer contracts simpler, but also prevent circular dependencies across internal packages, which could result in compilation errors, or cause issues with deployment, verification, or other tools.

## Overview

### Installation

```console
$ npm install @balancer-labs/v2-interfaces
```

### Usage

This package can be used in multiple ways, including interacting with already deployed Pools, or performing local testing. It contains all interfaces used in the system, from the foundational `/vault/IVault` to very specific contracts (e.g., `/liquidity-mining/IOptimismGasLimitProvider`).

In addition to interfaces, it also includes a small number of libraries that encapsulate enum types for particular pools (e.g., `pool-stable/StablePoolUserData.sol`), and functions for working with encoding and decoding `userData`. (See the `balancer-js` package for TypeScript versions of these utilities.)

One of the most commonly included libraries is `solidity-utils/helpers/BalancerErrors.sol`. To save bytecode, Balancer V2 does not use the standard `require(<condition>, 'error string')`. BalancerErrors defines `_require` and `_revert` functions. These take a numerical constant (defined in the Errors library) instead of a string, which is converted to the string value `BAL#<3-digit-number>` if it reverts. (There are TypeScript utilities to convert this to a human-readable string for testing.)

.
```solidity
pragma solidity ^0.7.0;

// Import external library interface, error messages, and library for decoding join/exit data.
import "@balancer-labs/v2-interfaces/contracts/pool-weighted/IExternalWeightedMath.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-weighted/WeightedPoolUserData.sol";

// Import a contract from a package.
import "@balancer-labs/v2-pool-weighted/contracts/managed/ManagedPool.sol";

contract ProportionalManagedPool is ManagedPool {
    using WeightedPoolUserData for bytes;

    ...

    constructor(
        NewPoolParams memory params,
        IVault vault,
        IProtocolFeePercentagesProvider protocolFeeProvider,
        IExternalWeightedMath weightedMath,
        address owner,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration
    ) ManagedPool(params, vault, protocolFeeProvider, weightedMath, owner, pauseWindowDuration, bufferPeriodDuration) {
      // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @dev Dispatch code which decodes the provided userdata to perform the specified join type.
     * Pretending this is virtual, for the example.
     */
    function _doJoin(
        address sender,
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory scalingFactors,
        uint256 totalSupply,
        bytes memory userData
    ) internal view override returns (uint256 bptAmountOut, uint256[] memory amountsIn) {
        // Decode the userData, using the helper from the interface package.
        WeightedPoolUserData.JoinKind kind = userData.joinKind();

       ...

        if (kind == WeightedPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {
            // _getWeightedMath() returns the pointer to the ExternalWeightedMath library.
            (bptAmountOut, amountsIn) = _getWeightedMath().joinAllTokensInForExactBPTOut(balances, totalSupply, userData);

            // BalancerErrors defines _require(), _revert(), and Errors (error codes).
            _require(bptAmountOut > 0, Errors.BPT_OUT_MIN_AMOUNT);
        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    ...
}

```

## Licensing

[GNU General Public License Version 3 (GPL v3)](../../LICENSE).
