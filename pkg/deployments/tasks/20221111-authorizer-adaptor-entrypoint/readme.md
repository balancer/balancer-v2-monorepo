# 2022-11-11 - Authorizer Adaptor Entrypoint

Deployment of the `AuthorizerAdaptorEntrypoint`, a gateway contract created to address a critical bug found in the `AuthorizerAdaptor` that could lead to unintended escalation of privileges. This contract ensures correct interactions with the adaptor and the system of permissions behind it by working in combination with `TimelockAuthorizer` so that all Adaptor calls made through the Entrypoint check for permissions correctly, while any not made via the Entrypoint fail.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet address](./output/polygon.json)
- [Arbitrum mainnet address](./output/arbitrum.json)
- [Optimism mainnet address](./output/optimism.json)
- [BSC mainnet address](./output/bsc.json)
- [Gnosis mainnet address](./output/gnosis.json)
- [`AuthorizerAdaptor` ABI](./abi/AuthorizerAdaptor.json))
