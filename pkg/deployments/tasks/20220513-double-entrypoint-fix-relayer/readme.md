# 2022-05-13 - Double Entrypoint Fix Relayer

Deployment of the Double Entrypoint Fix Relayer, which is used to safely sweep funds into the Protocol Fee Collector, and then lets LPs exit the related pools proportionally. See [the forum post](https://forum.balancer.fi/t/medium-severity-bug-found/3161) for more information.

The relayer is mostly useful on mainnet, as it included mainnet hardcoded addresses, but deployments on Polygon and Arbitrum were also made in case the sweeping functionality is required at a moment's notice.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [Polygon addresses](./output/polygon.json)
- [Arbitrum addresses](./output/arbitrum.json)
- [`DoubleEntryPointFixRelayer` ABI](./abi/DoubleEntryPointFixRelayer.json)
