# Tribe BAL Minting Coordinator

> ⚠️ **OBSOLETE** ⚠️
>
> This script has already been executed and is no longer maintained, and as such its source code has been deleted from the repository.
> Refer to commit `35f610525e9ef2bc0840a55a2cb866bec9e560ae` for the last updated version.

This contract mints the amount of BAL which would be claimable by the Tribe's [VeBalDelegatorPCVDeposit](https://etherscan.io/address/0xc4EAc760C2C631eE0b064E39888b89158ff808B2#code) if it were able to call `mint` on the `BalancerMinter` contract. As this BAL is provably unmintable, we can circumvent the `BalancerMinter` to mint this BAL safely without risk of a "double spend".

## Governance proposal

<https://forum.balancer.fi/t/tribe-dao-unclaimable-bal-rewards/3196>

## Deployment

[Deployment task here](https://github.com/balancer/balancer-deployments/tasks/scripts/20220606-tribe-bal-minter-coordinator)
