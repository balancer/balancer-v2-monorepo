# 2023-03-16 - L2 Voting Escrow Delegation Proxy

Deployment of `VotingEscrowDelegationProxy`, for delegation of veBAL-related boosts in networks other than Mainnet.
The proxy does not have a VE delegation implementation by default, so it has to be set after deployment by governance.
While the delegation implementation is not set the default `NullVotingEscrow` shall be used, making the total supply
of veBAL in the chain effectively 0.
The proxy itself is the same as the [L1 proxy](../20220325-ve-delegation), except it also exposes `totalSupply`, which makes writing L2 gauges simpler as they do not need to rely on the existence of a VE contract.

## Useful Files

- [Polygon mainnet addresses](./output/polygon.json)
- [Arbitrum mainnet addresses](./output/arbitrum.json)
- [Optimism mainnet addresses](./output/optimism.json)
- [Gnosis mainnet addresses](./output/gnosis.json)
- [Avalanche mainnet addresses](./output/avalanche.json)
- [Polygon zkeVM mainnet addresses](./output/zkevm.json)
- [Goerli testnet addresses](./output/goerli.json)
- [Sepolia testnet addresses](./output/sepolia.json)
- [`NullVotingEscrow` artifact](./artifact/NullVotingEscrow.json)
- [`VotingEscrowDelegationProxy` artifact](./artifact/VotingEscrowDelegationProxy.json)
