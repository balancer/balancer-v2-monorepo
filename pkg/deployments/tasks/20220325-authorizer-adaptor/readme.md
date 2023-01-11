# 2022-03-25 - Authorizer Adaptor

Deployment of the `AuthorizerAdaptor`, a gateway contract which allows compatibility between the Authorizer and systems which rely on having a single administrator address.

The adaptor may then be the admin for these systems and acts as a proxy forwarding on calls subject to the caller's permissions on the Authorizer.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [BSC mainnet addresses](./output/bsc.json)
- [Gnosis mainnet addresses](./output/gnosis.json)
- [Goerli testnet addresses](./output/goerli.json)
- [`AuthorizerAdaptor` artifact](./artifact/AuthorizerAdaptor.json)
