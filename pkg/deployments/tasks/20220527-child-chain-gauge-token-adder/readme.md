# 2022-05-27 - Child Chain Gauge Token Adder

Deployment of the Child Chain Gauge Token Adder, which is used to add reward tokens to Rewards Only Gauges, the standard child chain gauge. Unlike the L1 liquidity gauges, we need this in child chains as Rewards Only Gauges are composed of gauge and streamer, and both need to be kept in sync.

## Useful Files

- [Polygon addresses](./output/polygon.json)
- [Arbitrum addresses](./output/arbitrum.json)
- [Optimism addresses](./output/optimism.json)
- [`ChildChainGaugeTokenAdder` ABI](./abi/ChildChainGaugeTokenAdder.json)
