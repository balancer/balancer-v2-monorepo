# 2023-02-15 - Single Recipient Gauge Factory V2

Deployment of the `SingleRecipientGaugeFactory`, for liquidity gauges which forward their entire BAL allowance onto a single address.
This version adds a weight cap to single recipient gauges, and supersedes [single recipient gauge factory V1](../deprecated/20220325-single-recipient-gauge-factory/).

Additionally, this version also supports the recipient implementing the `depositToken` function (from the `FeeDistributor` interface), directly depositing the tokens in such a distributor instead of requiring a manual step after minting.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Goerli testnet addresses](./output/goerli.json)
- [`SingleRecipientGaugeFactory` artifact](./artifact/SingleRecipientGaugeFactory.json)
- [`SingleRecipientGauge` artifact](./artifact/SingleRecipientGauge.json)
