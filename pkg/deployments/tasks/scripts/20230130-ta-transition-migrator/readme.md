# 2023-01-30 - Timelock Authorizer Transition Migrator

Deployment of the `TimelockAuthorizerTransitionMigrator`, responsible for migrating permissions granted to the old authorizer in the time period after the `TimelockAuthorizer` was deployed, while the old authorizer was still in use. 

The `TimelockAuthorizer` deployment can be found [here](../../20221202-timelock-authorizer/). Permissions granted to the old authorizer before the new deployment were already migrated with the `TimelockAuthorizerMigrator` as part of the `TimelockAuthorizer` deployment task.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [`TimelockAuthorizerTransitionMigrator` artifact](./artifact/TimelockAuthorizerTransitionMigrator.json)
