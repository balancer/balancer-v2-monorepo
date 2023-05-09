# 2023-05-04 - Voting Escrow Remapper

Deployment of the `VotingEscrowRemapper` contract, which allows delegating veBAL balances in mainnet to a different address in L2s and sidechains.
This feature is useful for contract accounts with veBAL in mainnet, since the same address might not be accessible in other networks.

This deployment also contains the `OmniVotingEscrowAdaptor` auxiliary contract, which is an intermediary between the remapper and the veBAL bridge from LayerZero.

## Useful Files

- [`OmniVotingEscrowAdaptor` artifact](./artifact/OmniVotingEscrowAdaptor.json)
- [`VotingEscrowRemapper` artifact](./artifact/VotingEscrowRemapper.json)
