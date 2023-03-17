# 2022-12-02 - Timelock Authorizer

Deployment of the `TimelockAuthorizer` in order to replace the basic Authorizer deployed with the Vault.
This Authorizer implementation allows defining a delay per action identifier. Users can only execute functions directly when there is no delay. Otherwise, they're granted permission to schedule an action, which can then be executed by the Authorizer after the delay. It also introduces Granters and Revokers, to allow controlled delegation of permission handling to third parties, which eases the burden on governance and allows the system to scale. For instance, a smaller multisig might be designated as a Granter for certain veBAL-related functions for new pools.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Goerli testnet addresses](./output/goerli.json)
- [`TimelockAuthorizer` artifact](./artifact/TimelockAuthorizer.json)
- [`TimelockAuthorizerMigrator` artifact](./artifact/TimelockAuthorizerMigrator.json)
