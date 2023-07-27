# Changelog

## Unreleased

### Breaking changes

- Removed `Version` contract. It is now part of `v2-solidity-utils` since it will be used more generally.

## 4.1.1 (2023-06-05)

### Bugfix

- Reduce gas limit to 10000 inside the static call in `ensureNotInVaultContext` from `VaultReentrancyLib`.

## 4.1.0 (2023-06-05)

### New Features

- `ensureNotInVaultContext` changed to `view` in `VaultReentrancyLib`.

## 4.0.0 (2023-03-23)

### New Features

- Added `_setVersion` to `Version`
- Protected `ProtocolFeeCache` from reentrancy issues.

### Breaking Changes

- The `_create` function in `BasePoolFactory` now uses the `CREATE2` opcode and takes an extra `salt` argument.

## 3.1.2 (2023-02-14)

### Bugfix

- Make `VaultReentrancyLib` compatible with solc >=0.7.0 <0.9.0.

## 3.1.1 (2023-02-08)

### Bugfix

- Fix dependency on `v2-solidity-utils`.

## 3.1.0 (2023-02-08)

### New Features

- Added `VaultReentrancyLib`.
- Added the Vault as a constructor argument to `RecoveryMode`.

## 3.0.1 (2022-12-12)

### Misc

- Updated readme.
- Removed unnecessary dependency on the `v2-vault` package.

## 3.0.0 (2022-12-12)

- Re-release, potentially breaking backwards compatibility.

## 2.0.1 (2021-09-14)

- Dependency version fixes.

## 2.0.0 (2021-09-13)

- Re-release, potentially breaking backwards compatibility.
