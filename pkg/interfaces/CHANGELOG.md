# Changelog

## Unreleased

### New Features

- Added `locked__end` to `IVotingEscrow`.
- Added `IL2LayerZeroDelegation`.
- Added `IVotingEscrowRemapper`.
- Added `IOmniVotingEscrowAdaptor` and `IOmniVotingEscrowAdaptorSettings`.
- Added `checkpointSingleGauge` and `getSingleBridgeCost` to `IL2GaugeCheckpointer`.

### Breaking changes

- Refactored `IGaugeAdder`
  - Gauge types changed from enum to string across the interface.
  - Removed specific `add<Network>Gauge` in favor of a single `addGauge` method with a type argument.
  - Added event `GaugeTypeAdded`, and changed `GaugeFactoryAdded` for `GaugeFactorySet`.
  - Added `getGaugeTypes` method.
- Moved `GaugeType` from `IGaugeAdder` to `IL2GaugeCheckpointer`, and adjusted types to accept new networks.
- Refactored `IL2GaugeCheckpointer` to `StakelessGaugeCheckpointer`.
  - Removed `isSupportedGaugeType` from interface.
  - Added `getRoundedDownBlockTimestamp` and `getGaugeTypes` to interface.
- Bumped minimum compiler version from `0.7.0` to `0.7.1` in `BalancerErrors`.
- `IVersion` moved from `pool-utils` to `solidity-utils`.

## 0.4.0 (2023-03-15)

- Added `IERC4626`.
- Added `IChildChainGauge`.
- Added `ILMGetters`.

### Breaking changes

- Removed `IBaseGaugeFactory`.
- Refactor: renamed `IBalancerMinter` to `IMainnetBalancerMinter`.
  - `IMainnetBalancerMinter` now implements reduced version of previous `IBalancerMinter` and `ILMGetters`.

## 0.3.0 (20223-02-08)

### New Features

- Added `checkpointGaugesOfTypeAboveRelativeWeight` to `IL2GaugeCheckpointer`.
- Added `IComposableStablePoolRates`.
- Added `IProtocolFeeCache`.
- Added `setTargets` and `setSwapFeePercentage` to `ILinearPool`.

### Breaking changes

- `IL2GaugeCheckpointer`: `getGaugeAt` renamed to `getGaugeAtIndex`.

## 0.2.1 (2022-12-12)

### Misc

- Added examples to readme.

## 0.2.0 (2022-12-01)

### New Interfaces

- Added `IProtocolFeeSplitter`.
- Added `IL2GaugeCheckpointer`.
- Added `IAuthorizerAdaptorEntrypoint`.
- Added `IRateProviderPool`.
- Added `IVersion`.
- Added `IFactoryCreatedPoolVersion`.
- Added `IRecoveryModeHelper`.

### New Features

- Extended the valid compiler version range to any of the 0.7.x and 0.8.x line.

### Breaking Changes

- Removed `IAssetManager`, which was unused.
- `IGaugeAdder`: authorizer adaptor getter replaced with authorizer adaptor entrypoint getter.

## 0.1.0 (2022-10-25)

- Initial release.
