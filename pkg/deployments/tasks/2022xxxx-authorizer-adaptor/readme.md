# 2022-xx-xx - Authorizer Adaptor

Deployment of the `AuthorizerAdaptor`, a gateway contract which allows compatibility between the Authorizer and systems which rely on having a single administrator address.

The adaptor may then be the admin for these systems and acts as a proxy forwarding on calls subject to the caller's permissions on the Authorizer.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [`AuthorizerAdaptor` ABI](./abi/AuthorizerAdaptor.json))
