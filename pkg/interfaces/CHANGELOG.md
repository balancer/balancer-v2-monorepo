# Changelog

## Unreleased

### New Features

- Added `checkpointGaugesOfTypeAboveRelativeWeight` to `IL2GaugeCheckpointer`.

### Breaking changes

- `IL2GaugeCheckpointer`: `getGaugeAt` renamed to `getGaugeAtIndex`.

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
