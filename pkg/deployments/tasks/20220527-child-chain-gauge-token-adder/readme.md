# 2022-05-27 - Child Chain Gauge Token Adder

Deployment of the Child Chain Gauge Token Adder, which is used to add reward tokens to Rewards Only Gauges, the standard child chain gauge. Unlike the L1 liquidity gauges, we need this in child chains as Rewards Only Gauges are composed of gauge and streamer, and both need to be kept in sync.

## Useful Files

- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [Goerli testnet addresses](./output/goerli.json)
- [`ChildChainGaugeTokenAdder` artifact](./artifact/ChildChainGaugeTokenAdder.json)
