# <img src="../../logo.svg" alt="Balancer" height="128px">

# Balancer V2 Governance Scripts

[![NPM Package](https://img.shields.io/npm/v/@balancer-labs/v2-governance-scripts.svg)](https://www.npmjs.org/package/@balancer-labs/v2-governance-scripts)

In order to manage the Balancer protocol, Balancer DAO must sometimes execute somewhat complex sets of actions which if executed incorrectly could result in governance losing control of key powers over the protocol, opening up vulnerabilities by granting powerful permissions improperly, etc.

In order to prevent this, complex governance actions may be enacted through script contracts. These have a number of benefits over performing actions directly through the multisig wallet.

- The contract can be easily tested prior to the execution on mainnet to ensure that it produces the correct result.
- It's much simpler to verify the behaviour of Solidity code matches the proposal specification relative to a series of raw function calls.
- The contract may only be triggered once, ensuring that any powers granted to it can't be used in future for another purpose unilaterally.

This package contains the source code for these script contracts to form a record of major technical actions Balancer DAO has taken.

## Licensing

[GNU General Public License Version 3 (GPL v3)](../../LICENSE).
