# 2023-03-16 - L2 Voting Escrow Delegation Proxy

Deployment of `VotingEscrowDelegationProxy`, for delegation of veBAL-related boosts in networks other than Mainnet.
The proxy does not have a VE delegation implementation by default, so it has to be set after deployment by governance.
While the delegation implementation is not set the default `NullVotingEscrow` shall be used, making the total supply
of veBAL in the chain effectively 0.

## Useful Files

- [`NullVotingEscrow` artifact](./artifact/NullVotingEscrow.json)
- [`VotingEscrowDelegationProxy` artifact](./artifact/VotingEscrowDelegationProxy.json)
