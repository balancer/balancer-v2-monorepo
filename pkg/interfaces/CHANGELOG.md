# Changelog

## Unreleased

### New Interfaces

- Added `IProtocolFeeSplitter`.
- Added `IL2GaugeCheckpointer`.
- Added `IAuthorizerAdaptorEntrypoint`.
- Added `IRateProviderPool`.

### New Features

- Extended the valid compiler version range to any of the 0.7.x and 0.8.x line.

### Breaking Changes

- Removed `IAssetManager`, which was unused.
- `IGaugeAdder`: authorizer adaptor getter replaced with authorizer adaptor entrypoint getter.

## 0.1.0 (2022-10-25)

- Initial release.
