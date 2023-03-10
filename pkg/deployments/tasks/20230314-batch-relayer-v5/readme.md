# 2023-03-14 - Batch Relayer V5

Deployment of the fifth `BalancerRelayer` using `BatchRelayerLibrary`, for combining multiple operations (swaps, joins, etc.) in a single transaction.

This new version provides full support for all versions of Stable Pools: in particular, V2 and higher, which support proportional joins and exits.
It also adds support for many new protocol wrappers: CompoundV2 (Midas), Euler, Gearbox, Silo, Tetu, Yearn, and Reaper.

## Useful Files

- [`BatchRelayerLibrary` artifact](./artifact/BatchRelayerLibrary.json)
- [`ITetuController` artifact](./artifact/ITetuController.json)
