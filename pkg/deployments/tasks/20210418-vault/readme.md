# 2021-04-18 Vault

Deployment of the Vault, Balancer V2's core contract.

Note that the Authorizer used in the Vault's original deployment may change over time: the current Authorizer should be retrieved by calling `vault.getAuthorizer()` instead.

Aditionally, the `WETH` argument may represent different things in different network: on Ethereum mainnet it is the [`WETH` contract](https://etherscan.io/address/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2), whereas e.g. in Polygon mainnet it is the [`WMATIC` contract](https://polygonscan.com/address/0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270).

## Useful Files

- [Ethereum mainnet address](./output/mainnet.json)
- [Polygon mainnet address](./output/polygon.json)
- [Arbitrum mainnet address](./output/arbitrum.json)
- [`Vault` ABI](./abi/Vault.json)
