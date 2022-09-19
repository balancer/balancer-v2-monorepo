# 2022-03-25 - Authorizer Adaptor

Deployment of the `AuthorizerAdaptor`, a gateway contract which allows compatibility between the Authorizer and systems which rely on having a single administrator address.

The adaptor may then be the admin for these systems and acts as a proxy forwarding on calls subject to the caller's permissions on the Authorizer.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet address](./output/polygon.json)
- [Arbitrum mainnet address](./output/arbitrum.json)
- [Optimism mainnet address](./output/optimism.json)
- [`AuthorizerAdaptor` ABI](./abi/AuthorizerAdaptor.json))
