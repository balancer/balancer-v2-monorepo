# 2022-05-17 - Protocol Fee Withdrawer

Deployment of the Protocol Fee Withdrawer, which is used to prevent any withdrawals of certain tokens from the Protocol Fee Collector. This is useful for certain situations where the Protocol Fee Collector holds tokens which should not be treated as regular protocol fees.

See [the Double Entrypoint Fix Relayer](../20220513-double-entrypoint-fix-relayer/) for information on an example of a situation where this is necessary.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [BSC mainnet addresses](./output/bsc.json)
- [Gnosis mainnet addresses](./output/gnosis.json)
- [Goerli testnet addresses](./output/goerli.json)
- [`ProtocolFeesWithdrawer` artifact](./artifact/ProtocolFeesWithdrawer.json)
