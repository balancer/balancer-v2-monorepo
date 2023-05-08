# 2023-04-14 - Authorizer Wrapper

Deployment of the `AuthorizerWithAdaptorValidation`, which allows using the AuthorizerAdaptorEntrypoint with the existing Authorizer, before migration to the TimelockAuthorizer. In particular, this allows contracts that require the endpoint (e.g., Gauge Adder V3) to work.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [BSC mainnet addresses](./output/bsc.json)
- [Gnosis mainnet addresses](./output/gnosis.json)
- [Avalanche mainnet addresses](./output/avalanche.json)
- [Polygon zkeVM mainnet addresses](./output/zkevm.json)
- [Goerli testnet addresses](./output/goerli.json)
- [Sepolia testnet addresses](./output/sepolia.json)
- [`AuthorizerWithAdaptorValidation` artifact](./artifact/AuthorizerWithAdaptorValidation.json)
