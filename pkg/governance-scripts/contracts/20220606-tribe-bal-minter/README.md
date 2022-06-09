# Tribe BAL Minting Coordinator

This contract mints the amount of BAL which would be claimable by the Tribe's [VeBalDelegatorPCVDeposit](https://etherscan.io/address/0xc4EAc760C2C631eE0b064E39888b89158ff808B2#code) if it were able to call `mint` on the `BalancerMinter` contract. As this BAL is provably unmintable, we can circumvent the `BalancerMinter` to mint this BAL safely without risk of a "double spend".

## Governance proposal

<https://forum.balancer.fi/t/tribe-dao-unclaimable-bal-rewards/3196>

## Deployment

[Deployment task here](../../deployments/tasks/20220606-tribe-bal-minter-coordinator)
