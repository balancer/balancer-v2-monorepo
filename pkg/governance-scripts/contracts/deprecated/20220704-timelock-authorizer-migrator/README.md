# Timelock Authorizer Migrator

This was deployed, but before we were ready to migrate the Authorizer, we needed to change the authorizer to require
an entrypoint contract for routing calls that formerly went through the Authorizer Adaptor. The new contract can still
migrate from the old Authorizer (which is referenced only by address), but it needs a new argument to construct the new
Authorizer.

## Governance proposal

## Deployment

[Deployment task here](../../../deployments/tasks/20220704-timelock-authorizer)
