# 2022-06-06 - Tribe BAL Minting Coordinator

Deployment of the Tribe BAL Minting Coordinator, which is used to mint the amount of BAL which would be claimable by the Tribe's [VeBalDelegatorPCVDeposit](https://etherscan.io/address/0xc4EAc760C2C631eE0b064E39888b89158ff808B2#code) if it were able to call `mint` on the `BalancerMinter` contract. As this BAL is provably unmintable, we can circumvent the `BalancerMinter` to mint this BAL safely without risk of a "double spend".

See [the forum post](https://forum.balancer.fi/t/tribe-dao-unclaimable-bal-rewards/3196) for more information.

## Useful Files

- [Ethereum mainnet addresses](./output/mainnet.json)
- [`TribeBALMinterCoordinator` ABI](./abi/TribeBALMinterCoordinator.json)
