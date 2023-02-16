# 2023-01-23 - L2 Gauge Checkpointer V2

Deployment of the `L2GaugeCheckpointer` contract. It automates the process of performing checkpoints to stakeless root gauges.
This version:
- Is compatible with the `AuthorizerAdaptorEntrypoint`
- Allows checkpointing gauges from a single network
- Includes minor fixes to consider Arbitrum gauges created in different factories

## Useful Files

- [`L2GaugeCheckpointer` artifact](./artifact/L2GaugeCheckpointer.json)
