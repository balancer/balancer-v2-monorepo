The following is the output of a complete test run.

## Test Methodology

The pvt/common and pvt/helpers directory contains useful primitives used by many tests.

The output reflects the general best practices for unit test creation:

* describe("Contract under test")
  * describe("Feature")
    * context("Configuration for a set of tests - this can be nested as needed, for complex cases")
      * it("individual tests within a given configuration (e.g., 'caller is owner', 'caller is not owner', etc.")
      
        It is important that the text description accurately reflects the content of the test,

        and that *only* the feature describe is tested.

        Ideally, the concatenation of descriptive texts for any given test forms a clear, understandable narrative.

## Test Coverage

It was not possible to run standard coverage tests on this code, since those rely on standard `require` statements with
revert reasons. To conserve bytecode, we replaced this with custom assembly-coded `_require` function calls that return
codes instead of standard revert strings.

For more detail, see the [Coveralls Report](https://coveralls.io/github/balancer-labs/balancer-core).

```
➤ YN0000: [@balancer-labs/v2-deployments]: Running normal tests...
➤ YN0000: [@balancer-labs/v2-deployments]: 
➤ YN0000: [@balancer-labs/v2-deployments]: 
➤ YN0000: [@balancer-labs/v2-deployments]:   StablePoolFactory
➤ YN0000: [@balancer-labs/v2-deployments]:     with no previous deploy
➤ YN0000: [@balancer-labs/v2-deployments]:       when forced
➤ YN0000: [@balancer-labs/v2-deployments]:         ✓ deploys a stable pool factory (7489ms)
➤ YN0000: [@balancer-labs/v2-deployments]:       when not forced
➤ YN0000: [@balancer-labs/v2-deployments]:         ✓ deploys a stable pool factory (558ms)
➤ YN0000: [@balancer-labs/v2-deployments]:     with a previous deploy
➤ YN0000: [@balancer-labs/v2-deployments]:       when forced
➤ YN0000: [@balancer-labs/v2-deployments]:         ✓ re-deploys the stable pool factory (1246ms)
➤ YN0000: [@balancer-labs/v2-deployments]:       when not forced
➤ YN0000: [@balancer-labs/v2-deployments]:         ✓ does not re-deploys the stable pool factory
➤ YN0000: [@balancer-labs/v2-deployments]: 
➤ YN0000: [@balancer-labs/v2-deployments]: 
➤ YN0000: [@balancer-labs/v2-deployments]:   4 passing (9s)
➤ YN0000: [@balancer-labs/v2-deployments]: 
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]: Nothing to compile
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]: 
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]: 
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:   Aave Asset manager
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:     claimRewards
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       ✓ sends expected amount of stkAave to the rewards contract (352ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       ✓ distributes the reward according to the fraction of staked LP tokens (364ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]: 
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:   RebalancingRelayer
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:     vault
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       ✓ uses the given vault
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:     join
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       when going through the relayer
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:         when the relayer is allowed to join
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when the user did allow the relayer
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ joins the pool (782ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ rebalances the pool (563ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ returns any extra value to the sender (752ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when the user did not allow the relayer
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ reverts (467ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when the relayer is not allowed to join
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       when going through the vault
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:     exit
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       when going through the relayer
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:         when the relayer is allowed to exit
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when the user did allow the relayer
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             when pool has enough cash to process exit
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:               ✓ exits the pool (753ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:               ✓ rebalances the pool (659ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             when pool does not have enough cash to process exit
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:               ✓ exits the pool (779ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:               ✓ rebalances the pool (683ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when the user did not allow the relayer
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when the relayer is not allowed to exit
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       when going through the vault
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]: 
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:   Rewards Asset manager
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:     deployment
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       ✓ different managers can be set for different tokens
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:     setConfig
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       ✓ allows a pool controller to set the pools target investment config
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       ✓ emits an event
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       ✓ reverts when setting upper critical over 100%
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       ✓ reverts when setting upper critical below target
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       ✓ reverts when setting target above 95%
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       ✓ reverts when setting lower critical above target
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       ✓ prevents an unauthorized user from setting the pool config
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:     rebalance
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       when pool is above target investment level
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:         when pool is in non-critical range
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           ✓ shouldRebalance returns false
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when forced
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ emits a Rebalance event
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ transfers the expected number of tokens to the Vault
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ returns the pool to its target allocation
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ updates the pool's managed balance on the vault correctly
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when not forced
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ skips the rebalance
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:         when pool is above upper critical investment level
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           ✓ shouldRebalance returns true
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when forced
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ emits a Rebalance event
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ transfers the expected number of tokens to the Vault (255ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ returns the pool to its target allocation
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ updates the pool's managed balance on the vault correctly
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when not forced
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ emits a Rebalance event
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ transfers the expected number of tokens to the Vault (335ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ returns the pool to its target allocation
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ updates the pool's managed balance on the vault correctly
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:       when pool is below target investment level
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:         when pool is in non-critical range
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           ✓ shouldRebalance returns false
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when forced
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ emits a Rebalance event
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ transfers the expected number of tokens to the Vault (307ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ returns the pool to its target allocation
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ updates the pool's managed balance on the vault correctly
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when not forced
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ skips the rebalance
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:         when pool is below lower critical investment level
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           ✓ shouldRebalance returns true
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when forced
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ emits a Rebalance event (357ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ transfers the expected number of tokens to the Vault (267ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ returns the pool to its target allocation
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ updates the pool's managed balance on the vault correctly
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:           when not forced
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ emits a Rebalance event
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ transfers the expected number of tokens to the Vault (266ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ returns the pool to its target allocation
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:             ✓ updates the pool's managed balance on the vault correctly (302ms)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]: 
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]: 
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]:   54 passing (41s)
➤ YN0000: [@balancer-labs/v2-asset-manager-utils]: 
➤ YN0000: [@balancer-labs/v2-distributors]: Nothing to compile
➤ YN0000: [@balancer-labs/v2-distributors]: 
➤ YN0000: [@balancer-labs/v2-distributors]: 
➤ YN0000: [@balancer-labs/v2-distributors]:   MerkleRedeem
➤ YN0000: [@balancer-labs/v2-distributors]:     ✓ stores an allocation (284ms)
➤ YN0000: [@balancer-labs/v2-distributors]:     ✓ emits RewardAdded when an allocation is stored (252ms)
➤ YN0000: [@balancer-labs/v2-distributors]:     ✓ requisitions tokens when it stores a balance
➤ YN0000: [@balancer-labs/v2-distributors]:     ✓ reverts when unauthorized to seed allocation
➤ YN0000: [@balancer-labs/v2-distributors]:     ✓ stores multiple allocations
➤ YN0000: [@balancer-labs/v2-distributors]:     with an allocation
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ allows the user to claimWeek (255ms)
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ emits RewardPaid when an allocation is claimed
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ marks claimed weeks as claimed
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ allows the user to claimWeek to internal balance
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ reverts when a user attempts to claim for another user
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ reverts when the user attempts to claim the wrong balance
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ reverts when the user attempts to claim twice
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ reverts when an admin attempts to overwrite an allocationn
➤ YN0000: [@balancer-labs/v2-distributors]:     with several allocations
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ allows the user to claim multiple weeks at once
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ reports weeks as unclaimed
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ returns an array of merkle roots
➤ YN0000: [@balancer-labs/v2-distributors]:       When a user has claimed one of their allocations
➤ YN0000: [@balancer-labs/v2-distributors]:         ✓ reports one of the weeks as claimed
➤ YN0000: [@balancer-labs/v2-distributors]: 
➤ YN0000: [@balancer-labs/v2-distributors]:   Staking contract
➤ YN0000: [@balancer-labs/v2-distributors]:     isAllowlistedRewarder
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ allows thet asset managers to allowlist themselves
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ allows the owner to allowlist someone
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ returns false for random users
➤ YN0000: [@balancer-labs/v2-distributors]:     addReward
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ sets up a reward for an asset manager
➤ YN0000: [@balancer-labs/v2-distributors]:     stakeWithPermit
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ stakes with a permit signature
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ stakes with a permit signature to a recipient
➤ YN0000: [@balancer-labs/v2-distributors]:     with two stakes
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ sends expected amount of reward token to the rewards contract
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ emits RewardAdded when an allocation is stored
➤ YN0000: [@balancer-labs/v2-distributors]:       when the rewarder has called notifyRewardAmount
➤ YN0000: [@balancer-labs/v2-distributors]:         ✓ distributes the reward according to the fraction of staked LP tokens
➤ YN0000: [@balancer-labs/v2-distributors]:         ✓ allows a user to claim the reward to an EOA
➤ YN0000: [@balancer-labs/v2-distributors]:         ✓ allows a user to claim the reward to internal balance
➤ YN0000: [@balancer-labs/v2-distributors]:         ✓ emits RewardPaid when an allocation is claimed
➤ YN0000: [@balancer-labs/v2-distributors]:       with a second distribution from the same rewarder
➤ YN0000: [@balancer-labs/v2-distributors]:         ✓ calculates totalEarned from both distributions
➤ YN0000: [@balancer-labs/v2-distributors]:       with a second distributions from another rewarder
➤ YN0000: [@balancer-labs/v2-distributors]:         ✓ calculates totalEarned from both distributions
➤ YN0000: [@balancer-labs/v2-distributors]:     with two pools
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ allows you to claim across multiple pools (431ms)
➤ YN0000: [@balancer-labs/v2-distributors]:       - emits RewardPaid for each pool
➤ YN0000: [@balancer-labs/v2-distributors]: 
➤ YN0000: [@balancer-labs/v2-distributors]:   Staking contract
➤ YN0000: [@balancer-labs/v2-distributors]:     with a stake and a reward
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ allows a user to claim the reward to a callback contract
➤ YN0000: [@balancer-labs/v2-distributors]:       ✓ calls the callback on the contract
➤ YN0000: [@balancer-labs/v2-distributors]: 
➤ YN0000: [@balancer-labs/v2-distributors]:   Reinvestor
➤ YN0000: [@balancer-labs/v2-distributors]:     with a stake and a reward
➤ YN0000: [@balancer-labs/v2-distributors]:       with a pool to claim into
➤ YN0000: [@balancer-labs/v2-distributors]:         ✓ emits PoolBalanceChanged when a LP claims to weighted pool (413ms)
➤ YN0000: [@balancer-labs/v2-distributors]:         ✓ mints bpt to a LP when they claim to weighted pool (380ms)
➤ YN0000: [@balancer-labs/v2-distributors]:         addReward
➤ YN0000: [@balancer-labs/v2-distributors]:           ✓ returns rewards that are unused in reinvestment (438ms)
➤ YN0000: [@balancer-labs/v2-distributors]: 
➤ YN0000: [@balancer-labs/v2-distributors]: 
➤ YN0000: [@balancer-labs/v2-distributors]:   37 passing (41s)
➤ YN0000: [@balancer-labs/v2-distributors]:   1 pending
➤ YN0000: [@balancer-labs/v2-distributors]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]: Nothing to compile
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]:   BalancerErrors
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     ✓ encodes the error code as expected
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     ✓ translates the error code to its corresponding string if existent
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]:   BasePoolCodeFactory
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     ✓ returns the contract creation code storage addresses
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     ✓ returns the contract creation code
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     ✓ creates a contract
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     when the creation reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ reverts and bubbles up revert reasons
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     with a created pool
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ deploys correct bytecode
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ passes constructor arguments correctly
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]:   CodeDeployer
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     with no code
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ stores its constructor argument as its code
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     with some code
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ stores its constructor argument as its code
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     with code 24kB long
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ stores its constructor argument as its code
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     with code over 24kB long
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]:   ERC20
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     info
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ setups the name properly
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ setups the symbol properly
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ setups the decimals properly
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     total supply
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when there is no supply
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ returns zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when there is some supply
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ returns the existing supply
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     balanceOf
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when the requested account has no tokens
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ returns zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when the requested account has some tokens
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ returns the total amount of tokens
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     transfer
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when the recipient is not the zero address
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the given amount is zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ transfers the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ does not affect the supply
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ emits a transfer event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the given amount is greater than zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when the sender does not have enough balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when the sender has enough balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ transfers the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ does not affect the supply
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ emits a transfer event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when the recipient is the zero address
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     transfer from
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when the token holder is not the zero address
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the recipient is not the zero address
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when the spender has enough approved balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             when the token holder has enough balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               ✓ transfers the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               ✓ does not affect the supply
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               ✓ does not affect the spender balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               ✓ emits a transfer event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               ✓ decreases the spender allowance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             when the token holder does not have enough balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when the spender does not have enough approved balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             when the token holder has enough balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             when the token holder does not have enough balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the recipient is the zero address
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when the token holder is the zero address
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     approve
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when the spender is not the zero address
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the sender has enough balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when there was no approved amount before
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when the spender had an approved amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the sender does not have enough balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when there was no approved amount before
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when the spender had an approved amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when the spender is the zero address
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the sender has enough balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when there was no approved amount before
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when the spender had an approved amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the sender does not have enough balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when there was no approved amount before
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when the spender had an approved amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     mint
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when the recipient is not the zero address
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the given amount is zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ mints the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ increases the supply
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ emits a transfer event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the given amount is greater than zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ mints the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ increases the supply
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ emits a transfer event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when the recipient is the zero address
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the given amount is zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ mints the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ increases the supply
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ emits a transfer event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the given amount is greater than zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ mints the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ increases the supply
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ emits a transfer event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     burn
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when the given amount is zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ burns the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ decreases the supply
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ emits a transfer event
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when the given amount is greater than zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the sender does not have enough balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the sender has enough balance
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ burns the requested amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ decreases the supply
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ emits a transfer event
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]:   ERC20Permit
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     info
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ setups the name properly
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     permit
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ initial nonce is zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ accepts holder signature (328ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       with invalid signature
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         with reused signature
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         with signature for other holder
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         with signature for other spender
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         with signature for other amount
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         with signature for other token
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         with signature with invalid nonce
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         with expired deadline
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]:   EnumerableMap
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     EnumerableIERC20ToBytes32Map
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ starts empty
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       set
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ adds a key
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ adds several keys (389ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ returns false when adding keys already in the set
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ updates values for keys already in the set
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       get
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ returns the value for a key
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ reverts with a custom message if the key is not in the map
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       unchecked_indexOf
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ returns the index of an added key, plus one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ adding and removing keys can change the index
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ returns a zero index if the key is not in the map
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       unchecked_setAt
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ updates a value
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ updates several values (252ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ does not revert when setting indexes outside of the map
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       unchecked_at
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ returns an entry at an index
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ does not revert when accessing indexes outside of the map
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       unchecked_valueAt
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ returns a value at an index
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ does not revert when accessing indexes outside of the map
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       remove
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ removes added keys
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ returns false when removing keys not in the set
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ adds and removes multiple keys (535ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]:   LogCompression
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     small values
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 1 (307ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 2 (258ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 3 (309ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 4 (262ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     medium and large values
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 5 (273ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 6
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 7 (263ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 8 (414ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 9
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 10
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 11 (287ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 12
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 13
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 14
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 15
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 16 (258ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 17 (344ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 18 (269ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 19
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 20
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 21
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 22
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 23
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 24 (270ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 25
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 26
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 27
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 28
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 29 (255ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 30
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 31 (383ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 32 (281ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 33 (316ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ encodes and decodes powers of 34 (356ms)
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]:   ExpLog
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     exponent zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ handles base zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ handles base one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ handles base greater than one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     base zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ handles exponent zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ handles exponent one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ handles exponent greater than one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     base one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ handles exponent zero
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ handles exponent one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ handles exponent greater than one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     decimals
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ handles decimals properly
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     max values
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ cannot handle a base greater than 2^255 - 1
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ cannot handle an exponent greater than (2^254/1e20) - 1
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]:   ReentrancyGuard
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     ✓ does not allow remote callback
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     ✓ does not allow local recursion
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     ✓ does not allow indirect local recursion
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]:   SignaturesValidator
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     decoding
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when there is no signature encoded
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ decodes empty data
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when there is a signature encoded
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ decodes it properly
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     authenticate
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when there is no extra calldata given
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when there is some extra calldata given
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the extra calldata is malformed
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when the extra calldata is well formed
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when the signature allows the sender
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             when the given nonce is the next one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               when the authorized data is correct
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ allows the sender
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ increases the nonce of the user
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ does not allow using the same signature twice
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               when the authorized functionality is not correct
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             when the given nonce is a past one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               when the authorized data is correct
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               when the authorized functionality is not correct
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             when the given nonce is a future one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               when the authorized data is correct
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               when the authorized functionality is not correct
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           when the signature allows another sender
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             when the given nonce is the next one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               when the authorized data is correct
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               when the authorized functionality is not correct
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             when the given nonce is a past one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               when the authorized data is correct
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               when the authorized functionality is not correct
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             when the given nonce is a future one
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               when the authorized data is correct
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:               when the authorized functionality is not correct
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ YN0000: [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]:   TemporarilyPausable
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     initialization
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ can be initialized with pause window and buffer period duration
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ can be initialized with no pause window or buffer period duration
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ cannot be initialized with a pause window greater than 90 days
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       ✓ cannot be initialized with a buffer period greater than 30 days
➤ YN0000: [@balancer-labs/v2-solidity-utils]:     pause/unpause
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       before the pause window end date
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ can be paused
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         ✓ can be paused and unpaused
➤ YN0000: [@balancer-labs/v2-solidity-utils]:       when the pause window end date has been reached
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when unpaused
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           before the buffer period end date
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ is unpaused
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ cannot be paused
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           after the buffer period end date
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ is unpaused
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ cannot be paused
➤ YN0000: [@balancer-labs/v2-solidity-utils]:         when paused
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           before the buffer period end date
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ is paused
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ can be unpaused
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ cannot be unpaused and paused
➤ YN0000: [@balancer-labs/v2-solidity-utils]:           after the buffer period end date
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ is unpaused
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ cannot be paused
➤ YN0000: [@balancer-labs/v2-solidity-utils]:             ✓ cannot be unpaused
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-solidity-utils]:   198 passing (29s)
➤ YN0000: [@balancer-labs/v2-solidity-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-stable]: Nothing to compile
➤ YN0000: [@balancer-labs/v2-pool-stable]: 
➤ YN0000: [@balancer-labs/v2-pool-stable]: 
➤ YN0000: [@balancer-labs/v2-pool-stable]:   StableMath
➤ YN0000: [@balancer-labs/v2-pool-stable]:     invariant
➤ YN0000: [@balancer-labs/v2-pool-stable]:       two tokens
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ returns invariant (702ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ returns invariant equals analytical solution
➤ YN0000: [@balancer-labs/v2-pool-stable]:       three tokens
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ returns invariant
➤ YN0000: [@balancer-labs/v2-pool-stable]:     in given out
➤ YN0000: [@balancer-labs/v2-pool-stable]:       two tokens
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ returns in given out
➤ YN0000: [@balancer-labs/v2-pool-stable]:       three tokens
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ returns in given out
➤ YN0000: [@balancer-labs/v2-pool-stable]:     out given in
➤ YN0000: [@balancer-labs/v2-pool-stable]:       two tokens
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ returns out given in
➤ YN0000: [@balancer-labs/v2-pool-stable]:       three tokens
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ returns out given in (262ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:     protocol swap fees
➤ YN0000: [@balancer-labs/v2-pool-stable]:       two tokens
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ returns protocol swap fees
➤ YN0000: [@balancer-labs/v2-pool-stable]:       three tokens
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ returns protocol swap fees
➤ YN0000: [@balancer-labs/v2-pool-stable]: 
➤ YN0000: [@balancer-labs/v2-pool-stable]:   StablePool
➤ YN0000: [@balancer-labs/v2-pool-stable]:     for a 1 token pool
➤ YN0000: [@balancer-labs/v2-pool-stable]:       ✓ reverts if there is a single token (1847ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:     for a 2 token pool
➤ YN0000: [@balancer-labs/v2-pool-stable]:       creation
➤ YN0000: [@balancer-labs/v2-pool-stable]:         when the creation succeeds
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets the vault
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ uses general specialization
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ registers tokens in the vault
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ starts with no BPT
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets the asset managers
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets amplification
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets swap fee
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets the name
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets the symbol
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets the decimals
➤ YN0000: [@balancer-labs/v2-pool-stable]:         when the creation fails
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if there are repeated tokens (1782ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if the swap fee is too high (741ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if amplification coefficient is too high (657ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if amplification coefficient is too low (1081ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:       onJoinPool
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ fails if caller is not the vault
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ fails if no user data
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ fails if wrong user data
➤ YN0000: [@balancer-labs/v2-pool-stable]:         initialization
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ grants the invariant amount of BPT
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ fails if already initialized (329ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-stable]:         join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ fails if not initialized
➤ YN0000: [@balancer-labs/v2-pool-stable]:           once initialized
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ grants BPT for exact tokens
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ can tell how much BPT it will give in return
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ fails if not enough BPT
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ reverts if paused (367ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:         join token in for exact BPT out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ fails if not initialized
➤ YN0000: [@balancer-labs/v2-pool-stable]:           once initialized
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ grants exact BPT for token in (289ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ can tell how many token amounts it will have to receive
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-stable]:       onExitPool
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ fails if caller is not the vault
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ fails if no user data
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ fails if wrong user data
➤ YN0000: [@balancer-labs/v2-pool-stable]:         exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ grants one token for exact bpt
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ can tell how many tokens it will give in return
➤ YN0000: [@balancer-labs/v2-pool-stable]:         exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ grants all tokens for exact bpt (276ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ fully exit (287ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ can tell how many token amounts it will give in return
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ does not revert if paused (341ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:         exit BPT in for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ grants exact tokens for bpt (294ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ can tell how much BPT it will have to receive
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ fails if more BTP needed
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-stable]:       swaps
➤ YN0000: [@balancer-labs/v2-pool-stable]:         given in
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ calculates amount out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ calculates the same amount regardless of the interface used
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused (258ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:         given out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ calculates amount in
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ calculates the same amount regardless of the interface used
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-stable]:       protocol swap fees
➤ YN0000: [@balancer-labs/v2-pool-stable]:         without balance changes
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ joins and exits do not accumulate fees (1232ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:         with previous swap
➤ YN0000: [@balancer-labs/v2-pool-stable]:           with same amplification parameter
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on join exact tokens in for BPT out (282ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ does not charges fee on exit if paused (299ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           with different amplification parameter
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ does not charges fee on exit if paused
➤ YN0000: [@balancer-labs/v2-pool-stable]:       get rate
➤ YN0000: [@balancer-labs/v2-pool-stable]:         before initialized
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ rate is zero
➤ YN0000: [@balancer-labs/v2-pool-stable]:         once initialized
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ rate equals to one
➤ YN0000: [@balancer-labs/v2-pool-stable]:       set amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:         when the sender is allowed
➤ YN0000: [@balancer-labs/v2-pool-stable]:           when requesting a reasonable change duration
➤ YN0000: [@balancer-labs/v2-pool-stable]:             when requesting a valid amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:               when increasing the amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:                 when increasing the amp by 2x
➤ YN0000: [@balancer-labs/v2-pool-stable]:                   when there was no previous ongoing update
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ starts changing the amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ stops updating after duration
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-pool-stable]:                   when there was a previous ongoing update
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ can stop and change
➤ YN0000: [@balancer-labs/v2-pool-stable]:               when decreasing the amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:                 when decreasing the amp by 2x
➤ YN0000: [@balancer-labs/v2-pool-stable]:                   when there was no previous ongoing update
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ starts changing the amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ stops updating after duration
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-pool-stable]:                   when there was a previous ongoing update
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ can stop and change
➤ YN0000: [@balancer-labs/v2-pool-stable]:             when requesting an invalid amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:               ✓ reverts when requesting below the min
➤ YN0000: [@balancer-labs/v2-pool-stable]:               ✓ reverts when requesting above the max
➤ YN0000: [@balancer-labs/v2-pool-stable]:               rate limits
➤ YN0000: [@balancer-labs/v2-pool-stable]:                 ✓ reverts when increasing the amp by more than 2x in a single day
➤ YN0000: [@balancer-labs/v2-pool-stable]:                 ✓ reverts when increasing the amp by more than 2x daily over multiple days
➤ YN0000: [@balancer-labs/v2-pool-stable]:                 ✓ reverts when decreasing the amp by more than 2x in a single day
➤ YN0000: [@balancer-labs/v2-pool-stable]:                 ✓ reverts when decreasing the amp by more than 2x daily over multiple days
➤ YN0000: [@balancer-labs/v2-pool-stable]:           when requesting a short duration change
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-stable]:         when the sender is not allowed
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-stable]:     for a 3 token pool
➤ YN0000: [@balancer-labs/v2-pool-stable]:       creation
➤ YN0000: [@balancer-labs/v2-pool-stable]:         when the creation succeeds
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets the vault
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ uses general specialization
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ registers tokens in the vault
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ starts with no BPT
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets the asset managers
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets amplification
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets swap fee
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets the name
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets the symbol
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ sets the decimals
➤ YN0000: [@balancer-labs/v2-pool-stable]:         when the creation fails
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if there are repeated tokens (1148ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if the swap fee is too high (425ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if amplification coefficient is too high (703ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if amplification coefficient is too low (648ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:       onJoinPool
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ fails if caller is not the vault
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ fails if no user data
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ fails if wrong user data
➤ YN0000: [@balancer-labs/v2-pool-stable]:         initialization
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ grants the invariant amount of BPT
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ fails if already initialized (297ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-stable]:         join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ fails if not initialized
➤ YN0000: [@balancer-labs/v2-pool-stable]:           once initialized
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ grants BPT for exact tokens (282ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ can tell how much BPT it will give in return
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ fails if not enough BPT
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ reverts if paused (279ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:         join token in for exact BPT out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ fails if not initialized
➤ YN0000: [@balancer-labs/v2-pool-stable]:           once initialized
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ grants exact BPT for token in
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ can tell how many token amounts it will have to receive
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ reverts if paused (269ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:       onExitPool
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ fails if caller is not the vault
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ fails if no user data
➤ YN0000: [@balancer-labs/v2-pool-stable]:         ✓ fails if wrong user data
➤ YN0000: [@balancer-labs/v2-pool-stable]:         exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ grants one token for exact bpt (375ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ can tell how many tokens it will give in return
➤ YN0000: [@balancer-labs/v2-pool-stable]:         exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ grants all tokens for exact bpt
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ fully exit
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ can tell how many token amounts it will give in return
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ does not revert if paused (253ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:         exit BPT in for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ grants exact tokens for bpt (257ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ can tell how much BPT it will have to receive
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ fails if more BTP needed
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused (280ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:       swaps
➤ YN0000: [@balancer-labs/v2-pool-stable]:         given in
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ calculates amount out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if using the minimal swap info interface
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if invalid token in index
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if invalid token out index
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-stable]:         given out
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ calculates amount in
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if using the minimal swap info interface
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if invalid token in index
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if invalid token out index
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-stable]:       protocol swap fees
➤ YN0000: [@balancer-labs/v2-pool-stable]:         without balance changes
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ joins and exits do not accumulate fees (1235ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:         with previous swap
➤ YN0000: [@balancer-labs/v2-pool-stable]:           with same amplification parameter
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ does not charges fee on exit if paused (449ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:           with different amplification parameter
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit BPT In for exact tokens out (253ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ does not charges fee on exit if paused (272ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:       get rate
➤ YN0000: [@balancer-labs/v2-pool-stable]:         before initialized
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ rate is zero
➤ YN0000: [@balancer-labs/v2-pool-stable]:         once initialized
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ rate equals to one
➤ YN0000: [@balancer-labs/v2-pool-stable]:       set amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:         when the sender is allowed
➤ YN0000: [@balancer-labs/v2-pool-stable]:           when requesting a reasonable change duration
➤ YN0000: [@balancer-labs/v2-pool-stable]:             when requesting a valid amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:               when increasing the amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:                 when increasing the amp by 2x
➤ YN0000: [@balancer-labs/v2-pool-stable]:                   when there was no previous ongoing update
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ starts changing the amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ stops updating after duration
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-pool-stable]:                   when there was a previous ongoing update
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ reverts (340ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ can stop and change (270ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]:               when decreasing the amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:                 when decreasing the amp by 2x
➤ YN0000: [@balancer-labs/v2-pool-stable]:                   when there was no previous ongoing update
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ starts changing the amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ stops updating after duration
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-pool-stable]:                   when there was a previous ongoing update
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-stable]:                     ✓ can stop and change
➤ YN0000: [@balancer-labs/v2-pool-stable]:             when requesting an invalid amp
➤ YN0000: [@balancer-labs/v2-pool-stable]:               ✓ reverts when requesting below the min
➤ YN0000: [@balancer-labs/v2-pool-stable]:               ✓ reverts when requesting above the max
➤ YN0000: [@balancer-labs/v2-pool-stable]:               rate limits
➤ YN0000: [@balancer-labs/v2-pool-stable]:                 ✓ reverts when increasing the amp by more than 2x in a single day
➤ YN0000: [@balancer-labs/v2-pool-stable]:                 ✓ reverts when increasing the amp by more than 2x daily over multiple days
➤ YN0000: [@balancer-labs/v2-pool-stable]:                 ✓ reverts when decreasing the amp by more than 2x in a single day
➤ YN0000: [@balancer-labs/v2-pool-stable]:                 ✓ reverts when decreasing the amp by more than 2x daily over multiple days
➤ YN0000: [@balancer-labs/v2-pool-stable]:           when requesting a short duration change
➤ YN0000: [@balancer-labs/v2-pool-stable]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-stable]:         when the sender is not allowed
➤ YN0000: [@balancer-labs/v2-pool-stable]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-stable]:     for a too-many token pool
➤ YN0000: [@balancer-labs/v2-pool-stable]:       ✓ reverts if there are too many tokens (2165ms)
➤ YN0000: [@balancer-labs/v2-pool-stable]: 
➤ YN0000: [@balancer-labs/v2-pool-stable]: 
➤ YN0000: [@balancer-labs/v2-pool-stable]:   173 passing (1m)
➤ YN0000: [@balancer-labs/v2-pool-stable]: 
➤ YN0000: [@balancer-labs/v2-standalone-utils]: Nothing to compile
➤ YN0000: [@balancer-labs/v2-standalone-utils]: 
➤ YN0000: [@balancer-labs/v2-standalone-utils]: 
➤ YN0000: [@balancer-labs/v2-standalone-utils]:   BalancerHelpers
➤ YN0000: [@balancer-labs/v2-standalone-utils]:     queryJoin
➤ YN0000: [@balancer-labs/v2-standalone-utils]:       ✓ can query join results (319ms)
➤ YN0000: [@balancer-labs/v2-standalone-utils]:       ✓ bubbles up revert reasons
➤ YN0000: [@balancer-labs/v2-standalone-utils]:     queryExit
➤ YN0000: [@balancer-labs/v2-standalone-utils]:       ✓ can query exit results
➤ YN0000: [@balancer-labs/v2-standalone-utils]:       ✓ bubbles up revert reasons
➤ YN0000: [@balancer-labs/v2-standalone-utils]: 
➤ YN0000: [@balancer-labs/v2-standalone-utils]: 
➤ YN0000: [@balancer-labs/v2-standalone-utils]:   4 passing (8s)
➤ YN0000: [@balancer-labs/v2-standalone-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-utils]: Nothing to compile
➤ YN0000: [@balancer-labs/v2-pool-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-utils]:   BalancerPoolToken
➤ YN0000: [@balancer-labs/v2-pool-utils]:     transfer from
➤ YN0000: [@balancer-labs/v2-pool-utils]:       when the recipient is not the zero address
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the spender is the token holder
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ transfers the requested amount (639ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ does not affect the supply
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ does not affect the spender balance (325ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ emits a transfer event
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the token holder does not have enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts (277ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ does not emit an approval event
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the spender has enough approved balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ transfers the requested amount (356ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ does not affect the supply
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ does not affect the spender balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ emits a transfer event
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the token holder does not have enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ decreases the spender allowance (278ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the spender has an infinite approved balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ transfers the requested amount
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ does not affect the supply
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ does not affect the spender balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ emits a transfer event
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the token holder does not have enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ does not decrease the spender allowance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ does not emit an approval event
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the spender does not have enough approved balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the token holder does not have enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:       when the recipient is the zero address
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:     decreaseAllowance
➤ YN0000: [@balancer-labs/v2-pool-utils]:       when the spender is not the zero address
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the sender has enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when there was no approved amount before
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the spender had an approved amount
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the sender does not have enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when there was no approved amount before
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the spender had an approved amount
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-pool-utils]:       when the spender is the zero address
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the sender has enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when there was no approved amount before
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the spender had an approved amount
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the sender does not have enough balance
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when there was no approved amount before
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the spender had an approved amount
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ YN0000: [@balancer-labs/v2-pool-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-utils]:   BasePool
➤ YN0000: [@balancer-labs/v2-pool-utils]:     deployment
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ registers a pool in the vault (3514ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ reverts if the tokens are not sorted
➤ YN0000: [@balancer-labs/v2-pool-utils]:     authorizer
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ uses the authorizer of the vault
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ tracks authorizer changes in the vault
➤ YN0000: [@balancer-labs/v2-pool-utils]:       action identifiers
➤ YN0000: [@balancer-labs/v2-pool-utils]:         with same pool creator
➤ YN0000: [@balancer-labs/v2-pool-utils]:           ✓ pools share action identifiers (4825ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:         with different pool creators
➤ YN0000: [@balancer-labs/v2-pool-utils]:           ✓ pools have unique action identifiers (4234ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:     swap fee
➤ YN0000: [@balancer-labs/v2-pool-utils]:       initialization
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ has an initial swap fee (1904ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:       set swap fee percentage
➤ YN0000: [@balancer-labs/v2-pool-utils]:         with a delegated owner
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the sender has the set fee permission in the authorizer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when the new swap fee percentage is within bounds
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can change the swap fee
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ emits an event
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when the new swap fee percentage is above the maximum
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when the new swap fee percentage is below the minimum
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the sender does not have the set fee permission in the authorizer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:         with an owner
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the sender is the owner
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when the new swap fee percentage is within bounds
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can change the swap fee
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ emits an event
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when the new swap fee percentage is above the maximum
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when the new swap fee percentage is below the minimum
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the sender is not the owner
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when the sender does not have the set fee permission in the authorizer
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when the sender has the set fee permission in the authorizer
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:     set paused
➤ YN0000: [@balancer-labs/v2-pool-utils]:       with a delegated owner
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the sender does not have the pause permission in the authorizer
➤ YN0000: [@balancer-labs/v2-pool-utils]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the sender has the pause permission in the authorizer
➤ YN0000: [@balancer-labs/v2-pool-utils]:           ✓ can pause
➤ YN0000: [@balancer-labs/v2-pool-utils]:           ✓ can unpause
➤ YN0000: [@balancer-labs/v2-pool-utils]:           ✓ cannot unpause after the pause window
➤ YN0000: [@balancer-labs/v2-pool-utils]:       with an owner
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the sender is the owner
➤ YN0000: [@balancer-labs/v2-pool-utils]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the sender is not the owner
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the sender does not have the pause permission in the authorizer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the sender has the pause permission in the authorizer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ can pause
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ can unpause
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ cannot unpause after the pause window
➤ YN0000: [@balancer-labs/v2-pool-utils]:     misc data
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ stores the swap fee pct in the most-significant 64 bits
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ can store up-to 192 bits of extra data (2642ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-utils]:   RelayedBasePool
➤ YN0000: [@balancer-labs/v2-pool-utils]:     relayer
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ uses the given relayer
➤ YN0000: [@balancer-labs/v2-pool-utils]:     join
➤ YN0000: [@balancer-labs/v2-pool-utils]:       when the relayer tells it has not called the pool
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:       when the relayer tells it has called the pool
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ does not revert (312ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:     exit
➤ YN0000: [@balancer-labs/v2-pool-utils]:       when the relayer tells it has not called the pool
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:       when the relayer tells it has called the pool
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ does not revert
➤ YN0000: [@balancer-labs/v2-pool-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-utils]:   BasePoolFactory
➤ YN0000: [@balancer-labs/v2-pool-utils]:     ✓ stores the vault address
➤ YN0000: [@balancer-labs/v2-pool-utils]:     ✓ creates a pool
➤ YN0000: [@balancer-labs/v2-pool-utils]:     with a created pool
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ tracks pools created by the factory
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ does not track pools that were not created by the factory
➤ YN0000: [@balancer-labs/v2-pool-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-utils]:   BasePoolSplitCodeFactory
➤ YN0000: [@balancer-labs/v2-pool-utils]:     ✓ stores the vault address
➤ YN0000: [@balancer-labs/v2-pool-utils]:     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-pool-utils]:     with a created pool
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ tracks pools created by the factory
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ does not track pools that were not created by the factory
➤ YN0000: [@balancer-labs/v2-pool-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-utils]:   FactoryWidePauseWindow
➤ YN0000: [@balancer-labs/v2-pool-utils]:     before the pause window end time
➤ YN0000: [@balancer-labs/v2-pool-utils]:       at the beginning of the pause window
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ returns the current pause window duration
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ returns the full buffer period duration
➤ YN0000: [@balancer-labs/v2-pool-utils]:       after some time has passed
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ returns the current pause window duration
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ returns the full buffer period duration
➤ YN0000: [@balancer-labs/v2-pool-utils]:     at the pause window end time
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ returns a zero pause window duration
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ returns a zero buffer period duration
➤ YN0000: [@balancer-labs/v2-pool-utils]:     after the pause window end time
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ returns a zero pause window duration
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ returns a zero buffer period duration
➤ YN0000: [@balancer-labs/v2-pool-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-utils]:   PoolPriceOracle
➤ YN0000: [@balancer-labs/v2-pool-utils]:     process
➤ YN0000: [@balancer-labs/v2-pool-utils]:       when there was no sample in the given index
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ does not update the previous sample
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ creates another sample
➤ YN0000: [@balancer-labs/v2-pool-utils]:       when there was a sample in the given index
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the next sample does not complete the buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the current timestamp is the same as the initial timestamp of the current sample
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ updates the existing sample
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the current timestamp is greater than the initial timestamp by less than 2 minutes
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ updates the existing sample
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the current timestamp is greater than the initial timestamp by more than 2 minutes
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ does not update the previous sample
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ creates another sample
➤ YN0000: [@balancer-labs/v2-pool-utils]:         when the next sample completes the buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the current timestamp is greater than the initial timestamp by less than 2 minutes
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ updates the existing sample
➤ YN0000: [@balancer-labs/v2-pool-utils]:           when the current timestamp is greater than the initial timestamp by more than 2 minutes
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ does not update the previous sample
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ creates another sample
➤ YN0000: [@balancer-labs/v2-pool-utils]:     findNearestSample
➤ YN0000: [@balancer-labs/v2-pool-utils]:       without offset
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ can find every exact value (12721ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ can find intermediate values (10821ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:       with a small offset
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ can find every exact value (9611ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ can find intermediate values (10507ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:       with a large offset
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ can find every exact value (10799ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ can find intermediate values (12423ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:       with the highest offset
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ can find every exact value (10795ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:         ✓ can find intermediate values (9485ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:     getPastAccumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:       without offset
➤ YN0000: [@balancer-labs/v2-pool-utils]:         invariant
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:         BPT price
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:         pair price
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:       with a small offset
➤ YN0000: [@balancer-labs/v2-pool-utils]:         invariant
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:         BPT price
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:         pair price
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:       with a large offset
➤ YN0000: [@balancer-labs/v2-pool-utils]:         invariant
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:         BPT price
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:         pair price
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:       with the highest offset
➤ YN0000: [@balancer-labs/v2-pool-utils]:         invariant
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:         BPT price
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]:         pair price
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ YN0000: [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ YN0000: [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ YN0000: [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-utils]:   Samples
➤ YN0000: [@balancer-labs/v2-pool-utils]:     encoding
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ encodes samples correctly (400ms)
➤ YN0000: [@balancer-labs/v2-pool-utils]:     update
➤ YN0000: [@balancer-labs/v2-pool-utils]:       ✓ updates the sample correctly
➤ YN0000: [@balancer-labs/v2-pool-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-utils]:   192 passing (3m)
➤ YN0000: [@balancer-labs/v2-pool-utils]: 
➤ YN0000: [@balancer-labs/v2-pool-weighted]: Compiling 61 files with 0.7.1
➤ YN0000: [@balancer-labs/v2-pool-weighted]: Compilation finished successfully
➤ YN0000: [@balancer-labs/v2-pool-weighted]: 
➤ YN0000: [@balancer-labs/v2-pool-weighted]: 
➤ YN0000: [@balancer-labs/v2-pool-weighted]:   BaseWeightedPool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     for a 1 token pool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ reverts if there is a single token (4213ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     for a 2 token pool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       creation
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when the creation succeeds
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ uses the corresponding specialization
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ registers tokens in the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ starts with no BPT
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the asset managers
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets swap fee
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the name
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the symbol
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the decimals
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when the creation fails
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if the number of tokens and weights do not match (627ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if there are repeated tokens (1210ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if the swap fee is too high (567ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if at least one weight is too low (882ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       onJoinPool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if caller is not the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if no user data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if wrong user data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         initialization
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ grants the n * invariant amount of BPT (279ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if already initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused (263ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if not initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           once initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ grants BPT for exact tokens (407ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ can tell how much BPT it will give in return
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ fails if not enough BPT
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ reverts if paused (390ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         join token in for exact BPT out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if not initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           once initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ grants exact BPT for token in (251ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ can tell how many token amounts it will have to receive
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ fails if invariant increases more than max allowed
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       onExitPool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if caller is not the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if no user data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if wrong user data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ grants one token for exact bpt
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ can tell how many tokens it will give in return
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if invariant decreases more than max allowed
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ grants all tokens for exact bpt
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fully exit
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ can tell how many token amounts it will give in return
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ does not revert if paused (366ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         exit BPT in for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ grants exact tokens for bpt
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ can tell how much BPT it will have to receive
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if more BTP needed
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       onSwap
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         given in
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ calculates amount out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ calculates max amount out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in exceeds max in ratio
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in is not in the pool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token out is not in the pool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         given out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ calculates amount in
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ calculates max amount in
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in exceeds max out ratio
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in is not in the pool when given out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token out is not in the pool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused (297ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       protocol swap fees
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         without balance changes
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ joins and exits do not accumulate fees (1101ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with previous swap
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ does not charges fee on exit if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with swap and exceeded min invariant ratio
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     for a 3 token pool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       creation
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when the creation succeeds
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ uses the corresponding specialization
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ registers tokens in the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ starts with no BPT
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the asset managers
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets swap fee
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the name
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the symbol
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the decimals
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when the creation fails
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if the number of tokens and weights do not match (568ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if there are repeated tokens (852ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if the swap fee is too high (524ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if at least one weight is too low (539ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       onJoinPool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if caller is not the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if no user data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if wrong user data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         initialization
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ grants the n * invariant amount of BPT
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if already initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if not initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           once initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ grants BPT for exact tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ can tell how much BPT it will give in return
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ fails if not enough BPT
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         join token in for exact BPT out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if not initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           once initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ grants exact BPT for token in
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ can tell how many token amounts it will have to receive
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ fails if invariant increases more than max allowed
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ reverts if paused (264ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       onExitPool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if caller is not the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if no user data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if wrong user data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ grants one token for exact bpt
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ can tell how many tokens it will give in return
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if invariant decreases more than max allowed
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ grants all tokens for exact bpt
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fully exit
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ can tell how many token amounts it will give in return
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ does not revert if paused (269ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         exit BPT in for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ grants exact tokens for bpt
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ can tell how much BPT it will have to receive
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if more BTP needed
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       onSwap
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         given in
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ calculates amount out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ calculates max amount out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in exceeds max in ratio
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in is not in the pool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token out is not in the pool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         given out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ calculates amount in
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ calculates max amount in
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in exceeds max out ratio
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in is not in the pool when given out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token out is not in the pool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       protocol swap fees
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         without balance changes
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ joins and exits do not accumulate fees (674ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with previous swap
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ does not charges fee on exit if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with swap and exceeded min invariant ratio
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     for a too-many token pool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ reverts if there are too many tokens (1648ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]: 
➤ YN0000: [@balancer-labs/v2-pool-weighted]:   LiquidityBootstrappingPool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     with invalid creation parameters
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ fails with < 2 tokens (418ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ fails with > 4 tokens (474ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ fails with mismatched tokens/weights (431ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     when deployed from factory
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ has no asset managers
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     with valid creation parameters
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       when initialized with swaps disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ swaps show disabled on start
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ swaps are blocked
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       when initialized with swaps enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ swaps show enabled on start
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ swaps are not blocked
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ sets token weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ stores the initial weights as a zero duration weight change
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         permissioned actions
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the sender is the owner
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ swaps can be enabled and disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ disabling swaps emits an event
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ enabling swaps emits an event
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ owner can join and receive BPT, then exit (451ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             update weights gradually
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               with invalid parameters
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ fails if end weights are mismatched (too few)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ fails if the end weights are mismatched (too many)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ fails if start time > end time
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ fails with an end weight below the minimum
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ fails with invalid normalized end weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 with start time in the past
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                   ✓ fast-forwards start time to present
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               with valid parameters (ongoing weight update)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ updating weights emits an event
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ stores the params
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets start weights if called before the start time
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets end weights if called after the end time
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 5% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 10% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 15% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 20% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 25% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 30% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 35% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 40% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 45% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 50% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 55% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 60% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 65% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 70% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 75% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 80% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 85% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 90% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 95% through
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the sender is not the owner
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ non-owner cannot initialize the pool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ non-owners cannot join the pool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ non-owners cannot update weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]: 
➤ YN0000: [@balancer-labs/v2-pool-weighted]:   LiquidityBootstrappingPoolFactory
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     temporarily pausable
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ pools have the correct window end times (367ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ multiple pools have the same window end times (650ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ pools created after the pause window end date have no buffer period (340ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ does not have asset managers (436ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ creates it with swaps enabled (289ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ creates it with swaps disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]: 
➤ YN0000: [@balancer-labs/v2-pool-weighted]:   WeightedMath
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       zero invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       two tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ returns invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       three tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ returns invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     Simple swap
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ outGivenIn
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ inGivenOut
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     Extreme amounts
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ outGivenIn - min amount in
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ inGivenOut - min amount out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     Extreme weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ outGivenIn - max weights relation
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ outGivenIn - min weights relation
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     protocol swap fees
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       two tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ returns protocol swap fees
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with large accumulated fees
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ caps the invariant growth
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       three tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ returns protocol swap fees
➤ YN0000: [@balancer-labs/v2-pool-weighted]: 
➤ YN0000: [@balancer-labs/v2-pool-weighted]:   WeighteOracledMath
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     spot price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       with equal weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 18 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1910ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 19 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1748ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 20 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1705ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 21 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1847ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 22 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1633ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       with different weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 18 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1768ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 19 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1614ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 20 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1411ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 21 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1494ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 22 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1863ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       with extreme weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 18 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1344ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 19 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1316ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 20 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1419ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 21 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1443ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 22 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1445ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       with partial weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 18 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1235ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 19 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1304ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 20 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1300ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 21 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1425ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with balances powers of 22 and 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1145ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     BPT price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       with low BPT supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with low weight
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (271ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with medium weight
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with large weight
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (302ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       with medium BPT supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with low weight
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (251ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with medium weight
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with large weight
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (289ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       with large BPT supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with low weight
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (288ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with medium weight
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (627ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (437ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with large weight
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (293ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]: 
➤ YN0000: [@balancer-labs/v2-pool-weighted]:   WeightedPool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     with 2 tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     with 3 tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     with 4 tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     with 5 tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     with 6 tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     with 7 tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     with 8 tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]: 
➤ YN0000: [@balancer-labs/v2-pool-weighted]:   WeightedPool2Tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     as a 2 token weighted pool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       creation
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when the creation succeeds
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ uses the corresponding specialization
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ registers tokens in the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ starts with no BPT
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the asset managers
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets swap fee
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the name
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the symbol
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ sets the decimals
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when the creation fails
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if there are repeated tokens (739ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if the swap fee is too high (355ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if at least one weight is too low (409ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       onJoinPool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if caller is not the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if no user data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if wrong user data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         initialization
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ grants the n * invariant amount of BPT
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if already initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if not initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           once initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ grants BPT for exact tokens
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ can tell how much BPT it will give in return (270ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ fails if not enough BPT
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         join token in for exact BPT out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if not initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           once initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ grants exact BPT for token in
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ can tell how many token amounts it will have to receive
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ fails if invariant increases more than max allowed
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       onExitPool
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if caller is not the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if no user data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         ✓ fails if wrong user data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ grants one token for exact bpt
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ can tell how many tokens it will give in return
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if invariant decreases more than max allowed
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ grants all tokens for exact bpt
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fully exit
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ can tell how many token amounts it will give in return
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ does not revert if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         exit BPT in for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ grants exact tokens for bpt
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ can tell how much BPT it will have to receive
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ fails if more BTP needed
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       onSwap
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         given in
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ calculates amount out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ calculates max amount out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in exceeds max in ratio
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         given out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ calculates amount in
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ calculates max amount in
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in exceeds max out ratio
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       protocol swap fees
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         without balance changes
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ joins and exits do not accumulate fees (751ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with previous swap
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ does not charges fee on exit if paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         with swap and exceeded min invariant ratio
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     oracle
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       initialize
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when the oracle is enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ caches the log of the last invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ caches the total supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when the oracle is disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       join
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when the latest change block is an old block
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the oracle is enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ caches the log of the last invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ caches the total supply (283ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             without updated oracle
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ updates the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             with updated oracle
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ stores the pre-action spot price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ stores the pre-action BPT price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ stores the pre-action invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the oracle is disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when the latest change block is the current block
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the oracle is enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ caches the log of the last invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ caches the total supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the oracle is disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       exit
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when the pool is paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the latest change block is an old block
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply (292ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the latest change block is the current block
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when the pool is not paused
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the latest change block is an old block
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ caches the log of the last invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ caches the total supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               without updated oracle
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ updates the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               with updated oracle
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action spot price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action BPT price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the latest change block is the current block
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ caches the log of the last invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ caches the total supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       swaps
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         given in
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the latest change block is an old block
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               without updated oracle
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ updates the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               with updated oracle
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action spot price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action BPT price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the latest change block is the current block
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         given out
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the latest change block is an old block
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               without updated oracle
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ updates the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               with updated oracle
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action spot price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action BPT price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the latest change block is the current block
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       setting
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when it starts enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ is enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ does not fail when trying to enable again
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         when it starts disabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the pool was not initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ does not cache the log invariant and supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           when the pool was initialized
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ is disabled and can be enabled
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ can only be updated by the admin
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ caches the log of the last invariant
➤ YN0000: [@balancer-labs/v2-pool-weighted]:             ✓ caches the total supply
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     queries
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       with positive values
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         getLatest
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ returns the latest pair price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ returns the latest BPT price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ returns the latest pair price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         getPastAccumulators
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ returns the expected values
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         getTimeWeightedAverage
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ returns the expected values
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       with negative values
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         getLatest
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ returns the latest pair price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ returns the latest BPT price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ returns the latest pair price
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         getPastAccumulators
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ returns the expected values
➤ YN0000: [@balancer-labs/v2-pool-weighted]:         getTimeWeightedAverage
➤ YN0000: [@balancer-labs/v2-pool-weighted]:           ✓ returns the expected values
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     misc data
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ packs samples correctly (595ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]: 
➤ YN0000: [@balancer-labs/v2-pool-weighted]:   WeightedPoolFactory
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     constructor arguments
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ registers tokens in the vault
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ starts with no BPT
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets the asset managers
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets swap fee
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets the owner 
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets the name
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets the symbol
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ sets the decimals
➤ YN0000: [@balancer-labs/v2-pool-weighted]:     temporarily pausable
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ pools have the correct window end times (273ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ multiple pools have the same window end times (442ms)
➤ YN0000: [@balancer-labs/v2-pool-weighted]:       ✓ pools created after the pause window end date have no buffer period
➤ YN0000: [@balancer-labs/v2-pool-weighted]: 
➤ YN0000: [@balancer-labs/v2-pool-weighted]: 
➤ YN0000: [@balancer-labs/v2-pool-weighted]:   424 passing (2m)
➤ YN0000: [@balancer-labs/v2-pool-weighted]: 
➤ YN0000: [@balancer-labs/v2-vault]: Nothing to compile
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   Asset Management
➤ YN0000: [@balancer-labs/v2-vault]:     with general pool
➤ YN0000: [@balancer-labs/v2-vault]:       with unregistered pool
➤ YN0000: [@balancer-labs/v2-vault]:         withdraw
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         deposit
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         update
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       with registered pool
➤ YN0000: [@balancer-labs/v2-vault]:         with unregistered token
➤ YN0000: [@balancer-labs/v2-vault]:           withdraw
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           deposit
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           update
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         with registered token
➤ YN0000: [@balancer-labs/v2-vault]:           setting
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ different managers can be set for different tokens
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ removes asset managers when deregistering (799ms)
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts when querying the asset manager of an unknown pool
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts when querying the asset manager of an unregistered token
➤ YN0000: [@balancer-labs/v2-vault]:           withdraw
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                 when withdrawing zero
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when withdrawing less than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager (254ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when withdrawing all the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when withdrawing more than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               when paused
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           deposit
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               with managed amount
➤ YN0000: [@balancer-labs/v2-vault]:                 when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                   when depositing zero
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   when depositing less than the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   when depositing all the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   when depositing more than the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                 when paused
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           update
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               with managed amount
➤ YN0000: [@balancer-labs/v2-vault]:                 when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                   with gains
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block of the updated token only
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   with losses
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block of the updated token only
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   with no change
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block of the updated token only
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when paused
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           batch
➤ YN0000: [@balancer-labs/v2-vault]:             with single pool
➤ YN0000: [@balancer-labs/v2-vault]:               with the same managed token
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ succeeds (257ms)
➤ YN0000: [@balancer-labs/v2-vault]:               with managed and unmanaged tokens
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               with managed and unregistered tokens
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             with multiple pools
➤ YN0000: [@balancer-labs/v2-vault]:               with the same managed token
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ succeeds (388ms)
➤ YN0000: [@balancer-labs/v2-vault]:               with multiple managed tokens
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ succeeds (376ms)
➤ YN0000: [@balancer-labs/v2-vault]:               with managed and unmanaged tokens
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               with registered and unregistered pools
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     with minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:       with unregistered pool
➤ YN0000: [@balancer-labs/v2-vault]:         withdraw
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         deposit
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         update
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       with registered pool
➤ YN0000: [@balancer-labs/v2-vault]:         with unregistered token
➤ YN0000: [@balancer-labs/v2-vault]:           withdraw
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           deposit
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           update
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         with registered token
➤ YN0000: [@balancer-labs/v2-vault]:           setting
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ different managers can be set for different tokens
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ removes asset managers when deregistering (612ms)
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts when querying the asset manager of an unknown pool
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts when querying the asset manager of an unregistered token
➤ YN0000: [@balancer-labs/v2-vault]:           withdraw
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                 when withdrawing zero
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when withdrawing less than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when withdrawing all the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not update the last change block (293ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when withdrawing more than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               when paused
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           deposit
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               with managed amount
➤ YN0000: [@balancer-labs/v2-vault]:                 when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                   when depositing zero
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   when depositing less than the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   when depositing all the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   when depositing more than the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                 when paused
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           update
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               with managed amount
➤ YN0000: [@balancer-labs/v2-vault]:                 when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                   with gains
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block of the updated token only (285ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   with losses
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block of the updated token only
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   with no change
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens (282ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block of the updated token only
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when paused
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           batch
➤ YN0000: [@balancer-labs/v2-vault]:             with single pool
➤ YN0000: [@balancer-labs/v2-vault]:               with the same managed token
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ succeeds (293ms)
➤ YN0000: [@balancer-labs/v2-vault]:               with managed and unmanaged tokens
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               with managed and unregistered tokens
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             with multiple pools
➤ YN0000: [@balancer-labs/v2-vault]:               with the same managed token
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ succeeds (764ms)
➤ YN0000: [@balancer-labs/v2-vault]:               with multiple managed tokens
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ succeeds (527ms)
➤ YN0000: [@balancer-labs/v2-vault]:               with managed and unmanaged tokens
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               with registered and unregistered pools
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     with two token pool
➤ YN0000: [@balancer-labs/v2-vault]:       with unregistered pool
➤ YN0000: [@balancer-labs/v2-vault]:         withdraw
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         deposit
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         update
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       with registered pool
➤ YN0000: [@balancer-labs/v2-vault]:         with unregistered token
➤ YN0000: [@balancer-labs/v2-vault]:           withdraw
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           deposit
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           update
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         with registered token
➤ YN0000: [@balancer-labs/v2-vault]:           setting
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ different managers can be set for different tokens
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ removes asset managers when deregistering (373ms)
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts when querying the asset manager of an unknown pool
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts when querying the asset manager of an unregistered token
➤ YN0000: [@balancer-labs/v2-vault]:           withdraw
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                 when withdrawing zero
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when withdrawing less than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when withdrawing all the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when withdrawing more than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               when paused
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           deposit
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               with managed amount
➤ YN0000: [@balancer-labs/v2-vault]:                 when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                   when depositing zero
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   when depositing less than the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   when depositing all the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   when depositing more than the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                 when paused
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           update
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               with managed amount
➤ YN0000: [@balancer-labs/v2-vault]:                 when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                   with gains
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates both last change blocks when updating token A
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates both last change blocks when updating token B
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   with losses
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates both last change blocks when updating token A
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates both last change blocks when updating token B
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                   with no change
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates both last change blocks when updating token A
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates both last change blocks when updating token B
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when paused
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           batch
➤ YN0000: [@balancer-labs/v2-vault]:             with single pool
➤ YN0000: [@balancer-labs/v2-vault]:               with the same managed token
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ succeeds
➤ YN0000: [@balancer-labs/v2-vault]:               with managed and unmanaged tokens
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               with managed and unregistered tokens
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             with multiple pools
➤ YN0000: [@balancer-labs/v2-vault]:               with the same managed token
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ succeeds
➤ YN0000: [@balancer-labs/v2-vault]:               with multiple managed tokens
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ succeeds (325ms)
➤ YN0000: [@balancer-labs/v2-vault]:               with managed and unmanaged tokens
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               with registered and unregistered pools
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   AssetTransfersHandler
➤ YN0000: [@balancer-labs/v2-vault]:     receiveAsset
➤ YN0000: [@balancer-labs/v2-vault]:       when the asset is ETH
➤ YN0000: [@balancer-labs/v2-vault]:         with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:           when not receiving from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ takes ETH from the caller
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ does not keep any ETH
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ wraps received ETH into WETH
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ does not return extra ETH to the caller
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ does not check if any ETH was supplied (356ms)
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ does take WETH from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if not enough ETH was sent
➤ YN0000: [@balancer-labs/v2-vault]:           when receiving from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       when the asset is a token
➤ YN0000: [@balancer-labs/v2-vault]:         when the token is WETH
➤ YN0000: [@balancer-labs/v2-vault]:           when receiving from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ deducts the expected amount from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ transfers tokens not taken from internal balance from sender
➤ YN0000: [@balancer-labs/v2-vault]:             with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ deducts the expected amount from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ transfers tokens not taken from internal balance from sender
➤ YN0000: [@balancer-labs/v2-vault]:             with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ deducts the expected amount from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ transfers tokens not taken from internal balance from sender
➤ YN0000: [@balancer-labs/v2-vault]:           when not receiving from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ does not affect sender internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ transfers tokens from sender
➤ YN0000: [@balancer-labs/v2-vault]:             with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ does not affect sender internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ transfers tokens from sender
➤ YN0000: [@balancer-labs/v2-vault]:         when the token is not WETH
➤ YN0000: [@balancer-labs/v2-vault]:           when receiving from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ deducts the expected amount from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ transfers tokens not taken from internal balance from sender
➤ YN0000: [@balancer-labs/v2-vault]:             with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ deducts the expected amount from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ transfers tokens not taken from internal balance from sender
➤ YN0000: [@balancer-labs/v2-vault]:             with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ deducts the expected amount from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ transfers tokens not taken from internal balance from sender
➤ YN0000: [@balancer-labs/v2-vault]:           when not receiving from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ does not affect sender internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ transfers tokens from sender
➤ YN0000: [@balancer-labs/v2-vault]:             with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ does not affect sender internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ transfers tokens from sender
➤ YN0000: [@balancer-labs/v2-vault]:     sendAsset
➤ YN0000: [@balancer-labs/v2-vault]:       when the asset is ETH
➤ YN0000: [@balancer-labs/v2-vault]:         when not sending to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ sends ETH to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ does not affect the ETH balance
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ unwraps WETH into ETH
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ does not use internal balance
➤ YN0000: [@balancer-labs/v2-vault]:         when sending to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       when the asset is a token
➤ YN0000: [@balancer-labs/v2-vault]:         when the token is WETH
➤ YN0000: [@balancer-labs/v2-vault]:           when not sending to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ sends tokens to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ does not affect internal balance
➤ YN0000: [@balancer-labs/v2-vault]:           when sending to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ assigns tokens as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ transfers no tokens
➤ YN0000: [@balancer-labs/v2-vault]:         when the token is not WETH
➤ YN0000: [@balancer-labs/v2-vault]:           when not sending to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ sends tokens to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ does not affect internal balance
➤ YN0000: [@balancer-labs/v2-vault]:           when sending to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ assigns tokens as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ transfers no tokens
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   Authorizer
➤ YN0000: [@balancer-labs/v2-vault]:     grantRoles
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is the admin
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ grants a list of roles
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is not the admin
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     grantRolesToMany
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is the admin
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ grants a list of roles
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is not the admin
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     revokeRoles
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is the admin
➤ YN0000: [@balancer-labs/v2-vault]:         when the roles where granted
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ revokes a list of roles
➤ YN0000: [@balancer-labs/v2-vault]:         when one of the roles was not granted
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ ignores the request
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is not the admin
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     revokeRolesFromMany
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is the admin
➤ YN0000: [@balancer-labs/v2-vault]:         when the roles where granted
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ revokes a list of roles
➤ YN0000: [@balancer-labs/v2-vault]:         when one of the roles was not granted
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ ignores the request
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is not the admin
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   Exit Pool
➤ YN0000: [@balancer-labs/v2-vault]:     with general pool
➤ YN0000: [@balancer-labs/v2-vault]:       with no registered tokens
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       with registered tokens
➤ YN0000: [@balancer-labs/v2-vault]:         when called incorrectly
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the pool ID does not exist
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if a token is missing in the array
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if there is one extra token
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the tokens list is not sorted
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if token array is empty
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if tokens and amounts length do not match
➤ YN0000: [@balancer-labs/v2-vault]:         when called correctly
➤ YN0000: [@balancer-labs/v2-vault]:           with incorrect pool return values
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if exit amounts length does not match token length
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if due protocol fees length does not match token length
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if exit amounts and due protocol fees length do not match token length
➤ YN0000: [@balancer-labs/v2-vault]:           with correct pool return values
➤ YN0000: [@balancer-labs/v2-vault]:             with no due protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:               when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                 not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   without internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool (255ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data (269ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens (333ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (382ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (452ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     when paused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (337ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient (272ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data (320ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (378ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (527ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (282ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (417ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (369ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     when paused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (311ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (332ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (296ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (312ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (334ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     when paused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (379ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (343ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (264ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (549ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (426ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     when paused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (488ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (304ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:               when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                 when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                     not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       without internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool (278ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (366ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (495ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         when paused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient (252ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (268ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (464ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (397ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (398ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         when paused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient (279ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (637ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (409ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (371ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (325ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         when paused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient (256ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (514ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (393ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees (263ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when paused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault (281ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (355ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (309ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is not eternally-allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is allowed by signature
➤ YN0000: [@balancer-labs/v2-vault]:                       not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         without internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (256ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (325ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (525ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           when paused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data (297ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (455ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (321ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (325ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient (273ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault (260ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (337ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (468ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           when paused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (310ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (930ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool (279ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (356ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (369ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           when paused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (262ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (352ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (585ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (320ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (391ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (324ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           when paused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (457ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (507ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             with due protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:               not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 without internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (298ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully (320ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (444ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (294ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   when paused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (338ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data (343ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (484ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (410ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (263ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (314ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (443ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (477ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   when paused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (275ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (399ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (327ms)
➤ YN0000: [@balancer-labs/v2-vault]:               using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (274ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool (331ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (430ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (399ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   when paused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (292ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data (278ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (350ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (336ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (341ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (513ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (323ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   when paused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (294ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully (374ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (470ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (518ms)
➤ YN0000: [@balancer-labs/v2-vault]:     with minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:       with no registered tokens
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       with registered tokens
➤ YN0000: [@balancer-labs/v2-vault]:         when called incorrectly
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the pool ID does not exist
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if a token is missing in the array
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if there is one extra token
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the tokens list is not sorted
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if token array is empty
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if tokens and amounts length do not match
➤ YN0000: [@balancer-labs/v2-vault]:         when called correctly
➤ YN0000: [@balancer-labs/v2-vault]:           with incorrect pool return values
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if exit amounts length does not match token length
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if due protocol fees length does not match token length
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if exit amounts and due protocol fees length do not match token length
➤ YN0000: [@balancer-labs/v2-vault]:           with correct pool return values
➤ YN0000: [@balancer-labs/v2-vault]:             with no due protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:               when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                 not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   without internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient (275ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when paused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens (267ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (329ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data (320ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when paused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (307ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (253ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (268ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (262ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     when paused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (312ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (252ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (280ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees (264ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (335ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     when paused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees (295ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (267ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:               when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                 when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                     not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       without internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data (270ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (314ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (593ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         when paused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient (315ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool (285ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees (256ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (254ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                       with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully (277ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (372ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         when paused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool (277ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (358ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees (290ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (254ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (353ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         when paused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (491ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                       with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool (299ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (463ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (292ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         when paused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient (418ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully (333ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (278ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (457ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is not eternally-allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is allowed by signature
➤ YN0000: [@balancer-labs/v2-vault]:                       not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         without internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (293ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data (274ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully (340ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (252ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (327ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           when paused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (316ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (326ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (738ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (609ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (359ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool (383ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (427ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (269ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (295ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           when paused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (427ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (281ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when paused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient (351ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (317ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (278ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (308ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           when paused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (251ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (263ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             with due protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:               not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 without internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient (293ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (435ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   when paused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (409ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (268ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (293ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (298ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   when paused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully (269ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (319ms)
➤ YN0000: [@balancer-labs/v2-vault]:               using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (435ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (299ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when paused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (404ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees (402ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (391ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (327ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees (285ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when paused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient (318ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (359ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (317ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (252ms)
➤ YN0000: [@balancer-labs/v2-vault]:     with two token pool
➤ YN0000: [@balancer-labs/v2-vault]:       with no registered tokens
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       with registered tokens
➤ YN0000: [@balancer-labs/v2-vault]:         when called incorrectly
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the pool ID does not exist
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if a token is missing in the array
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if there is one extra token
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the tokens list is not sorted
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if token array is empty
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if tokens and amounts length do not match
➤ YN0000: [@balancer-labs/v2-vault]:         when called correctly
➤ YN0000: [@balancer-labs/v2-vault]:           with incorrect pool return values
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if exit amounts length does not match token length
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if due protocol fees length does not match token length
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if exit amounts and due protocol fees length do not match token length
➤ YN0000: [@balancer-labs/v2-vault]:           with correct pool return values
➤ YN0000: [@balancer-labs/v2-vault]:             with no due protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:               when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                 not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   without internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (288ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (373ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when paused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when paused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                 using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient (259ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when paused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens (277ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when paused
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (348ms)
➤ YN0000: [@balancer-labs/v2-vault]:               when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                 when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                     not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       without internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient (340ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully (281ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when paused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient (306ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool (268ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (299ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when paused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                     using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when paused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient (279ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                       with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data (268ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees (271ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                         when paused
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (268ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is not eternally-allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is allowed by signature
➤ YN0000: [@balancer-labs/v2-vault]:                       not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         without internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data (258ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully (252ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when paused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (297ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data (319ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully (286ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when paused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (426ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (282ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when paused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data (279ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                           when paused
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient (255ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees (271ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                 when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             with due protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:               not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 without internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees (255ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when paused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data (252ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when paused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:               using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (295ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when paused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient (337ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when paused
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (253ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ exits the pool fully (288ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (301ms)
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   Fees
➤ YN0000: [@balancer-labs/v2-vault]:     set fees
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is allowed
➤ YN0000: [@balancer-labs/v2-vault]:         when the given input is valid
➤ YN0000: [@balancer-labs/v2-vault]:           swap fee
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ sets the percentage properly
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:           flash loan fee
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ sets the percentage properly
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:         when the given input is invalid
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the swap fee percentage is above the maximum
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the flash loan fee percentage is above the maximum
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is not allowed
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     collected fees
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ fees are initially zero
➤ YN0000: [@balancer-labs/v2-vault]:       with collected protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reports collected fee
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ authorized accounts can withdraw protocol fees to any recipient
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ protocol fees cannot be over-withdrawn
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ unauthorized accounts cannot withdraw collected fees
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   Flash Loans
➤ YN0000: [@balancer-labs/v2-vault]:     with no protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ causes no net balance change on the Vault
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ all balance can be loaned
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ reverts if the loan is larger than available balance
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ reverts if the borrower does not repay the loan (251ms)
➤ YN0000: [@balancer-labs/v2-vault]:     with protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ zero loans are possible
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ zero loans are possible
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ the fees module receives protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ protocol fees are rounded up
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ excess fees can be paid
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ all balance can be loaned
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ reverts if the borrower does not repay the loan
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ reverts if the borrower reenters the Vault
➤ YN0000: [@balancer-labs/v2-vault]:       multi asset loan
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ the Vault receives protocol fees proportional to each loan (297ms)
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ all balance can be loaned
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts if tokens are not unique
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts if tokens are not sorted
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts if a token is invalid
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   Internal Balance
➤ YN0000: [@balancer-labs/v2-vault]:     deposit internal balance
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:         when the asset is a token
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender does hold enough balance
➤ YN0000: [@balancer-labs/v2-vault]:             when the given amount is approved by the sender
➤ YN0000: [@balancer-labs/v2-vault]:               when tokens and balances match
➤ YN0000: [@balancer-labs/v2-vault]:                 when depositing zero balance
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ transfers the tokens from the sender to the vault
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ deposits the internal balance into the recipient account
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ returns ETH if any is sent
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when depositing some balance
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ transfers the tokens from the sender to the vault
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ deposits the internal balance into the recipient account
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ returns ETH if any is sent
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:             when the given amount is not approved by the sender
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender does not hold enough balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         when the asset is ETH
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ does not take WETH from the sender
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ increases the WETH internal balance for the recipient
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ emits an event with WETH as the token address
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ accepts deposits of both ETH and WETH (262ms)
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ accepts multiple ETH deposits
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if not enough ETH was supplied
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:         when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is allowed to deposit by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to the vault
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ deposits the internal balance into the recipient account
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ returns ETH if any is sent
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:             when the asset is ETH
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ returns excess ETH to the relayer
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     withdraw internal balance
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is a user
➤ YN0000: [@balancer-labs/v2-vault]:         when the asset is a token
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender has enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             when requesting all the available balance
➤ YN0000: [@balancer-labs/v2-vault]:               when tokens and balances match
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ transfers the tokens from the vault to recipient
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ withdraws the internal balance from the sender account
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:             when requesting part of the balance
➤ YN0000: [@balancer-labs/v2-vault]:               when tokens and balances match
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ transfers the tokens from the vault to recipient
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ withdraws the internal balance from the sender account
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:             when requesting no balance
➤ YN0000: [@balancer-labs/v2-vault]:               when tokens and balances match
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ transfers the tokens from the vault to recipient
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ withdraws the internal balance from the sender account
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:             with requesting more balance than available
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender does not have any internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         when the asset is ETH
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender has enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ does not send WETH to the recipient
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ decreases the WETH internal balance for the sender
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ emits an event with WETH as the token address
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ accepts withdrawals of both ETH and WETH
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:         when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             when tokens and balances match
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ transfers the tokens from the vault to recipient
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ withdraws the internal balance from the sender account
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     transfer internal balance
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is a user
➤ YN0000: [@balancer-labs/v2-vault]:         when the sender specifies some balance
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender holds enough balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to a single recipient
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to multiple recipients
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ does not affect the token balances of the sender nor the recipient
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ emits an event for each transfer
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender does not hold said balance
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender does not hold enough balance of one token
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender does not hold enough balance of the other token
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender does not hold enough balance of both tokens
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         when the sender does not specify any balance
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender holds some balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to a single recipient
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to multiple recipients
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ does not affect the token balances of the sender nor the recipient
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ emits an event for each transfer
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender does not have any balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to a single recipient
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to multiple recipients
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ does not affect the token balances of the sender nor the recipient
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ emits an event for each transfer
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:         when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to a single recipient
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to multiple recipients
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ does not affect the token balances of the sender nor the recipient
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ emits an event for each transfer
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     transfer external balance
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:         when the token is not the zero address
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender does hold enough balance
➤ YN0000: [@balancer-labs/v2-vault]:             when the given amount is approved by the sender
➤ YN0000: [@balancer-labs/v2-vault]:               when tokens and balances match
➤ YN0000: [@balancer-labs/v2-vault]:                 when depositing zero balance
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ transfers the tokens from the sender to the recipient, using the vault allowance of the sender
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not change the internal balances of the accounts
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not emit an event
➤ YN0000: [@balancer-labs/v2-vault]:                 when depositing some balance
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ transfers the tokens from the sender to the recipient, using the vault allowance of the sender
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ does not change the internal balances of the accounts
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:             when the given amount is not approved by the sender
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender does not hold enough balance
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:         when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is allowed to transfer by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to the recipient, using the vault allowance of the sender
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ does not change the internal balances of the accounts
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     batch
➤ YN0000: [@balancer-labs/v2-vault]:       when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:         when all the senders allowed the relayer
➤ YN0000: [@balancer-labs/v2-vault]:           when all ops add up
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ succeeds
➤ YN0000: [@balancer-labs/v2-vault]:           when all ops do not add up
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         when one of the senders did not allow the relayer
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       when paused
➤ YN0000: [@balancer-labs/v2-vault]:         when only withdrawing internal balance
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ succeeds
➤ YN0000: [@balancer-labs/v2-vault]:         when trying to perform multiple ops
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   Join Pool
➤ YN0000: [@balancer-labs/v2-vault]:     with general pool
➤ YN0000: [@balancer-labs/v2-vault]:       with no registered tokens
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       with registered tokens
➤ YN0000: [@balancer-labs/v2-vault]:         when called incorrectly
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the pool ID does not exist
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if a token is missing in the array
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if there is one extra token
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the tokens list is not sorted
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if token array is empty
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if tokens and amounts length do not match
➤ YN0000: [@balancer-labs/v2-vault]:         when called correctly
➤ YN0000: [@balancer-labs/v2-vault]:           with incorrect pool return values
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if join amounts length does not match token length
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if due protocol fees length does not match token length
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if join amounts and due protocol fees length do not match token length
➤ YN0000: [@balancer-labs/v2-vault]:           with correct pool return values
➤ YN0000: [@balancer-labs/v2-vault]:             when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:               with no due protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                 when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                   not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (337ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault (275ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (276ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance (396ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees (269ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance (421ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (312ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (339ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance (375ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool (325ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (362ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                     with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (256ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool (349ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees (282ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (320ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                 when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (343ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault (320ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough (342ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance (271ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough (390ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance (367ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (263ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees (366ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough (370ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance (350ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens (289ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough (258ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance (342ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (340ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data (253ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance (255ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       when the relayer is not eternally-allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                       when the relayer is allowed by signature
➤ YN0000: [@balancer-labs/v2-vault]:                         not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (284ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees (257ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (313ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (337ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees (314ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (548ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (267ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool (385ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (277ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (666ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (255ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP (284ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (340ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (344ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (366ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (347ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP (258ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (337ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (385ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (455ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               with due protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                 not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data (389ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (261ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault (315ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (545ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault (453ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data (312ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (298ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance (296ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault (549ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP (291ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (315ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault (305ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (454ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance (375ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault (315ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool (282ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (251ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance (340ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool (251ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (428ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance (269ms)
➤ YN0000: [@balancer-labs/v2-vault]:             when paused
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     with minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:       with no registered tokens
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       with registered tokens
➤ YN0000: [@balancer-labs/v2-vault]:         when called incorrectly
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the pool ID does not exist
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if a token is missing in the array
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if there is one extra token
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the tokens list is not sorted
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if token array is empty
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if tokens and amounts length do not match
➤ YN0000: [@balancer-labs/v2-vault]:         when called correctly
➤ YN0000: [@balancer-labs/v2-vault]:           with incorrect pool return values
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if join amounts length does not match token length
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if due protocol fees length does not match token length
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if join amounts and due protocol fees length do not match token length
➤ YN0000: [@balancer-labs/v2-vault]:           with correct pool return values
➤ YN0000: [@balancer-labs/v2-vault]:             when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:               with no due protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                 when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                   not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (311ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens (286ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance (315ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (261ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (391ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                   using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (299ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                     with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (268ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool (294ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                     with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                 when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance (405ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (322ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool (274ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough (373ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                       using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens (311ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data (280ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault (283ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       when the relayer is not eternally-allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                       when the relayer is allowed by signature
➤ YN0000: [@balancer-labs/v2-vault]:                         not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (262ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP (267ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees (309ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (258ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (291ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool (389ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (263ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (271ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (360ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (409ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (280ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (371ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (334ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool (267ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (263ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (328ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data (263ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (377ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (380ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               with due protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                 not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault (258ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool (334ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data (451ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (367ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance (295ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool (298ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault (251ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (292ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                 using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault (328ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (252ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance (335ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (254ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (281ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (324ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:             when paused
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     with two token pool
➤ YN0000: [@balancer-labs/v2-vault]:       with no registered tokens
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       with registered tokens
➤ YN0000: [@balancer-labs/v2-vault]:         when called incorrectly
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the pool ID does not exist
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if a token is missing in the array
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if there is one extra token
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if the tokens list is not sorted
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if token array is empty
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if tokens and amounts length do not match
➤ YN0000: [@balancer-labs/v2-vault]:         when called correctly
➤ YN0000: [@balancer-labs/v2-vault]:           with incorrect pool return values
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if join amounts length does not match token length
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if due protocol fees length does not match token length
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts if join amounts and due protocol fees length do not match token length (259ms)
➤ YN0000: [@balancer-labs/v2-vault]:           with correct pool return values
➤ YN0000: [@balancer-labs/v2-vault]:             when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:               with no due protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                 when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                   not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data (253ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                     with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data (265ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (256ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                   using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance (283ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                     with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (289ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                 when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (308ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                       using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (467ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (291ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                         with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (267ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens (274ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       when the relayer is not eternally-allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                       when the relayer is allowed by signature
➤ YN0000: [@balancer-labs/v2-vault]:                         not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (305ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (262ms)
➤ YN0000: [@balancer-labs/v2-vault]:                           with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP (445ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool (344ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (295ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (345ms)
➤ YN0000: [@balancer-labs/v2-vault]:                         using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                           with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (363ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP (328ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees (264ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                           with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (291ms)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                           with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                   when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                     when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               with due protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                 not using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                 using internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with no internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault (333ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with some internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:                   with enough internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ YN0000: [@balancer-labs/v2-vault]:             when paused
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   PoolRegistry
➤ YN0000: [@balancer-labs/v2-vault]:     pool creation
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ any account can create pools
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ pools require a valid pool specialization setting
➤ YN0000: [@balancer-labs/v2-vault]:     pool properties
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ has an address and an specialization setting
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ starts with no tokens
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ gets a new id
➤ YN0000: [@balancer-labs/v2-vault]:     token management
➤ YN0000: [@balancer-labs/v2-vault]:       with general pool
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts when querying token balances of unexisting pools
➤ YN0000: [@balancer-labs/v2-vault]:       with minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts when querying token balances of unexisting pools
➤ YN0000: [@balancer-labs/v2-vault]:       with two token pool
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts when querying token balances of unexisting pools
➤ YN0000: [@balancer-labs/v2-vault]:     token registration
➤ YN0000: [@balancer-labs/v2-vault]:       register
➤ YN0000: [@balancer-labs/v2-vault]:         for a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:           when the pool was created
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the pool
➤ YN0000: [@balancer-labs/v2-vault]:               when the given addresses where not registered yet
➤ YN0000: [@balancer-labs/v2-vault]:                 when one of the given tokens is the zero address
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                 when the number of tokens and asset managers does not match
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                 when none of the tokens is the zero address
➤ YN0000: [@balancer-labs/v2-vault]:                   with one token
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ can be registered individually
➤ YN0000: [@balancer-labs/v2-vault]:                   with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ can be registered individually
➤ YN0000: [@balancer-labs/v2-vault]:                   with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ can be registered individually
➤ YN0000: [@balancer-labs/v2-vault]:               when one of the given tokens was already registered
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the pool
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the pool was not created
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         for a general pool
➤ YN0000: [@balancer-labs/v2-vault]:           when the pool was created
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the pool
➤ YN0000: [@balancer-labs/v2-vault]:               when the given addresses where not registered yet
➤ YN0000: [@balancer-labs/v2-vault]:                 when one of the given tokens is the zero address
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                 when the number of tokens and asset managers does not match
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                 when none of the tokens is the zero address
➤ YN0000: [@balancer-labs/v2-vault]:                   with one token
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ can be registered individually
➤ YN0000: [@balancer-labs/v2-vault]:                   with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ can be registered individually
➤ YN0000: [@balancer-labs/v2-vault]:                   with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ can be registered individually
➤ YN0000: [@balancer-labs/v2-vault]:               when one of the given tokens was already registered
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the pool
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the pool was not created
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         for a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:           when the pool was created
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the pool
➤ YN0000: [@balancer-labs/v2-vault]:               when the given addresses where not registered yet
➤ YN0000: [@balancer-labs/v2-vault]:                 when one of the given tokens is the zero address
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                 when the number of tokens and asset managers does not match
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                 when none of the tokens is the zero address
➤ YN0000: [@balancer-labs/v2-vault]:                   with one token
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                   with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ cannot be registered individually
➤ YN0000: [@balancer-labs/v2-vault]:                   with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               when one of the given tokens was already registered
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the pool
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the pool was not created
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       deregister
➤ YN0000: [@balancer-labs/v2-vault]:         for a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:           when the pool was created
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the pool
➤ YN0000: [@balancer-labs/v2-vault]:               when the given addresses where registered
➤ YN0000: [@balancer-labs/v2-vault]:                 with one token
➤ YN0000: [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ can deregister the tokens without balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ can deregister the tokens without balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ can deregister the tokens without balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:               when one of the given addresses was not registered
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the pool
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the pool was not created
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         for a general pool
➤ YN0000: [@balancer-labs/v2-vault]:           when the pool was created
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the pool
➤ YN0000: [@balancer-labs/v2-vault]:               when the given addresses where registered
➤ YN0000: [@balancer-labs/v2-vault]:                 with one token
➤ YN0000: [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ can deregister the tokens without balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ can deregister the tokens without balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ can deregister the tokens without balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:               when one of the given addresses was not registered
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the pool
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the pool was not created
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         for a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:           when the pool was created
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is the pool
➤ YN0000: [@balancer-labs/v2-vault]:               when the given addresses where registered
➤ YN0000: [@balancer-labs/v2-vault]:                 with one token
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:               when one of the given addresses was not registered
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is not the pool
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the pool was not created
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   Swap Queries
➤ YN0000: [@balancer-labs/v2-vault]:     given in
➤ YN0000: [@balancer-labs/v2-vault]:       single swap
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ returns the expected amounts
➤ YN0000: [@balancer-labs/v2-vault]:       multiple pools
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ returns the expected amounts
➤ YN0000: [@balancer-labs/v2-vault]:       multihop
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ returns the expected amounts
➤ YN0000: [@balancer-labs/v2-vault]:       error
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ bubbles up revert reasons
➤ YN0000: [@balancer-labs/v2-vault]:     given out
➤ YN0000: [@balancer-labs/v2-vault]:       single swap
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ returns the expected amounts
➤ YN0000: [@balancer-labs/v2-vault]:       multiple pools
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ returns the expected amounts
➤ YN0000: [@balancer-labs/v2-vault]:       multihop
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ returns the expected amounts
➤ YN0000: [@balancer-labs/v2-vault]:       error
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ bubbles up revert reasons
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   Swap Validation
➤ YN0000: [@balancer-labs/v2-vault]:     in swaps given in
➤ YN0000: [@balancer-labs/v2-vault]:       with expired deadline
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       with unexpired deadline
➤ YN0000: [@balancer-labs/v2-vault]:         when paused
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if there are less limits than tokens
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if there are more limits than tokens
➤ YN0000: [@balancer-labs/v2-vault]:           with correct limit length
➤ YN0000: [@balancer-labs/v2-vault]:             without withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               without depositing to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with limits too low
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts (787ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with exact limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (374ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with sufficient limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (848ms)
➤ YN0000: [@balancer-labs/v2-vault]:               depositing to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with limits too low
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts (1280ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with exact limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (348ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with sufficient limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (1169ms)
➤ YN0000: [@balancer-labs/v2-vault]:             withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               without depositing to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with limits too low
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts (495ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with exact limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (484ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with sufficient limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (971ms)
➤ YN0000: [@balancer-labs/v2-vault]:               depositing to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with limits too low
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts (1087ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with exact limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (289ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with sufficient limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (1133ms)
➤ YN0000: [@balancer-labs/v2-vault]:     in swaps given out
➤ YN0000: [@balancer-labs/v2-vault]:       with expired deadline
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:       with unexpired deadline
➤ YN0000: [@balancer-labs/v2-vault]:         when paused
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         when unpaused
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if there are less limits than tokens
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if there are more limits than tokens
➤ YN0000: [@balancer-labs/v2-vault]:           with correct limit length
➤ YN0000: [@balancer-labs/v2-vault]:             without withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               without depositing to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with limits too low
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts (1011ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with exact limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap
➤ YN0000: [@balancer-labs/v2-vault]:                 with sufficient limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (1171ms)
➤ YN0000: [@balancer-labs/v2-vault]:               depositing to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with limits too low
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts (859ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with exact limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (357ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with sufficient limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (1017ms)
➤ YN0000: [@balancer-labs/v2-vault]:             withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:               without depositing to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with limits too low
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts (1137ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with exact limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap
➤ YN0000: [@balancer-labs/v2-vault]:                 with sufficient limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (1079ms)
➤ YN0000: [@balancer-labs/v2-vault]:               depositing to internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                 with limits too low
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts (721ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with exact limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (283ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with sufficient limits
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ accepts the swap (1274ms)
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   Swaps
➤ YN0000: [@balancer-labs/v2-vault]:     with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:       with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:         swap given in
➤ YN0000: [@balancer-labs/v2-vault]:           for a single swap
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is registered
➤ YN0000: [@balancer-labs/v2-vault]:               when an amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       when requesting another token
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ YN0000: [@balancer-labs/v2-vault]:                           when using managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   when the relayer has a valid signature from the user
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                   when the relayer has an invalid signature from the user
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                   when there is no signature
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when draining the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:               when no amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is not registered
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:           for a multi swap
➤ YN0000: [@balancer-labs/v2-vault]:             without hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:             with hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out match
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:         swap given out
➤ YN0000: [@balancer-labs/v2-vault]:           for a single swap
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is registered
➤ YN0000: [@balancer-labs/v2-vault]:               when an amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting another token
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ YN0000: [@balancer-labs/v2-vault]:                           when using managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when draining the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:               when no amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is not registered
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:           for a multi swap
➤ YN0000: [@balancer-labs/v2-vault]:             without hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:             with hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out match
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:       with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:         swap given in
➤ YN0000: [@balancer-labs/v2-vault]:           for a single swap
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is registered
➤ YN0000: [@balancer-labs/v2-vault]:               when an amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       when requesting another token
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ YN0000: [@balancer-labs/v2-vault]:                           when using managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   when the relayer has a valid signature from the user
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                   when the relayer has an invalid signature from the user
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                   when there is no signature
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when draining the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:               when no amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is not registered
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:           for a multi swap
➤ YN0000: [@balancer-labs/v2-vault]:             without hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:             with hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out match
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:         swap given out
➤ YN0000: [@balancer-labs/v2-vault]:           for a single swap
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is registered
➤ YN0000: [@balancer-labs/v2-vault]:               when an amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting another token
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ YN0000: [@balancer-labs/v2-vault]:                           when using managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when draining the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:               when no amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is not registered
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:           for a multi swap
➤ YN0000: [@balancer-labs/v2-vault]:             without hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount  (270ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:             with hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out match
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:       with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:         swap given in
➤ YN0000: [@balancer-labs/v2-vault]:           for a single swap
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is registered
➤ YN0000: [@balancer-labs/v2-vault]:               when an amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       when requesting another token
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ YN0000: [@balancer-labs/v2-vault]:                           when using managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   when the relayer has a valid signature from the user
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                   when the relayer has an invalid signature from the user
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                   when there is no signature
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when draining the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:               when no amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is not registered
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:           for a multi swap
➤ YN0000: [@balancer-labs/v2-vault]:             without hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:             with hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out match
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount  (302ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:         swap given out
➤ YN0000: [@balancer-labs/v2-vault]:           for a single swap
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is registered
➤ YN0000: [@balancer-labs/v2-vault]:               when an amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting another token
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ YN0000: [@balancer-labs/v2-vault]:                           when using managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when draining the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:               when no amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is not registered
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:           for a multi swap
➤ YN0000: [@balancer-labs/v2-vault]:             without hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount  (285ms)
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:             with hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out match
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:     with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:       with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:         swap given in
➤ YN0000: [@balancer-labs/v2-vault]:           for a single swap
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is registered
➤ YN0000: [@balancer-labs/v2-vault]:               when an amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       when requesting another token
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ YN0000: [@balancer-labs/v2-vault]:                           when using managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   when the relayer has a valid signature from the user
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                   when the relayer has an invalid signature from the user
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                   when there is no signature
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when draining the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:               when no amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is not registered
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:           for a multi swap
➤ YN0000: [@balancer-labs/v2-vault]:             without hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount  (362ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount  (370ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount  (301ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:             with hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out match
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount  (267ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:         swap given out
➤ YN0000: [@balancer-labs/v2-vault]:           for a single swap
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is registered
➤ YN0000: [@balancer-labs/v2-vault]:               when an amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting another token
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ YN0000: [@balancer-labs/v2-vault]:                           when using managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when draining the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:               when no amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is not registered
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:           for a multi swap
➤ YN0000: [@balancer-labs/v2-vault]:             without hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:             with hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out match
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:       with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:         swap given in
➤ YN0000: [@balancer-labs/v2-vault]:           for a single swap
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is registered
➤ YN0000: [@balancer-labs/v2-vault]:               when an amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       when requesting another token
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ YN0000: [@balancer-labs/v2-vault]:                           when using managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   when the relayer has a valid signature from the user
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                   when the relayer has an invalid signature from the user
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                   when there is no signature
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when draining the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:               when no amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is not registered
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:           for a multi swap
➤ YN0000: [@balancer-labs/v2-vault]:             without hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:             with hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out match
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:         swap given out
➤ YN0000: [@balancer-labs/v2-vault]:           for a single swap
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is registered
➤ YN0000: [@balancer-labs/v2-vault]:               when an amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting another token
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ YN0000: [@balancer-labs/v2-vault]:                           when using managed balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when draining the pool
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:               when no amount is specified
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:             when the pool is not registered
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ YN0000: [@balancer-labs/v2-vault]:           for a multi swap
➤ YN0000: [@balancer-labs/v2-vault]:             without hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount  (252ms)
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ YN0000: [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount  (281ms)
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     for a single pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                     for a multi pair
➤ YN0000: [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:             with hops
➤ YN0000: [@balancer-labs/v2-vault]:               with the same pool
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out match
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ YN0000: [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ YN0000: [@balancer-labs/v2-vault]:               with another pool
➤ YN0000: [@balancer-labs/v2-vault]:                 with two tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a two token pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount  (256ms)
➤ YN0000: [@balancer-labs/v2-vault]:                 with three tokens
➤ YN0000: [@balancer-labs/v2-vault]:                   with a general pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ YN0000: [@balancer-labs/v2-vault]:     when one of the assets is ETH
➤ YN0000: [@balancer-labs/v2-vault]:       with minimal swap info pool
➤ YN0000: [@balancer-labs/v2-vault]:         when the sender is the trader
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ received ETH is wrapped into WETH
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ sent WETH is unwrapped into ETH
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ emits an event with WETH as the token address
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if less ETH than required was supplied
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ returns excess ETH if more ETH than required was supplied
➤ YN0000: [@balancer-labs/v2-vault]:         when the sender is an approved relayer
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ returns excess sent ETH to the relayer
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ returns unreceived ETH to the relayer
➤ YN0000: [@balancer-labs/v2-vault]:       with general pool
➤ YN0000: [@balancer-labs/v2-vault]:         when the sender is the trader
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ received ETH is wrapped into WETH
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ sent WETH is unwrapped into ETH (334ms)
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ emits an event with WETH as the token address
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ reverts if less ETH than required was supplied
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ returns excess ETH if more ETH than required was supplied
➤ YN0000: [@balancer-labs/v2-vault]:         when the sender is an approved relayer
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ returns excess sent ETH to the relayer
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ returns unreceived ETH to the relayer
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   VaultAuthorization
➤ YN0000: [@balancer-labs/v2-vault]:     authorizer
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ has an initial authorizer (368ms)
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ can be initialized to the zero address (410ms)
➤ YN0000: [@balancer-labs/v2-vault]:     change authorizer
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is has the permission to do it
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ can change the authorizer to another address
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ emits an event when authorizer changed
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ can change the authorizer to the zero address
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ can not change the authorizer if the permission was revoked
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender does not have the permission to do it
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     set relayer approval
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is the user
➤ YN0000: [@balancer-labs/v2-vault]:         when the relayer was not approved
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ sets the approval
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ emits an event when setting relayer approval
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ resets the approval
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ emits an event when resetting relayer approval
➤ YN0000: [@balancer-labs/v2-vault]:         when the relayer was approved
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ sets the approval
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ emits an event when setting relayer approval
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ resets the approval
➤ YN0000: [@balancer-labs/v2-vault]:           ✓ emits an event when resetting relayer approval
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender is not the user
➤ YN0000: [@balancer-labs/v2-vault]:         when the sender is allowed by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender is approved by the user
➤ YN0000: [@balancer-labs/v2-vault]:             when the relayer was not approved
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ sets the approval
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ emits an event when setting relayer approval
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ resets the approval
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ emits an event when resetting relayer approval
➤ YN0000: [@balancer-labs/v2-vault]:             when the relayer was approved
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ sets the approval
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ emits an event when setting relayer approval
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ resets the approval
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ emits an event when resetting relayer approval
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender is not approved by the user
➤ YN0000: [@balancer-labs/v2-vault]:             when the sender is allowed by signature
➤ YN0000: [@balancer-labs/v2-vault]:               when the relayer was not approved
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ sets the approval
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ emits an event when setting relayer approval
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ resets the approval
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ emits an event when resetting relayer approval
➤ YN0000: [@balancer-labs/v2-vault]:               when the relayer was approved
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ sets the approval
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ emits an event when setting relayer approval
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ resets the approval
➤ YN0000: [@balancer-labs/v2-vault]:                 ✓ emits an event when resetting relayer approval
➤ YN0000: [@balancer-labs/v2-vault]:             with no signature
➤ YN0000: [@balancer-labs/v2-vault]:               ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:         when the sender is not allowed by the authorizer
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender is approved by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:           when the sender is not approved by the user
➤ YN0000: [@balancer-labs/v2-vault]:             ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]:     temporarily pausable
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender has the permission to pause and unpause
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ can pause
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ can unpause
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ cannot pause if the permission is revoked
➤ YN0000: [@balancer-labs/v2-vault]:       when the sender does not have the permission to unpause
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   balance allocation
➤ YN0000: [@balancer-labs/v2-vault]:     cash, managed & last change block
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ stores zero balance
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ stores partial zero balances
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ stores non-zero balances
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ stores extreme cash
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ stores extreme managed
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ stores extreme balance
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ stores extreme block number
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ reverts on total overflow
➤ YN0000: [@balancer-labs/v2-vault]:     cash
➤ YN0000: [@balancer-labs/v2-vault]:       increase
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ increases cash by zero (267ms)
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ increases cash by non-zero (514ms)
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ increases cash to extreme amount
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts on cash overflow
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts on total overflow
➤ YN0000: [@balancer-labs/v2-vault]:       decrease
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ decreases cash by zero (255ms)
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ decreases cash by non-zero (427ms)
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ decreases cash to zero
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts on negative cash
➤ YN0000: [@balancer-labs/v2-vault]:     managed
➤ YN0000: [@balancer-labs/v2-vault]:       cash to managed
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ manages zero
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ manages non-zero
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ manages extreme amounts
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts when transferring more cash than available
➤ YN0000: [@balancer-labs/v2-vault]:       managed to cash
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ cashes out zero
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ cashes out non-zero
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ cashes out extreme amounts
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts when cashing out more managed balance than available
➤ YN0000: [@balancer-labs/v2-vault]:       set managed balance
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ sets managed to zero
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ sets managed to non-zero
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ sets managed to extreme value
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ reverts on total overflow
➤ YN0000: [@balancer-labs/v2-vault]:     shared balances
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ packs and unpacks zero balances
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ packs and unpacks partial balances (535ms)
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ packs and unpacks extreme partial balances (620ms)
➤ YN0000: [@balancer-labs/v2-vault]:       if A has a more recent last change block
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ stores the most recent last change block
➤ YN0000: [@balancer-labs/v2-vault]:       if B has a more recent last change block
➤ YN0000: [@balancer-labs/v2-vault]:         ✓ stores the most recent last change block
➤ YN0000: [@balancer-labs/v2-vault]:     total balances
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ handles zero balances
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ handles normal values
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ handles extreme cash values
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ handles extreme managed values
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ handles extreme values
➤ YN0000: [@balancer-labs/v2-vault]:     zeroed balances
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ YN0000: [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: [@balancer-labs/v2-vault]:   2917 passing (9m)
➤ YN0000: [@balancer-labs/v2-vault]: 
➤ YN0000: Done in 12m 30s
```