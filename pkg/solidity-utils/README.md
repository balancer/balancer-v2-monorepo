# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Solidity Utilities

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-solidity-utils.svg)](https://www.npmjs.org/package/@balancer-labs/v2-solidity-utils)

This package contains Solidity utilities and libraries used when developing Balancer V2 contracts. Many design decisions and trade-offs have been made in the context of Balancer V2's requirements and constraints (such as reduced bytecode size), which may make these libraries unsuitable for other projects.

## Overview

### Installation

```console
$ npm install @balancer-labs/v2-solidity-utils
```

## Licensing

Most of the Solidity source code is licensed under the GNU General Public License Version 3 (GPL v3): see [`LICENSE`](../../LICENSE).

### Exceptions

- All files in the [`openzeppelin` directory](./contracts/openzeppelin) are based on the [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) library, and as such are licensed under the MIT License: see [LICENSE](./contracts/openzeppelin/LICENSE).
- The [`LogExpMath`](./contracts/math/LogExpMath.sol) contract is licensed under the MIT License.
