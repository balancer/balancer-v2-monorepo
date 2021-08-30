# Changelog

## 2.1.2 (2021-08-30)

### Fixes

- Fixed package paths in published contract loaders.

## 2.1.1 (2021-08-25)

### Fixes

- Added `BalancerHelpers` to the Arbitrum deployment.

## 2.1.0 (2021-08-24)

### New Deployments

- Deployed `Authorizer`, `Vault`, `WeightedPoolFactory`, `WeightedPool2TokensFactory`, `StablePoolFactory`, `LiquidityBootstrappingPoolFactory`, `MetaStablePoolFactory` on Arbitrum mainnet.

## 2.0.0 (2021-08-24)

### New Deployments

- `StablePoolFactory`
- `LiquidityBootstrappingPoolFactory`
- `MetaStablePoolFactory`
- `MerkleRedeem` (for the LDO token)
- `LidoRelayer`
- `WstETHRateProvider`

### Breaking Changes

This release changes the directory structure of the package and introduces the concept of 'tasks'. Refer to [the readme](./README.md) for more information on where artifacts are located, and the different task IDs.
