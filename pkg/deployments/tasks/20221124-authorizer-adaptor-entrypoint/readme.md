# 2022-11-24 - Authorizer Adaptor Entrypoint

Deployment of the `AuthorizerAdaptorEntrypoint`, a gateway contract created to address a critical bug found in the `AuthorizerAdaptor` that could lead to unintended escalation of privileges. This contract ensures correct interactions with the adaptor and the system of permissions behind it by working in combination with `TimelockAuthorizer` so that all Adaptor calls made through the Entrypoint check for permissions correctly, while any not made via the Entrypoint fail.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [BSC mainnet addresses](./output/bsc.json)
- [Gnosis mainnet addresses](./output/gnosis.json)
- [Goerli testnet addresses](./output/goerli.json)
- [`AuthorizerAdaptor` artifact](./artifact/AuthorizerAdaptor.json))
