The following is the output of a complete test run, made on commit [`2bd18b0`](https://github.com/balancer-labs/balancer-v2-monorepo/commit/2bd18b067d52560ecc1812b3c6f478b659b765e0), from July 8th, 2021. 

## Test Methodology

The output reflects the general best practices for unit test creation:

```
describe("Contract under test")
  describe("Feature")
    context("Configuration for a set of tests - this can be nested as needed, for complex cases")
      it("individual tests within a given configuration (e.g., 'caller is owner', 'caller is not owner', etc.)")
```
      
It is important that the text description accurately reflects the content of the test, and that *only* the feature describe is tested. Ideally, the concatenation of descriptive texts for any given test forms a clear, understandable narrative.

## Test Coverage

It was not possible to run standard coverage tests on this code, since those rely on standard `require` statements with
revert reasons. To conserve bytecode, we replaced this with custom assembly-coded `_require` function calls that return
codes instead of standard revert strings.

```
➤ [@balancer-labs/v2-deployments]: Running normal tests...
➤ [@balancer-labs/v2-deployments]: 
➤ [@balancer-labs/v2-deployments]: 
➤ [@balancer-labs/v2-deployments]:   StablePoolFactory
➤ [@balancer-labs/v2-deployments]:     with no previous deploy
➤ [@balancer-labs/v2-deployments]:       when forced
➤ [@balancer-labs/v2-deployments]:         ✓ deploys a stable pool factory (7489ms)
➤ [@balancer-labs/v2-deployments]:       when not forced
➤ [@balancer-labs/v2-deployments]:         ✓ deploys a stable pool factory (558ms)
➤ [@balancer-labs/v2-deployments]:     with a previous deploy
➤ [@balancer-labs/v2-deployments]:       when forced
➤ [@balancer-labs/v2-deployments]:         ✓ re-deploys the stable pool factory (1246ms)
➤ [@balancer-labs/v2-deployments]:       when not forced
➤ [@balancer-labs/v2-deployments]:         ✓ does not re-deploys the stable pool factory
➤ [@balancer-labs/v2-deployments]: 
➤ [@balancer-labs/v2-deployments]: 
➤ [@balancer-labs/v2-deployments]:   4 passing (9s)
➤ [@balancer-labs/v2-deployments]: 
➤ [@balancer-labs/v2-asset-manager-utils]: 
➤ [@balancer-labs/v2-asset-manager-utils]: 
➤ [@balancer-labs/v2-asset-manager-utils]:   Aave Asset manager
➤ [@balancer-labs/v2-asset-manager-utils]:     claimRewards
➤ [@balancer-labs/v2-asset-manager-utils]:       ✓ sends expected amount of stkAave to the rewards contract (352ms)
➤ [@balancer-labs/v2-asset-manager-utils]:       ✓ distributes the reward according to the fraction of staked LP tokens (364ms)
➤ [@balancer-labs/v2-asset-manager-utils]: 
➤ [@balancer-labs/v2-asset-manager-utils]:   RebalancingRelayer
➤ [@balancer-labs/v2-asset-manager-utils]:     vault
➤ [@balancer-labs/v2-asset-manager-utils]:       ✓ uses the given vault
➤ [@balancer-labs/v2-asset-manager-utils]:     join
➤ [@balancer-labs/v2-asset-manager-utils]:       when going through the relayer
➤ [@balancer-labs/v2-asset-manager-utils]:         when the relayer is allowed to join
➤ [@balancer-labs/v2-asset-manager-utils]:           when the user did allow the relayer
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ joins the pool (782ms)
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ rebalances the pool (563ms)
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ returns any extra value to the sender (752ms)
➤ [@balancer-labs/v2-asset-manager-utils]:           when the user did not allow the relayer
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ reverts (467ms)
➤ [@balancer-labs/v2-asset-manager-utils]:           when the relayer is not allowed to join
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ reverts
➤ [@balancer-labs/v2-asset-manager-utils]:       when going through the vault
➤ [@balancer-labs/v2-asset-manager-utils]:         ✓ reverts
➤ [@balancer-labs/v2-asset-manager-utils]:     exit
➤ [@balancer-labs/v2-asset-manager-utils]:       when going through the relayer
➤ [@balancer-labs/v2-asset-manager-utils]:         when the relayer is allowed to exit
➤ [@balancer-labs/v2-asset-manager-utils]:           when the user did allow the relayer
➤ [@balancer-labs/v2-asset-manager-utils]:             when pool has enough cash to process exit
➤ [@balancer-labs/v2-asset-manager-utils]:               ✓ exits the pool (753ms)
➤ [@balancer-labs/v2-asset-manager-utils]:               ✓ rebalances the pool (659ms)
➤ [@balancer-labs/v2-asset-manager-utils]:             when pool does not have enough cash to process exit
➤ [@balancer-labs/v2-asset-manager-utils]:               ✓ exits the pool (779ms)
➤ [@balancer-labs/v2-asset-manager-utils]:               ✓ rebalances the pool (683ms)
➤ [@balancer-labs/v2-asset-manager-utils]:           when the user did not allow the relayer
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ reverts
➤ [@balancer-labs/v2-asset-manager-utils]:           when the relayer is not allowed to exit
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ reverts
➤ [@balancer-labs/v2-asset-manager-utils]:       when going through the vault
➤ [@balancer-labs/v2-asset-manager-utils]:         ✓ reverts
➤ [@balancer-labs/v2-asset-manager-utils]: 
➤ [@balancer-labs/v2-asset-manager-utils]:   Rewards Asset manager
➤ [@balancer-labs/v2-asset-manager-utils]:     deployment
➤ [@balancer-labs/v2-asset-manager-utils]:       ✓ different managers can be set for different tokens
➤ [@balancer-labs/v2-asset-manager-utils]:     setConfig
➤ [@balancer-labs/v2-asset-manager-utils]:       ✓ allows a pool controller to set the pools target investment config
➤ [@balancer-labs/v2-asset-manager-utils]:       ✓ emits an event
➤ [@balancer-labs/v2-asset-manager-utils]:       ✓ reverts when setting upper critical over 100%
➤ [@balancer-labs/v2-asset-manager-utils]:       ✓ reverts when setting upper critical below target
➤ [@balancer-labs/v2-asset-manager-utils]:       ✓ reverts when setting target above 95%
➤ [@balancer-labs/v2-asset-manager-utils]:       ✓ reverts when setting lower critical above target
➤ [@balancer-labs/v2-asset-manager-utils]:       ✓ prevents an unauthorized user from setting the pool config
➤ [@balancer-labs/v2-asset-manager-utils]:     rebalance
➤ [@balancer-labs/v2-asset-manager-utils]:       when pool is above target investment level
➤ [@balancer-labs/v2-asset-manager-utils]:         when pool is in non-critical range
➤ [@balancer-labs/v2-asset-manager-utils]:           ✓ shouldRebalance returns false
➤ [@balancer-labs/v2-asset-manager-utils]:           when forced
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ emits a Rebalance event
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ transfers the expected number of tokens to the Vault
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ returns the pool to its target allocation
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ updates the pool's managed balance on the vault correctly
➤ [@balancer-labs/v2-asset-manager-utils]:           when not forced
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ skips the rebalance
➤ [@balancer-labs/v2-asset-manager-utils]:         when pool is above upper critical investment level
➤ [@balancer-labs/v2-asset-manager-utils]:           ✓ shouldRebalance returns true
➤ [@balancer-labs/v2-asset-manager-utils]:           when forced
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ emits a Rebalance event
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ transfers the expected number of tokens to the Vault (255ms)
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ returns the pool to its target allocation
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ updates the pool's managed balance on the vault correctly
➤ [@balancer-labs/v2-asset-manager-utils]:           when not forced
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ emits a Rebalance event
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ transfers the expected number of tokens to the Vault (335ms)
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ returns the pool to its target allocation
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ updates the pool's managed balance on the vault correctly
➤ [@balancer-labs/v2-asset-manager-utils]:       when pool is below target investment level
➤ [@balancer-labs/v2-asset-manager-utils]:         when pool is in non-critical range
➤ [@balancer-labs/v2-asset-manager-utils]:           ✓ shouldRebalance returns false
➤ [@balancer-labs/v2-asset-manager-utils]:           when forced
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ emits a Rebalance event
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ transfers the expected number of tokens to the Vault (307ms)
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ returns the pool to its target allocation
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ updates the pool's managed balance on the vault correctly
➤ [@balancer-labs/v2-asset-manager-utils]:           when not forced
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ skips the rebalance
➤ [@balancer-labs/v2-asset-manager-utils]:         when pool is below lower critical investment level
➤ [@balancer-labs/v2-asset-manager-utils]:           ✓ shouldRebalance returns true
➤ [@balancer-labs/v2-asset-manager-utils]:           when forced
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ emits a Rebalance event (357ms)
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ transfers the expected number of tokens to the Vault (267ms)
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ returns the pool to its target allocation
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ updates the pool's managed balance on the vault correctly
➤ [@balancer-labs/v2-asset-manager-utils]:           when not forced
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ emits a Rebalance event
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ transfers the expected number of tokens to the Vault (266ms)
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ returns the pool to its target allocation
➤ [@balancer-labs/v2-asset-manager-utils]:             ✓ updates the pool's managed balance on the vault correctly (302ms)
➤ [@balancer-labs/v2-asset-manager-utils]: 
➤ [@balancer-labs/v2-asset-manager-utils]: 
➤ [@balancer-labs/v2-asset-manager-utils]:   54 passing (41s)
➤ [@balancer-labs/v2-asset-manager-utils]: 
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-solidity-utils]:   BalancerErrors
➤ [@balancer-labs/v2-solidity-utils]:     ✓ encodes the error code as expected
➤ [@balancer-labs/v2-solidity-utils]:     ✓ translates the error code to its corresponding string if existent
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-solidity-utils]:   BasePoolCodeFactory
➤ [@balancer-labs/v2-solidity-utils]:     ✓ returns the contract creation code storage addresses
➤ [@balancer-labs/v2-solidity-utils]:     ✓ returns the contract creation code
➤ [@balancer-labs/v2-solidity-utils]:     ✓ creates a contract
➤ [@balancer-labs/v2-solidity-utils]:     when the creation reverts
➤ [@balancer-labs/v2-solidity-utils]:       ✓ reverts and bubbles up revert reasons
➤ [@balancer-labs/v2-solidity-utils]:     with a created pool
➤ [@balancer-labs/v2-solidity-utils]:       ✓ deploys correct bytecode
➤ [@balancer-labs/v2-solidity-utils]:       ✓ passes constructor arguments correctly
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-solidity-utils]:   CodeDeployer
➤ [@balancer-labs/v2-solidity-utils]:     with no code
➤ [@balancer-labs/v2-solidity-utils]:       ✓ stores its constructor argument as its code
➤ [@balancer-labs/v2-solidity-utils]:     with some code
➤ [@balancer-labs/v2-solidity-utils]:       ✓ stores its constructor argument as its code
➤ [@balancer-labs/v2-solidity-utils]:     with code 24kB long
➤ [@balancer-labs/v2-solidity-utils]:       ✓ stores its constructor argument as its code
➤ [@balancer-labs/v2-solidity-utils]:     with code over 24kB long
➤ [@balancer-labs/v2-solidity-utils]:       ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-solidity-utils]:   ERC20
➤ [@balancer-labs/v2-solidity-utils]:     info
➤ [@balancer-labs/v2-solidity-utils]:       ✓ setups the name properly
➤ [@balancer-labs/v2-solidity-utils]:       ✓ setups the symbol properly
➤ [@balancer-labs/v2-solidity-utils]:       ✓ setups the decimals properly
➤ [@balancer-labs/v2-solidity-utils]:     total supply
➤ [@balancer-labs/v2-solidity-utils]:       when there is no supply
➤ [@balancer-labs/v2-solidity-utils]:         ✓ returns zero
➤ [@balancer-labs/v2-solidity-utils]:       when there is some supply
➤ [@balancer-labs/v2-solidity-utils]:         ✓ returns the existing supply
➤ [@balancer-labs/v2-solidity-utils]:     balanceOf
➤ [@balancer-labs/v2-solidity-utils]:       when the requested account has no tokens
➤ [@balancer-labs/v2-solidity-utils]:         ✓ returns zero
➤ [@balancer-labs/v2-solidity-utils]:       when the requested account has some tokens
➤ [@balancer-labs/v2-solidity-utils]:         ✓ returns the total amount of tokens
➤ [@balancer-labs/v2-solidity-utils]:     transfer
➤ [@balancer-labs/v2-solidity-utils]:       when the recipient is not the zero address
➤ [@balancer-labs/v2-solidity-utils]:         when the given amount is zero
➤ [@balancer-labs/v2-solidity-utils]:           ✓ transfers the requested amount
➤ [@balancer-labs/v2-solidity-utils]:           ✓ does not affect the supply
➤ [@balancer-labs/v2-solidity-utils]:           ✓ emits a transfer event
➤ [@balancer-labs/v2-solidity-utils]:         when the given amount is greater than zero
➤ [@balancer-labs/v2-solidity-utils]:           when the sender does not have enough balance
➤ [@balancer-labs/v2-solidity-utils]:             ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:           when the sender has enough balance
➤ [@balancer-labs/v2-solidity-utils]:             ✓ transfers the requested amount
➤ [@balancer-labs/v2-solidity-utils]:             ✓ does not affect the supply
➤ [@balancer-labs/v2-solidity-utils]:             ✓ emits a transfer event
➤ [@balancer-labs/v2-solidity-utils]:       when the recipient is the zero address
➤ [@balancer-labs/v2-solidity-utils]:         ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:     transfer from
➤ [@balancer-labs/v2-solidity-utils]:       when the token holder is not the zero address
➤ [@balancer-labs/v2-solidity-utils]:         when the recipient is not the zero address
➤ [@balancer-labs/v2-solidity-utils]:           when the spender has enough approved balance
➤ [@balancer-labs/v2-solidity-utils]:             when the token holder has enough balance
➤ [@balancer-labs/v2-solidity-utils]:               ✓ transfers the requested amount
➤ [@balancer-labs/v2-solidity-utils]:               ✓ does not affect the supply
➤ [@balancer-labs/v2-solidity-utils]:               ✓ does not affect the spender balance
➤ [@balancer-labs/v2-solidity-utils]:               ✓ emits a transfer event
➤ [@balancer-labs/v2-solidity-utils]:               ✓ decreases the spender allowance
➤ [@balancer-labs/v2-solidity-utils]:               ✓ emits an approval event
➤ [@balancer-labs/v2-solidity-utils]:             when the token holder does not have enough balance
➤ [@balancer-labs/v2-solidity-utils]:               ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:           when the spender does not have enough approved balance
➤ [@balancer-labs/v2-solidity-utils]:             when the token holder has enough balance
➤ [@balancer-labs/v2-solidity-utils]:               ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:             when the token holder does not have enough balance
➤ [@balancer-labs/v2-solidity-utils]:               ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:         when the recipient is the zero address
➤ [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:       when the token holder is the zero address
➤ [@balancer-labs/v2-solidity-utils]:         ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:     approve
➤ [@balancer-labs/v2-solidity-utils]:       when the spender is not the zero address
➤ [@balancer-labs/v2-solidity-utils]:         when the sender has enough balance
➤ [@balancer-labs/v2-solidity-utils]:           when there was no approved amount before
➤ [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-solidity-utils]:           when the spender had an approved amount
➤ [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-solidity-utils]:         when the sender does not have enough balance
➤ [@balancer-labs/v2-solidity-utils]:           when there was no approved amount before
➤ [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-solidity-utils]:           when the spender had an approved amount
➤ [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-solidity-utils]:       when the spender is the zero address
➤ [@balancer-labs/v2-solidity-utils]:         when the sender has enough balance
➤ [@balancer-labs/v2-solidity-utils]:           when there was no approved amount before
➤ [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-solidity-utils]:           when the spender had an approved amount
➤ [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-solidity-utils]:         when the sender does not have enough balance
➤ [@balancer-labs/v2-solidity-utils]:           when there was no approved amount before
➤ [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-solidity-utils]:           when the spender had an approved amount
➤ [@balancer-labs/v2-solidity-utils]:             ✓ approves the requested amount
➤ [@balancer-labs/v2-solidity-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-solidity-utils]:     mint
➤ [@balancer-labs/v2-solidity-utils]:       when the recipient is not the zero address
➤ [@balancer-labs/v2-solidity-utils]:         when the given amount is zero
➤ [@balancer-labs/v2-solidity-utils]:           ✓ mints the requested amount
➤ [@balancer-labs/v2-solidity-utils]:           ✓ increases the supply
➤ [@balancer-labs/v2-solidity-utils]:           ✓ emits a transfer event
➤ [@balancer-labs/v2-solidity-utils]:         when the given amount is greater than zero
➤ [@balancer-labs/v2-solidity-utils]:           ✓ mints the requested amount
➤ [@balancer-labs/v2-solidity-utils]:           ✓ increases the supply
➤ [@balancer-labs/v2-solidity-utils]:           ✓ emits a transfer event
➤ [@balancer-labs/v2-solidity-utils]:       when the recipient is the zero address
➤ [@balancer-labs/v2-solidity-utils]:         when the given amount is zero
➤ [@balancer-labs/v2-solidity-utils]:           ✓ mints the requested amount
➤ [@balancer-labs/v2-solidity-utils]:           ✓ increases the supply
➤ [@balancer-labs/v2-solidity-utils]:           ✓ emits a transfer event
➤ [@balancer-labs/v2-solidity-utils]:         when the given amount is greater than zero
➤ [@balancer-labs/v2-solidity-utils]:           ✓ mints the requested amount
➤ [@balancer-labs/v2-solidity-utils]:           ✓ increases the supply
➤ [@balancer-labs/v2-solidity-utils]:           ✓ emits a transfer event
➤ [@balancer-labs/v2-solidity-utils]:     burn
➤ [@balancer-labs/v2-solidity-utils]:       when the given amount is zero
➤ [@balancer-labs/v2-solidity-utils]:         ✓ burns the requested amount
➤ [@balancer-labs/v2-solidity-utils]:         ✓ decreases the supply
➤ [@balancer-labs/v2-solidity-utils]:         ✓ emits a transfer event
➤ [@balancer-labs/v2-solidity-utils]:       when the given amount is greater than zero
➤ [@balancer-labs/v2-solidity-utils]:         when the sender does not have enough balance
➤ [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:         when the sender has enough balance
➤ [@balancer-labs/v2-solidity-utils]:           ✓ burns the requested amount
➤ [@balancer-labs/v2-solidity-utils]:           ✓ decreases the supply
➤ [@balancer-labs/v2-solidity-utils]:           ✓ emits a transfer event
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-solidity-utils]:   ERC20Permit
➤ [@balancer-labs/v2-solidity-utils]:     info
➤ [@balancer-labs/v2-solidity-utils]:       ✓ setups the name properly
➤ [@balancer-labs/v2-solidity-utils]:     permit
➤ [@balancer-labs/v2-solidity-utils]:       ✓ initial nonce is zero
➤ [@balancer-labs/v2-solidity-utils]:       ✓ accepts holder signature (328ms)
➤ [@balancer-labs/v2-solidity-utils]:       with invalid signature
➤ [@balancer-labs/v2-solidity-utils]:         with reused signature
➤ [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:         with signature for other holder
➤ [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:         with signature for other spender
➤ [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:         with signature for other amount
➤ [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:         with signature for other token
➤ [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:         with signature with invalid nonce
➤ [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:         with expired deadline
➤ [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-solidity-utils]:   EnumerableMap
➤ [@balancer-labs/v2-solidity-utils]:     EnumerableIERC20ToBytes32Map
➤ [@balancer-labs/v2-solidity-utils]:       ✓ starts empty
➤ [@balancer-labs/v2-solidity-utils]:       set
➤ [@balancer-labs/v2-solidity-utils]:         ✓ adds a key
➤ [@balancer-labs/v2-solidity-utils]:         ✓ adds several keys (389ms)
➤ [@balancer-labs/v2-solidity-utils]:         ✓ returns false when adding keys already in the set
➤ [@balancer-labs/v2-solidity-utils]:         ✓ updates values for keys already in the set
➤ [@balancer-labs/v2-solidity-utils]:       get
➤ [@balancer-labs/v2-solidity-utils]:         ✓ returns the value for a key
➤ [@balancer-labs/v2-solidity-utils]:         ✓ reverts with a custom message if the key is not in the map
➤ [@balancer-labs/v2-solidity-utils]:       unchecked_indexOf
➤ [@balancer-labs/v2-solidity-utils]:         ✓ returns the index of an added key, plus one
➤ [@balancer-labs/v2-solidity-utils]:         ✓ adding and removing keys can change the index
➤ [@balancer-labs/v2-solidity-utils]:         ✓ returns a zero index if the key is not in the map
➤ [@balancer-labs/v2-solidity-utils]:       unchecked_setAt
➤ [@balancer-labs/v2-solidity-utils]:         ✓ updates a value
➤ [@balancer-labs/v2-solidity-utils]:         ✓ updates several values (252ms)
➤ [@balancer-labs/v2-solidity-utils]:         ✓ does not revert when setting indexes outside of the map
➤ [@balancer-labs/v2-solidity-utils]:       unchecked_at
➤ [@balancer-labs/v2-solidity-utils]:         ✓ returns an entry at an index
➤ [@balancer-labs/v2-solidity-utils]:         ✓ does not revert when accessing indexes outside of the map
➤ [@balancer-labs/v2-solidity-utils]:       unchecked_valueAt
➤ [@balancer-labs/v2-solidity-utils]:         ✓ returns a value at an index
➤ [@balancer-labs/v2-solidity-utils]:         ✓ does not revert when accessing indexes outside of the map
➤ [@balancer-labs/v2-solidity-utils]:       remove
➤ [@balancer-labs/v2-solidity-utils]:         ✓ removes added keys
➤ [@balancer-labs/v2-solidity-utils]:         ✓ returns false when removing keys not in the set
➤ [@balancer-labs/v2-solidity-utils]:         ✓ adds and removes multiple keys (535ms)
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-solidity-utils]:   ExpLog
➤ [@balancer-labs/v2-solidity-utils]:     exponent zero
➤ [@balancer-labs/v2-solidity-utils]:       ✓ handles base zero
➤ [@balancer-labs/v2-solidity-utils]:       ✓ handles base one
➤ [@balancer-labs/v2-solidity-utils]:       ✓ handles base greater than one
➤ [@balancer-labs/v2-solidity-utils]:     base zero
➤ [@balancer-labs/v2-solidity-utils]:       ✓ handles exponent zero
➤ [@balancer-labs/v2-solidity-utils]:       ✓ handles exponent one
➤ [@balancer-labs/v2-solidity-utils]:       ✓ handles exponent greater than one
➤ [@balancer-labs/v2-solidity-utils]:     base one
➤ [@balancer-labs/v2-solidity-utils]:       ✓ handles exponent zero
➤ [@balancer-labs/v2-solidity-utils]:       ✓ handles exponent one
➤ [@balancer-labs/v2-solidity-utils]:       ✓ handles exponent greater than one
➤ [@balancer-labs/v2-solidity-utils]:     decimals
➤ [@balancer-labs/v2-solidity-utils]:       ✓ handles decimals properly
➤ [@balancer-labs/v2-solidity-utils]:     max values
➤ [@balancer-labs/v2-solidity-utils]:       ✓ cannot handle a base greater than 2^255 - 1
➤ [@balancer-labs/v2-solidity-utils]:       ✓ cannot handle an exponent greater than (2^254/1e20) - 1
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-solidity-utils]:   ReentrancyGuard
➤ [@balancer-labs/v2-solidity-utils]:     ✓ does not allow remote callback
➤ [@balancer-labs/v2-solidity-utils]:     ✓ does not allow local recursion
➤ [@balancer-labs/v2-solidity-utils]:     ✓ does not allow indirect local recursion
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-solidity-utils]:   SignaturesValidator
➤ [@balancer-labs/v2-solidity-utils]:     decoding
➤ [@balancer-labs/v2-solidity-utils]:       when there is no signature encoded
➤ [@balancer-labs/v2-solidity-utils]:         ✓ decodes empty data
➤ [@balancer-labs/v2-solidity-utils]:       when there is a signature encoded
➤ [@balancer-labs/v2-solidity-utils]:         ✓ decodes it properly
➤ [@balancer-labs/v2-solidity-utils]:     authenticate
➤ [@balancer-labs/v2-solidity-utils]:       when there is no extra calldata given
➤ [@balancer-labs/v2-solidity-utils]:         ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:       when there is some extra calldata given
➤ [@balancer-labs/v2-solidity-utils]:         when the extra calldata is malformed
➤ [@balancer-labs/v2-solidity-utils]:           ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:         when the extra calldata is well formed
➤ [@balancer-labs/v2-solidity-utils]:           when the signature allows the sender
➤ [@balancer-labs/v2-solidity-utils]:             when the given nonce is the next one
➤ [@balancer-labs/v2-solidity-utils]:               when the authorized data is correct
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ allows the sender
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ increases the nonce of the user
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ does not allow using the same signature twice
➤ [@balancer-labs/v2-solidity-utils]:               when the authorized functionality is not correct
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:             when the given nonce is a past one
➤ [@balancer-labs/v2-solidity-utils]:               when the authorized data is correct
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:               when the authorized functionality is not correct
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:             when the given nonce is a future one
➤ [@balancer-labs/v2-solidity-utils]:               when the authorized data is correct
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:               when the authorized functionality is not correct
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:           when the signature allows another sender
➤ [@balancer-labs/v2-solidity-utils]:             when the given nonce is the next one
➤ [@balancer-labs/v2-solidity-utils]:               when the authorized data is correct
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:               when the authorized functionality is not correct
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:             when the given nonce is a past one
➤ [@balancer-labs/v2-solidity-utils]:               when the authorized data is correct
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:               when the authorized functionality is not correct
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:             when the given nonce is a future one
➤ [@balancer-labs/v2-solidity-utils]:               when the authorized data is correct
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:               when the authorized functionality is not correct
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the past
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]:                 when the deadline is in the future
➤ [@balancer-labs/v2-solidity-utils]:                   ✓ reverts
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-solidity-utils]:   TemporarilyPausable
➤ [@balancer-labs/v2-solidity-utils]:     initialization
➤ [@balancer-labs/v2-solidity-utils]:       ✓ can be initialized with pause window and buffer period duration
➤ [@balancer-labs/v2-solidity-utils]:       ✓ can be initialized with no pause window or buffer period duration
➤ [@balancer-labs/v2-solidity-utils]:       ✓ cannot be initialized with a pause window greater than 90 days
➤ [@balancer-labs/v2-solidity-utils]:       ✓ cannot be initialized with a buffer period greater than 30 days
➤ [@balancer-labs/v2-solidity-utils]:     pause/unpause
➤ [@balancer-labs/v2-solidity-utils]:       before the pause window end date
➤ [@balancer-labs/v2-solidity-utils]:         ✓ can be paused
➤ [@balancer-labs/v2-solidity-utils]:         ✓ can be paused and unpaused
➤ [@balancer-labs/v2-solidity-utils]:       when the pause window end date has been reached
➤ [@balancer-labs/v2-solidity-utils]:         when unpaused
➤ [@balancer-labs/v2-solidity-utils]:           before the buffer period end date
➤ [@balancer-labs/v2-solidity-utils]:             ✓ is unpaused
➤ [@balancer-labs/v2-solidity-utils]:             ✓ cannot be paused
➤ [@balancer-labs/v2-solidity-utils]:           after the buffer period end date
➤ [@balancer-labs/v2-solidity-utils]:             ✓ is unpaused
➤ [@balancer-labs/v2-solidity-utils]:             ✓ cannot be paused
➤ [@balancer-labs/v2-solidity-utils]:         when paused
➤ [@balancer-labs/v2-solidity-utils]:           before the buffer period end date
➤ [@balancer-labs/v2-solidity-utils]:             ✓ is paused
➤ [@balancer-labs/v2-solidity-utils]:             ✓ can be unpaused
➤ [@balancer-labs/v2-solidity-utils]:             ✓ cannot be unpaused and paused
➤ [@balancer-labs/v2-solidity-utils]:           after the buffer period end date
➤ [@balancer-labs/v2-solidity-utils]:             ✓ is unpaused
➤ [@balancer-labs/v2-solidity-utils]:             ✓ cannot be paused
➤ [@balancer-labs/v2-solidity-utils]:             ✓ cannot be unpaused
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-solidity-utils]:   198 passing (29s)
➤ [@balancer-labs/v2-solidity-utils]: 
➤ [@balancer-labs/v2-pool-stable]: 
➤ [@balancer-labs/v2-pool-stable]: 
➤ [@balancer-labs/v2-pool-stable]:   StableMath
➤ [@balancer-labs/v2-pool-stable]:     invariant
➤ [@balancer-labs/v2-pool-stable]:       two tokens
➤ [@balancer-labs/v2-pool-stable]:         ✓ returns invariant (702ms)
➤ [@balancer-labs/v2-pool-stable]:         ✓ returns invariant equals analytical solution
➤ [@balancer-labs/v2-pool-stable]:       three tokens
➤ [@balancer-labs/v2-pool-stable]:         ✓ returns invariant
➤ [@balancer-labs/v2-pool-stable]:     in given out
➤ [@balancer-labs/v2-pool-stable]:       two tokens
➤ [@balancer-labs/v2-pool-stable]:         ✓ returns in given out
➤ [@balancer-labs/v2-pool-stable]:       three tokens
➤ [@balancer-labs/v2-pool-stable]:         ✓ returns in given out
➤ [@balancer-labs/v2-pool-stable]:     out given in
➤ [@balancer-labs/v2-pool-stable]:       two tokens
➤ [@balancer-labs/v2-pool-stable]:         ✓ returns out given in
➤ [@balancer-labs/v2-pool-stable]:       three tokens
➤ [@balancer-labs/v2-pool-stable]:         ✓ returns out given in (262ms)
➤ [@balancer-labs/v2-pool-stable]:     protocol swap fees
➤ [@balancer-labs/v2-pool-stable]:       two tokens
➤ [@balancer-labs/v2-pool-stable]:         ✓ returns protocol swap fees
➤ [@balancer-labs/v2-pool-stable]:       three tokens
➤ [@balancer-labs/v2-pool-stable]:         ✓ returns protocol swap fees
➤ [@balancer-labs/v2-pool-stable]: 
➤ [@balancer-labs/v2-pool-stable]:   StablePool
➤ [@balancer-labs/v2-pool-stable]:     for a 1 token pool
➤ [@balancer-labs/v2-pool-stable]:       ✓ reverts if there is a single token (1847ms)
➤ [@balancer-labs/v2-pool-stable]:     for a 2 token pool
➤ [@balancer-labs/v2-pool-stable]:       creation
➤ [@balancer-labs/v2-pool-stable]:         when the creation succeeds
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets the vault
➤ [@balancer-labs/v2-pool-stable]:           ✓ uses general specialization
➤ [@balancer-labs/v2-pool-stable]:           ✓ registers tokens in the vault
➤ [@balancer-labs/v2-pool-stable]:           ✓ starts with no BPT
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets the asset managers
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets amplification
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets swap fee
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets the name
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets the symbol
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets the decimals
➤ [@balancer-labs/v2-pool-stable]:         when the creation fails
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if there are repeated tokens (1782ms)
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if the swap fee is too high (741ms)
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if amplification coefficient is too high (657ms)
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if amplification coefficient is too low (1081ms)
➤ [@balancer-labs/v2-pool-stable]:       onJoinPool
➤ [@balancer-labs/v2-pool-stable]:         ✓ fails if caller is not the vault
➤ [@balancer-labs/v2-pool-stable]:         ✓ fails if no user data
➤ [@balancer-labs/v2-pool-stable]:         ✓ fails if wrong user data
➤ [@balancer-labs/v2-pool-stable]:         initialization
➤ [@balancer-labs/v2-pool-stable]:           ✓ grants the invariant amount of BPT
➤ [@balancer-labs/v2-pool-stable]:           ✓ fails if already initialized (329ms)
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-stable]:         join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-stable]:           ✓ fails if not initialized
➤ [@balancer-labs/v2-pool-stable]:           once initialized
➤ [@balancer-labs/v2-pool-stable]:             ✓ grants BPT for exact tokens
➤ [@balancer-labs/v2-pool-stable]:             ✓ can tell how much BPT it will give in return
➤ [@balancer-labs/v2-pool-stable]:             ✓ fails if not enough BPT
➤ [@balancer-labs/v2-pool-stable]:             ✓ reverts if paused (367ms)
➤ [@balancer-labs/v2-pool-stable]:         join token in for exact BPT out
➤ [@balancer-labs/v2-pool-stable]:           ✓ fails if not initialized
➤ [@balancer-labs/v2-pool-stable]:           once initialized
➤ [@balancer-labs/v2-pool-stable]:             ✓ grants exact BPT for token in (289ms)
➤ [@balancer-labs/v2-pool-stable]:             ✓ can tell how many token amounts it will have to receive
➤ [@balancer-labs/v2-pool-stable]:             ✓ reverts if paused
➤ [@balancer-labs/v2-pool-stable]:       onExitPool
➤ [@balancer-labs/v2-pool-stable]:         ✓ fails if caller is not the vault
➤ [@balancer-labs/v2-pool-stable]:         ✓ fails if no user data
➤ [@balancer-labs/v2-pool-stable]:         ✓ fails if wrong user data
➤ [@balancer-labs/v2-pool-stable]:         exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-stable]:           ✓ grants one token for exact bpt
➤ [@balancer-labs/v2-pool-stable]:           ✓ can tell how many tokens it will give in return
➤ [@balancer-labs/v2-pool-stable]:         exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-stable]:           ✓ grants all tokens for exact bpt (276ms)
➤ [@balancer-labs/v2-pool-stable]:           ✓ fully exit (287ms)
➤ [@balancer-labs/v2-pool-stable]:           ✓ can tell how many token amounts it will give in return
➤ [@balancer-labs/v2-pool-stable]:           ✓ does not revert if paused (341ms)
➤ [@balancer-labs/v2-pool-stable]:         exit BPT in for exact tokens out
➤ [@balancer-labs/v2-pool-stable]:           ✓ grants exact tokens for bpt (294ms)
➤ [@balancer-labs/v2-pool-stable]:           ✓ can tell how much BPT it will have to receive
➤ [@balancer-labs/v2-pool-stable]:           ✓ fails if more BTP needed
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-stable]:       swaps
➤ [@balancer-labs/v2-pool-stable]:         given in
➤ [@balancer-labs/v2-pool-stable]:           ✓ calculates amount out
➤ [@balancer-labs/v2-pool-stable]:           ✓ calculates the same amount regardless of the interface used
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused (258ms)
➤ [@balancer-labs/v2-pool-stable]:         given out
➤ [@balancer-labs/v2-pool-stable]:           ✓ calculates amount in
➤ [@balancer-labs/v2-pool-stable]:           ✓ calculates the same amount regardless of the interface used
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-stable]:       protocol swap fees
➤ [@balancer-labs/v2-pool-stable]:         without balance changes
➤ [@balancer-labs/v2-pool-stable]:           ✓ joins and exits do not accumulate fees (1232ms)
➤ [@balancer-labs/v2-pool-stable]:         with previous swap
➤ [@balancer-labs/v2-pool-stable]:           with same amplification parameter
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on join exact tokens in for BPT out (282ms)
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ [@balancer-labs/v2-pool-stable]:             ✓ does not charges fee on exit if paused (299ms)
➤ [@balancer-labs/v2-pool-stable]:           with different amplification parameter
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ [@balancer-labs/v2-pool-stable]:             ✓ does not charges fee on exit if paused
➤ [@balancer-labs/v2-pool-stable]:       get rate
➤ [@balancer-labs/v2-pool-stable]:         before initialized
➤ [@balancer-labs/v2-pool-stable]:           ✓ rate is zero
➤ [@balancer-labs/v2-pool-stable]:         once initialized
➤ [@balancer-labs/v2-pool-stable]:           ✓ rate equals to one
➤ [@balancer-labs/v2-pool-stable]:       set amp
➤ [@balancer-labs/v2-pool-stable]:         when the sender is allowed
➤ [@balancer-labs/v2-pool-stable]:           when requesting a reasonable change duration
➤ [@balancer-labs/v2-pool-stable]:             when requesting a valid amp
➤ [@balancer-labs/v2-pool-stable]:               when increasing the amp
➤ [@balancer-labs/v2-pool-stable]:                 when increasing the amp by 2x
➤ [@balancer-labs/v2-pool-stable]:                   when there was no previous ongoing update
➤ [@balancer-labs/v2-pool-stable]:                     ✓ starts changing the amp
➤ [@balancer-labs/v2-pool-stable]:                     ✓ stops updating after duration
➤ [@balancer-labs/v2-pool-stable]:                     ✓ emits an event
➤ [@balancer-labs/v2-pool-stable]:                   when there was a previous ongoing update
➤ [@balancer-labs/v2-pool-stable]:                     ✓ reverts
➤ [@balancer-labs/v2-pool-stable]:                     ✓ can stop and change
➤ [@balancer-labs/v2-pool-stable]:               when decreasing the amp
➤ [@balancer-labs/v2-pool-stable]:                 when decreasing the amp by 2x
➤ [@balancer-labs/v2-pool-stable]:                   when there was no previous ongoing update
➤ [@balancer-labs/v2-pool-stable]:                     ✓ starts changing the amp
➤ [@balancer-labs/v2-pool-stable]:                     ✓ stops updating after duration
➤ [@balancer-labs/v2-pool-stable]:                     ✓ emits an event
➤ [@balancer-labs/v2-pool-stable]:                   when there was a previous ongoing update
➤ [@balancer-labs/v2-pool-stable]:                     ✓ reverts
➤ [@balancer-labs/v2-pool-stable]:                     ✓ can stop and change
➤ [@balancer-labs/v2-pool-stable]:             when requesting an invalid amp
➤ [@balancer-labs/v2-pool-stable]:               ✓ reverts when requesting below the min
➤ [@balancer-labs/v2-pool-stable]:               ✓ reverts when requesting above the max
➤ [@balancer-labs/v2-pool-stable]:               rate limits
➤ [@balancer-labs/v2-pool-stable]:                 ✓ reverts when increasing the amp by more than 2x in a single day
➤ [@balancer-labs/v2-pool-stable]:                 ✓ reverts when increasing the amp by more than 2x daily over multiple days
➤ [@balancer-labs/v2-pool-stable]:                 ✓ reverts when decreasing the amp by more than 2x in a single day
➤ [@balancer-labs/v2-pool-stable]:                 ✓ reverts when decreasing the amp by more than 2x daily over multiple days
➤ [@balancer-labs/v2-pool-stable]:           when requesting a short duration change
➤ [@balancer-labs/v2-pool-stable]:             ✓ reverts
➤ [@balancer-labs/v2-pool-stable]:         when the sender is not allowed
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts
➤ [@balancer-labs/v2-pool-stable]:     for a 3 token pool
➤ [@balancer-labs/v2-pool-stable]:       creation
➤ [@balancer-labs/v2-pool-stable]:         when the creation succeeds
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets the vault
➤ [@balancer-labs/v2-pool-stable]:           ✓ uses general specialization
➤ [@balancer-labs/v2-pool-stable]:           ✓ registers tokens in the vault
➤ [@balancer-labs/v2-pool-stable]:           ✓ starts with no BPT
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets the asset managers
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets amplification
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets swap fee
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets the name
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets the symbol
➤ [@balancer-labs/v2-pool-stable]:           ✓ sets the decimals
➤ [@balancer-labs/v2-pool-stable]:         when the creation fails
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if there are repeated tokens (1148ms)
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if the swap fee is too high (425ms)
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if amplification coefficient is too high (703ms)
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if amplification coefficient is too low (648ms)
➤ [@balancer-labs/v2-pool-stable]:       onJoinPool
➤ [@balancer-labs/v2-pool-stable]:         ✓ fails if caller is not the vault
➤ [@balancer-labs/v2-pool-stable]:         ✓ fails if no user data
➤ [@balancer-labs/v2-pool-stable]:         ✓ fails if wrong user data
➤ [@balancer-labs/v2-pool-stable]:         initialization
➤ [@balancer-labs/v2-pool-stable]:           ✓ grants the invariant amount of BPT
➤ [@balancer-labs/v2-pool-stable]:           ✓ fails if already initialized (297ms)
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-stable]:         join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-stable]:           ✓ fails if not initialized
➤ [@balancer-labs/v2-pool-stable]:           once initialized
➤ [@balancer-labs/v2-pool-stable]:             ✓ grants BPT for exact tokens (282ms)
➤ [@balancer-labs/v2-pool-stable]:             ✓ can tell how much BPT it will give in return
➤ [@balancer-labs/v2-pool-stable]:             ✓ fails if not enough BPT
➤ [@balancer-labs/v2-pool-stable]:             ✓ reverts if paused (279ms)
➤ [@balancer-labs/v2-pool-stable]:         join token in for exact BPT out
➤ [@balancer-labs/v2-pool-stable]:           ✓ fails if not initialized
➤ [@balancer-labs/v2-pool-stable]:           once initialized
➤ [@balancer-labs/v2-pool-stable]:             ✓ grants exact BPT for token in
➤ [@balancer-labs/v2-pool-stable]:             ✓ can tell how many token amounts it will have to receive
➤ [@balancer-labs/v2-pool-stable]:             ✓ reverts if paused (269ms)
➤ [@balancer-labs/v2-pool-stable]:       onExitPool
➤ [@balancer-labs/v2-pool-stable]:         ✓ fails if caller is not the vault
➤ [@balancer-labs/v2-pool-stable]:         ✓ fails if no user data
➤ [@balancer-labs/v2-pool-stable]:         ✓ fails if wrong user data
➤ [@balancer-labs/v2-pool-stable]:         exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-stable]:           ✓ grants one token for exact bpt (375ms)
➤ [@balancer-labs/v2-pool-stable]:           ✓ can tell how many tokens it will give in return
➤ [@balancer-labs/v2-pool-stable]:         exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-stable]:           ✓ grants all tokens for exact bpt
➤ [@balancer-labs/v2-pool-stable]:           ✓ fully exit
➤ [@balancer-labs/v2-pool-stable]:           ✓ can tell how many token amounts it will give in return
➤ [@balancer-labs/v2-pool-stable]:           ✓ does not revert if paused (253ms)
➤ [@balancer-labs/v2-pool-stable]:         exit BPT in for exact tokens out
➤ [@balancer-labs/v2-pool-stable]:           ✓ grants exact tokens for bpt (257ms)
➤ [@balancer-labs/v2-pool-stable]:           ✓ can tell how much BPT it will have to receive
➤ [@balancer-labs/v2-pool-stable]:           ✓ fails if more BTP needed
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused (280ms)
➤ [@balancer-labs/v2-pool-stable]:       swaps
➤ [@balancer-labs/v2-pool-stable]:         given in
➤ [@balancer-labs/v2-pool-stable]:           ✓ calculates amount out
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if using the minimal swap info interface
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if invalid token in index
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if invalid token out index
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-stable]:         given out
➤ [@balancer-labs/v2-pool-stable]:           ✓ calculates amount in
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if using the minimal swap info interface
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if invalid token in index
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if invalid token out index
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-stable]:       protocol swap fees
➤ [@balancer-labs/v2-pool-stable]:         without balance changes
➤ [@balancer-labs/v2-pool-stable]:           ✓ joins and exits do not accumulate fees (1235ms)
➤ [@balancer-labs/v2-pool-stable]:         with previous swap
➤ [@balancer-labs/v2-pool-stable]:           with same amplification parameter
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ [@balancer-labs/v2-pool-stable]:             ✓ does not charges fee on exit if paused (449ms)
➤ [@balancer-labs/v2-pool-stable]:           with different amplification parameter
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-stable]:             ✓ pays swap protocol fees on exit BPT In for exact tokens out (253ms)
➤ [@balancer-labs/v2-pool-stable]:             ✓ does not charges fee on exit if paused (272ms)
➤ [@balancer-labs/v2-pool-stable]:       get rate
➤ [@balancer-labs/v2-pool-stable]:         before initialized
➤ [@balancer-labs/v2-pool-stable]:           ✓ rate is zero
➤ [@balancer-labs/v2-pool-stable]:         once initialized
➤ [@balancer-labs/v2-pool-stable]:           ✓ rate equals to one
➤ [@balancer-labs/v2-pool-stable]:       set amp
➤ [@balancer-labs/v2-pool-stable]:         when the sender is allowed
➤ [@balancer-labs/v2-pool-stable]:           when requesting a reasonable change duration
➤ [@balancer-labs/v2-pool-stable]:             when requesting a valid amp
➤ [@balancer-labs/v2-pool-stable]:               when increasing the amp
➤ [@balancer-labs/v2-pool-stable]:                 when increasing the amp by 2x
➤ [@balancer-labs/v2-pool-stable]:                   when there was no previous ongoing update
➤ [@balancer-labs/v2-pool-stable]:                     ✓ starts changing the amp
➤ [@balancer-labs/v2-pool-stable]:                     ✓ stops updating after duration
➤ [@balancer-labs/v2-pool-stable]:                     ✓ emits an event
➤ [@balancer-labs/v2-pool-stable]:                   when there was a previous ongoing update
➤ [@balancer-labs/v2-pool-stable]:                     ✓ reverts (340ms)
➤ [@balancer-labs/v2-pool-stable]:                     ✓ can stop and change (270ms)
➤ [@balancer-labs/v2-pool-stable]:               when decreasing the amp
➤ [@balancer-labs/v2-pool-stable]:                 when decreasing the amp by 2x
➤ [@balancer-labs/v2-pool-stable]:                   when there was no previous ongoing update
➤ [@balancer-labs/v2-pool-stable]:                     ✓ starts changing the amp
➤ [@balancer-labs/v2-pool-stable]:                     ✓ stops updating after duration
➤ [@balancer-labs/v2-pool-stable]:                     ✓ emits an event
➤ [@balancer-labs/v2-pool-stable]:                   when there was a previous ongoing update
➤ [@balancer-labs/v2-pool-stable]:                     ✓ reverts
➤ [@balancer-labs/v2-pool-stable]:                     ✓ can stop and change
➤ [@balancer-labs/v2-pool-stable]:             when requesting an invalid amp
➤ [@balancer-labs/v2-pool-stable]:               ✓ reverts when requesting below the min
➤ [@balancer-labs/v2-pool-stable]:               ✓ reverts when requesting above the max
➤ [@balancer-labs/v2-pool-stable]:               rate limits
➤ [@balancer-labs/v2-pool-stable]:                 ✓ reverts when increasing the amp by more than 2x in a single day
➤ [@balancer-labs/v2-pool-stable]:                 ✓ reverts when increasing the amp by more than 2x daily over multiple days
➤ [@balancer-labs/v2-pool-stable]:                 ✓ reverts when decreasing the amp by more than 2x in a single day
➤ [@balancer-labs/v2-pool-stable]:                 ✓ reverts when decreasing the amp by more than 2x daily over multiple days
➤ [@balancer-labs/v2-pool-stable]:           when requesting a short duration change
➤ [@balancer-labs/v2-pool-stable]:             ✓ reverts
➤ [@balancer-labs/v2-pool-stable]:         when the sender is not allowed
➤ [@balancer-labs/v2-pool-stable]:           ✓ reverts
➤ [@balancer-labs/v2-pool-stable]:     for a too-many token pool
➤ [@balancer-labs/v2-pool-stable]:       ✓ reverts if there are too many tokens (2165ms)
➤ [@balancer-labs/v2-pool-stable]: 
➤ [@balancer-labs/v2-pool-stable]: 
➤ [@balancer-labs/v2-pool-stable]:   173 passing (1m)
➤ [@balancer-labs/v2-pool-stable]: 
➤ [@balancer-labs/v2-standalone-utils]: 
➤ [@balancer-labs/v2-standalone-utils]: 
➤ [@balancer-labs/v2-standalone-utils]:   BalancerHelpers
➤ [@balancer-labs/v2-standalone-utils]:     queryJoin
➤ [@balancer-labs/v2-standalone-utils]:       ✓ can query join results (319ms)
➤ [@balancer-labs/v2-standalone-utils]:       ✓ bubbles up revert reasons
➤ [@balancer-labs/v2-standalone-utils]:     queryExit
➤ [@balancer-labs/v2-standalone-utils]:       ✓ can query exit results
➤ [@balancer-labs/v2-standalone-utils]:       ✓ bubbles up revert reasons
➤ [@balancer-labs/v2-standalone-utils]: 
➤ [@balancer-labs/v2-standalone-utils]: 
➤ [@balancer-labs/v2-standalone-utils]:   4 passing (8s)
➤ [@balancer-labs/v2-standalone-utils]: 
➤ [@balancer-labs/v2-pool-utils]: 
➤ [@balancer-labs/v2-pool-utils]: 
➤ [@balancer-labs/v2-pool-utils]:   BalancerPoolToken
➤ [@balancer-labs/v2-pool-utils]:     transfer from
➤ [@balancer-labs/v2-pool-utils]:       when the recipient is not the zero address
➤ [@balancer-labs/v2-pool-utils]:         when the spender is the token holder
➤ [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ [@balancer-labs/v2-pool-utils]:             ✓ transfers the requested amount (639ms)
➤ [@balancer-labs/v2-pool-utils]:             ✓ does not affect the supply
➤ [@balancer-labs/v2-pool-utils]:             ✓ does not affect the spender balance (325ms)
➤ [@balancer-labs/v2-pool-utils]:             ✓ emits a transfer event
➤ [@balancer-labs/v2-pool-utils]:           when the token holder does not have enough balance
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts (277ms)
➤ [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ [@balancer-labs/v2-pool-utils]:             ✓ does not emit an approval event
➤ [@balancer-labs/v2-pool-utils]:         when the spender has enough approved balance
➤ [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ [@balancer-labs/v2-pool-utils]:             ✓ transfers the requested amount (356ms)
➤ [@balancer-labs/v2-pool-utils]:             ✓ does not affect the supply
➤ [@balancer-labs/v2-pool-utils]:             ✓ does not affect the spender balance
➤ [@balancer-labs/v2-pool-utils]:             ✓ emits a transfer event
➤ [@balancer-labs/v2-pool-utils]:           when the token holder does not have enough balance
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ [@balancer-labs/v2-pool-utils]:             ✓ decreases the spender allowance (278ms)
➤ [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-pool-utils]:         when the spender has an infinite approved balance
➤ [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ [@balancer-labs/v2-pool-utils]:             ✓ transfers the requested amount
➤ [@balancer-labs/v2-pool-utils]:             ✓ does not affect the supply
➤ [@balancer-labs/v2-pool-utils]:             ✓ does not affect the spender balance
➤ [@balancer-labs/v2-pool-utils]:             ✓ emits a transfer event
➤ [@balancer-labs/v2-pool-utils]:           when the token holder does not have enough balance
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ [@balancer-labs/v2-pool-utils]:             ✓ does not decrease the spender allowance
➤ [@balancer-labs/v2-pool-utils]:             ✓ does not emit an approval event
➤ [@balancer-labs/v2-pool-utils]:         when the spender does not have enough approved balance
➤ [@balancer-labs/v2-pool-utils]:           when the token holder has enough balance
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:           when the token holder does not have enough balance
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:       when the recipient is the zero address
➤ [@balancer-labs/v2-pool-utils]:         ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:     decreaseAllowance
➤ [@balancer-labs/v2-pool-utils]:       when the spender is not the zero address
➤ [@balancer-labs/v2-pool-utils]:         when the sender has enough balance
➤ [@balancer-labs/v2-pool-utils]:           when there was no approved amount before
➤ [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-pool-utils]:           when the spender had an approved amount
➤ [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-pool-utils]:         when the sender does not have enough balance
➤ [@balancer-labs/v2-pool-utils]:           when there was no approved amount before
➤ [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-pool-utils]:           when the spender had an approved amount
➤ [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-pool-utils]:       when the spender is the zero address
➤ [@balancer-labs/v2-pool-utils]:         when the sender has enough balance
➤ [@balancer-labs/v2-pool-utils]:           when there was no approved amount before
➤ [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-pool-utils]:           when the spender had an approved amount
➤ [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-pool-utils]:         when the sender does not have enough balance
➤ [@balancer-labs/v2-pool-utils]:           when there was no approved amount before
➤ [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-pool-utils]:           when the spender had an approved amount
➤ [@balancer-labs/v2-pool-utils]:             ✓ decreases the allowance by the requested amount
➤ [@balancer-labs/v2-pool-utils]:             ✓ emits an approval event
➤ [@balancer-labs/v2-pool-utils]: 
➤ [@balancer-labs/v2-pool-utils]:   BasePool
➤ [@balancer-labs/v2-pool-utils]:     deployment
➤ [@balancer-labs/v2-pool-utils]:       ✓ registers a pool in the vault (3514ms)
➤ [@balancer-labs/v2-pool-utils]:       ✓ reverts if the tokens are not sorted
➤ [@balancer-labs/v2-pool-utils]:     authorizer
➤ [@balancer-labs/v2-pool-utils]:       ✓ uses the authorizer of the vault
➤ [@balancer-labs/v2-pool-utils]:       ✓ tracks authorizer changes in the vault
➤ [@balancer-labs/v2-pool-utils]:       action identifiers
➤ [@balancer-labs/v2-pool-utils]:         with same pool creator
➤ [@balancer-labs/v2-pool-utils]:           ✓ pools share action identifiers (4825ms)
➤ [@balancer-labs/v2-pool-utils]:         with different pool creators
➤ [@balancer-labs/v2-pool-utils]:           ✓ pools have unique action identifiers (4234ms)
➤ [@balancer-labs/v2-pool-utils]:     swap fee
➤ [@balancer-labs/v2-pool-utils]:       initialization
➤ [@balancer-labs/v2-pool-utils]:         ✓ has an initial swap fee (1904ms)
➤ [@balancer-labs/v2-pool-utils]:       set swap fee percentage
➤ [@balancer-labs/v2-pool-utils]:         with a delegated owner
➤ [@balancer-labs/v2-pool-utils]:           when the sender has the set fee permission in the authorizer
➤ [@balancer-labs/v2-pool-utils]:             when the new swap fee percentage is within bounds
➤ [@balancer-labs/v2-pool-utils]:               ✓ can change the swap fee
➤ [@balancer-labs/v2-pool-utils]:               ✓ emits an event
➤ [@balancer-labs/v2-pool-utils]:             when the new swap fee percentage is above the maximum
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:             when the new swap fee percentage is below the minimum
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:           when the sender does not have the set fee permission in the authorizer
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:         with an owner
➤ [@balancer-labs/v2-pool-utils]:           when the sender is the owner
➤ [@balancer-labs/v2-pool-utils]:             when the new swap fee percentage is within bounds
➤ [@balancer-labs/v2-pool-utils]:               ✓ can change the swap fee
➤ [@balancer-labs/v2-pool-utils]:               ✓ emits an event
➤ [@balancer-labs/v2-pool-utils]:             when the new swap fee percentage is above the maximum
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:             when the new swap fee percentage is below the minimum
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:           when the sender is not the owner
➤ [@balancer-labs/v2-pool-utils]:             when the sender does not have the set fee permission in the authorizer
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:             when the sender has the set fee permission in the authorizer
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:     set paused
➤ [@balancer-labs/v2-pool-utils]:       with a delegated owner
➤ [@balancer-labs/v2-pool-utils]:         when the sender does not have the pause permission in the authorizer
➤ [@balancer-labs/v2-pool-utils]:           ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:         when the sender has the pause permission in the authorizer
➤ [@balancer-labs/v2-pool-utils]:           ✓ can pause
➤ [@balancer-labs/v2-pool-utils]:           ✓ can unpause
➤ [@balancer-labs/v2-pool-utils]:           ✓ cannot unpause after the pause window
➤ [@balancer-labs/v2-pool-utils]:       with an owner
➤ [@balancer-labs/v2-pool-utils]:         when the sender is the owner
➤ [@balancer-labs/v2-pool-utils]:           ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:         when the sender is not the owner
➤ [@balancer-labs/v2-pool-utils]:           when the sender does not have the pause permission in the authorizer
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:           when the sender has the pause permission in the authorizer
➤ [@balancer-labs/v2-pool-utils]:             ✓ can pause
➤ [@balancer-labs/v2-pool-utils]:             ✓ can unpause
➤ [@balancer-labs/v2-pool-utils]:             ✓ cannot unpause after the pause window
➤ [@balancer-labs/v2-pool-utils]:     misc data
➤ [@balancer-labs/v2-pool-utils]:       ✓ stores the swap fee pct in the most-significant 64 bits
➤ [@balancer-labs/v2-pool-utils]:       ✓ can store up-to 192 bits of extra data (2642ms)
➤ [@balancer-labs/v2-pool-utils]: 
➤ [@balancer-labs/v2-pool-utils]:   RelayedBasePool
➤ [@balancer-labs/v2-pool-utils]:     relayer
➤ [@balancer-labs/v2-pool-utils]:       ✓ uses the given relayer
➤ [@balancer-labs/v2-pool-utils]:     join
➤ [@balancer-labs/v2-pool-utils]:       when the relayer tells it has not called the pool
➤ [@balancer-labs/v2-pool-utils]:         ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:       when the relayer tells it has called the pool
➤ [@balancer-labs/v2-pool-utils]:         ✓ does not revert (312ms)
➤ [@balancer-labs/v2-pool-utils]:     exit
➤ [@balancer-labs/v2-pool-utils]:       when the relayer tells it has not called the pool
➤ [@balancer-labs/v2-pool-utils]:         ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:       when the relayer tells it has called the pool
➤ [@balancer-labs/v2-pool-utils]:         ✓ does not revert
➤ [@balancer-labs/v2-pool-utils]: 
➤ [@balancer-labs/v2-pool-utils]:   BasePoolFactory
➤ [@balancer-labs/v2-pool-utils]:     ✓ stores the vault address
➤ [@balancer-labs/v2-pool-utils]:     ✓ creates a pool
➤ [@balancer-labs/v2-pool-utils]:     with a created pool
➤ [@balancer-labs/v2-pool-utils]:       ✓ tracks pools created by the factory
➤ [@balancer-labs/v2-pool-utils]:       ✓ does not track pools that were not created by the factory
➤ [@balancer-labs/v2-pool-utils]: 
➤ [@balancer-labs/v2-pool-utils]:   BasePoolSplitCodeFactory
➤ [@balancer-labs/v2-pool-utils]:     ✓ stores the vault address
➤ [@balancer-labs/v2-pool-utils]:     ✓ emits an event
➤ [@balancer-labs/v2-pool-utils]:     with a created pool
➤ [@balancer-labs/v2-pool-utils]:       ✓ tracks pools created by the factory
➤ [@balancer-labs/v2-pool-utils]:       ✓ does not track pools that were not created by the factory
➤ [@balancer-labs/v2-pool-utils]: 
➤ [@balancer-labs/v2-pool-utils]:   FactoryWidePauseWindow
➤ [@balancer-labs/v2-pool-utils]:     before the pause window end time
➤ [@balancer-labs/v2-pool-utils]:       at the beginning of the pause window
➤ [@balancer-labs/v2-pool-utils]:         ✓ returns the current pause window duration
➤ [@balancer-labs/v2-pool-utils]:         ✓ returns the full buffer period duration
➤ [@balancer-labs/v2-pool-utils]:       after some time has passed
➤ [@balancer-labs/v2-pool-utils]:         ✓ returns the current pause window duration
➤ [@balancer-labs/v2-pool-utils]:         ✓ returns the full buffer period duration
➤ [@balancer-labs/v2-pool-utils]:     at the pause window end time
➤ [@balancer-labs/v2-pool-utils]:       ✓ returns a zero pause window duration
➤ [@balancer-labs/v2-pool-utils]:       ✓ returns a zero buffer period duration
➤ [@balancer-labs/v2-pool-utils]:     after the pause window end time
➤ [@balancer-labs/v2-pool-utils]:       ✓ returns a zero pause window duration
➤ [@balancer-labs/v2-pool-utils]:       ✓ returns a zero buffer period duration
➤ [@balancer-labs/v2-pool-utils]: 
➤ [@balancer-labs/v2-pool-utils]:   PoolPriceOracle
➤ [@balancer-labs/v2-pool-utils]:     process
➤ [@balancer-labs/v2-pool-utils]:       when there was no sample in the given index
➤ [@balancer-labs/v2-pool-utils]:         ✓ does not update the previous sample
➤ [@balancer-labs/v2-pool-utils]:         ✓ creates another sample
➤ [@balancer-labs/v2-pool-utils]:       when there was a sample in the given index
➤ [@balancer-labs/v2-pool-utils]:         when the next sample does not complete the buffer
➤ [@balancer-labs/v2-pool-utils]:           when the current timestamp is the same as the initial timestamp of the current sample
➤ [@balancer-labs/v2-pool-utils]:             ✓ updates the existing sample
➤ [@balancer-labs/v2-pool-utils]:           when the current timestamp is greater than the initial timestamp by less than 2 minutes
➤ [@balancer-labs/v2-pool-utils]:             ✓ updates the existing sample
➤ [@balancer-labs/v2-pool-utils]:           when the current timestamp is greater than the initial timestamp by more than 2 minutes
➤ [@balancer-labs/v2-pool-utils]:             ✓ does not update the previous sample
➤ [@balancer-labs/v2-pool-utils]:             ✓ creates another sample
➤ [@balancer-labs/v2-pool-utils]:         when the next sample completes the buffer
➤ [@balancer-labs/v2-pool-utils]:           when the current timestamp is greater than the initial timestamp by less than 2 minutes
➤ [@balancer-labs/v2-pool-utils]:             ✓ updates the existing sample
➤ [@balancer-labs/v2-pool-utils]:           when the current timestamp is greater than the initial timestamp by more than 2 minutes
➤ [@balancer-labs/v2-pool-utils]:             ✓ does not update the previous sample
➤ [@balancer-labs/v2-pool-utils]:             ✓ creates another sample
➤ [@balancer-labs/v2-pool-utils]:     findNearestSample
➤ [@balancer-labs/v2-pool-utils]:       without offset
➤ [@balancer-labs/v2-pool-utils]:         ✓ can find every exact value (12721ms)
➤ [@balancer-labs/v2-pool-utils]:         ✓ can find intermediate values (10821ms)
➤ [@balancer-labs/v2-pool-utils]:       with a small offset
➤ [@balancer-labs/v2-pool-utils]:         ✓ can find every exact value (9611ms)
➤ [@balancer-labs/v2-pool-utils]:         ✓ can find intermediate values (10507ms)
➤ [@balancer-labs/v2-pool-utils]:       with a large offset
➤ [@balancer-labs/v2-pool-utils]:         ✓ can find every exact value (10799ms)
➤ [@balancer-labs/v2-pool-utils]:         ✓ can find intermediate values (12423ms)
➤ [@balancer-labs/v2-pool-utils]:       with the highest offset
➤ [@balancer-labs/v2-pool-utils]:         ✓ can find every exact value (10795ms)
➤ [@balancer-labs/v2-pool-utils]:         ✓ can find intermediate values (9485ms)
➤ [@balancer-labs/v2-pool-utils]:     getPastAccumulator
➤ [@balancer-labs/v2-pool-utils]:       without offset
➤ [@balancer-labs/v2-pool-utils]:         invariant
➤ [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:         BPT price
➤ [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:         pair price
➤ [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:       with a small offset
➤ [@balancer-labs/v2-pool-utils]:         invariant
➤ [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:         BPT price
➤ [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:         pair price
➤ [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:       with a large offset
➤ [@balancer-labs/v2-pool-utils]:         invariant
➤ [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:         BPT price
➤ [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:         pair price
➤ [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:       with the highest offset
➤ [@balancer-labs/v2-pool-utils]:         invariant
➤ [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:         BPT price
➤ [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]:         pair price
➤ [@balancer-labs/v2-pool-utils]:           with a complete buffer
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ interpolates between past accumulators
➤ [@balancer-labs/v2-pool-utils]:             ✓ finds last accumulator
➤ [@balancer-labs/v2-pool-utils]:             ✓ reverts with too old timestamp
➤ [@balancer-labs/v2-pool-utils]:           with incomplete buffer
➤ [@balancer-labs/v2-pool-utils]:             when querying latest and future timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ can find the latest accumulator
➤ [@balancer-labs/v2-pool-utils]:               ✓ extrapolates future accumulators
➤ [@balancer-labs/v2-pool-utils]:             when querying past timestamps
➤ [@balancer-labs/v2-pool-utils]:               ✓ reverts
➤ [@balancer-labs/v2-pool-utils]: 
➤ [@balancer-labs/v2-pool-utils]:   Samples
➤ [@balancer-labs/v2-pool-utils]:     encoding
➤ [@balancer-labs/v2-pool-utils]:       ✓ encodes samples correctly (400ms)
➤ [@balancer-labs/v2-pool-utils]:     update
➤ [@balancer-labs/v2-pool-utils]:       ✓ updates the sample correctly
➤ [@balancer-labs/v2-pool-utils]: 
➤ [@balancer-labs/v2-pool-utils]: 
➤ [@balancer-labs/v2-pool-utils]:   192 passing (3m)
➤ [@balancer-labs/v2-pool-utils]: 
➤ [@balancer-labs/v2-pool-weighted]: Compiling 61 files with 0.7.1
➤ [@balancer-labs/v2-pool-weighted]: Compilation finished successfully
➤ [@balancer-labs/v2-pool-weighted]: 
➤ [@balancer-labs/v2-pool-weighted]: 
➤ [@balancer-labs/v2-pool-weighted]:   BaseWeightedPool
➤ [@balancer-labs/v2-pool-weighted]:     for a 1 token pool
➤ [@balancer-labs/v2-pool-weighted]:       ✓ reverts if there is a single token (4213ms)
➤ [@balancer-labs/v2-pool-weighted]:     for a 2 token pool
➤ [@balancer-labs/v2-pool-weighted]:       creation
➤ [@balancer-labs/v2-pool-weighted]:         when the creation succeeds
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the vault
➤ [@balancer-labs/v2-pool-weighted]:           ✓ uses the corresponding specialization
➤ [@balancer-labs/v2-pool-weighted]:           ✓ registers tokens in the vault
➤ [@balancer-labs/v2-pool-weighted]:           ✓ starts with no BPT
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the asset managers
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets swap fee
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the name
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the symbol
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the decimals
➤ [@balancer-labs/v2-pool-weighted]:         when the creation fails
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if the number of tokens and weights do not match (627ms)
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if there are repeated tokens (1210ms)
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if the swap fee is too high (567ms)
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if at least one weight is too low (882ms)
➤ [@balancer-labs/v2-pool-weighted]:       onJoinPool
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if caller is not the vault
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if no user data
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if wrong user data
➤ [@balancer-labs/v2-pool-weighted]:         initialization
➤ [@balancer-labs/v2-pool-weighted]:           ✓ grants the n * invariant amount of BPT (279ms)
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if already initialized
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused (263ms)
➤ [@balancer-labs/v2-pool-weighted]:         join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if not initialized
➤ [@balancer-labs/v2-pool-weighted]:           once initialized
➤ [@balancer-labs/v2-pool-weighted]:             ✓ grants BPT for exact tokens (407ms)
➤ [@balancer-labs/v2-pool-weighted]:             ✓ can tell how much BPT it will give in return
➤ [@balancer-labs/v2-pool-weighted]:             ✓ fails if not enough BPT
➤ [@balancer-labs/v2-pool-weighted]:             ✓ reverts if paused (390ms)
➤ [@balancer-labs/v2-pool-weighted]:         join token in for exact BPT out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if not initialized
➤ [@balancer-labs/v2-pool-weighted]:           once initialized
➤ [@balancer-labs/v2-pool-weighted]:             ✓ grants exact BPT for token in (251ms)
➤ [@balancer-labs/v2-pool-weighted]:             ✓ can tell how many token amounts it will have to receive
➤ [@balancer-labs/v2-pool-weighted]:             ✓ fails if invariant increases more than max allowed
➤ [@balancer-labs/v2-pool-weighted]:             ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:       onExitPool
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if caller is not the vault
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if no user data
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if wrong user data
➤ [@balancer-labs/v2-pool-weighted]:         exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ grants one token for exact bpt
➤ [@balancer-labs/v2-pool-weighted]:           ✓ can tell how many tokens it will give in return
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if invariant decreases more than max allowed
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:         exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ grants all tokens for exact bpt
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fully exit
➤ [@balancer-labs/v2-pool-weighted]:           ✓ can tell how many token amounts it will give in return
➤ [@balancer-labs/v2-pool-weighted]:           ✓ does not revert if paused (366ms)
➤ [@balancer-labs/v2-pool-weighted]:         exit BPT in for exact tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ grants exact tokens for bpt
➤ [@balancer-labs/v2-pool-weighted]:           ✓ can tell how much BPT it will have to receive
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if more BTP needed
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:       onSwap
➤ [@balancer-labs/v2-pool-weighted]:         given in
➤ [@balancer-labs/v2-pool-weighted]:           ✓ calculates amount out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ calculates max amount out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in exceeds max in ratio
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in is not in the pool
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token out is not in the pool
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:         given out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ calculates amount in
➤ [@balancer-labs/v2-pool-weighted]:           ✓ calculates max amount in
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in exceeds max out ratio
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in is not in the pool when given out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token out is not in the pool
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused (297ms)
➤ [@balancer-labs/v2-pool-weighted]:       protocol swap fees
➤ [@balancer-labs/v2-pool-weighted]:         without balance changes
➤ [@balancer-labs/v2-pool-weighted]:           ✓ joins and exits do not accumulate fees (1101ms)
➤ [@balancer-labs/v2-pool-weighted]:         with previous swap
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ does not charges fee on exit if paused
➤ [@balancer-labs/v2-pool-weighted]:         with swap and exceeded min invariant ratio
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ [@balancer-labs/v2-pool-weighted]:     for a 3 token pool
➤ [@balancer-labs/v2-pool-weighted]:       creation
➤ [@balancer-labs/v2-pool-weighted]:         when the creation succeeds
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the vault
➤ [@balancer-labs/v2-pool-weighted]:           ✓ uses the corresponding specialization
➤ [@balancer-labs/v2-pool-weighted]:           ✓ registers tokens in the vault
➤ [@balancer-labs/v2-pool-weighted]:           ✓ starts with no BPT
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the asset managers
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets swap fee
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the name
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the symbol
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the decimals
➤ [@balancer-labs/v2-pool-weighted]:         when the creation fails
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if the number of tokens and weights do not match (568ms)
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if there are repeated tokens (852ms)
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if the swap fee is too high (524ms)
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if at least one weight is too low (539ms)
➤ [@balancer-labs/v2-pool-weighted]:       onJoinPool
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if caller is not the vault
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if no user data
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if wrong user data
➤ [@balancer-labs/v2-pool-weighted]:         initialization
➤ [@balancer-labs/v2-pool-weighted]:           ✓ grants the n * invariant amount of BPT
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if already initialized
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:         join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if not initialized
➤ [@balancer-labs/v2-pool-weighted]:           once initialized
➤ [@balancer-labs/v2-pool-weighted]:             ✓ grants BPT for exact tokens
➤ [@balancer-labs/v2-pool-weighted]:             ✓ can tell how much BPT it will give in return
➤ [@balancer-labs/v2-pool-weighted]:             ✓ fails if not enough BPT
➤ [@balancer-labs/v2-pool-weighted]:             ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:         join token in for exact BPT out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if not initialized
➤ [@balancer-labs/v2-pool-weighted]:           once initialized
➤ [@balancer-labs/v2-pool-weighted]:             ✓ grants exact BPT for token in
➤ [@balancer-labs/v2-pool-weighted]:             ✓ can tell how many token amounts it will have to receive
➤ [@balancer-labs/v2-pool-weighted]:             ✓ fails if invariant increases more than max allowed
➤ [@balancer-labs/v2-pool-weighted]:             ✓ reverts if paused (264ms)
➤ [@balancer-labs/v2-pool-weighted]:       onExitPool
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if caller is not the vault
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if no user data
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if wrong user data
➤ [@balancer-labs/v2-pool-weighted]:         exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ grants one token for exact bpt
➤ [@balancer-labs/v2-pool-weighted]:           ✓ can tell how many tokens it will give in return
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if invariant decreases more than max allowed
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:         exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ grants all tokens for exact bpt
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fully exit
➤ [@balancer-labs/v2-pool-weighted]:           ✓ can tell how many token amounts it will give in return
➤ [@balancer-labs/v2-pool-weighted]:           ✓ does not revert if paused (269ms)
➤ [@balancer-labs/v2-pool-weighted]:         exit BPT in for exact tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ grants exact tokens for bpt
➤ [@balancer-labs/v2-pool-weighted]:           ✓ can tell how much BPT it will have to receive
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if more BTP needed
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:       onSwap
➤ [@balancer-labs/v2-pool-weighted]:         given in
➤ [@balancer-labs/v2-pool-weighted]:           ✓ calculates amount out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ calculates max amount out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in exceeds max in ratio
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in is not in the pool
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token out is not in the pool
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:         given out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ calculates amount in
➤ [@balancer-labs/v2-pool-weighted]:           ✓ calculates max amount in
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in exceeds max out ratio
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in is not in the pool when given out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token out is not in the pool
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:       protocol swap fees
➤ [@balancer-labs/v2-pool-weighted]:         without balance changes
➤ [@balancer-labs/v2-pool-weighted]:           ✓ joins and exits do not accumulate fees (674ms)
➤ [@balancer-labs/v2-pool-weighted]:         with previous swap
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ does not charges fee on exit if paused
➤ [@balancer-labs/v2-pool-weighted]:         with swap and exceeded min invariant ratio
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ [@balancer-labs/v2-pool-weighted]:     for a too-many token pool
➤ [@balancer-labs/v2-pool-weighted]:       ✓ reverts if there are too many tokens (1648ms)
➤ [@balancer-labs/v2-pool-weighted]: 
➤ [@balancer-labs/v2-pool-weighted]:   LiquidityBootstrappingPool
➤ [@balancer-labs/v2-pool-weighted]:     with invalid creation parameters
➤ [@balancer-labs/v2-pool-weighted]:       ✓ fails with < 2 tokens (418ms)
➤ [@balancer-labs/v2-pool-weighted]:       ✓ fails with > 4 tokens (474ms)
➤ [@balancer-labs/v2-pool-weighted]:       ✓ fails with mismatched tokens/weights (431ms)
➤ [@balancer-labs/v2-pool-weighted]:     when deployed from factory
➤ [@balancer-labs/v2-pool-weighted]:       ✓ has no asset managers
➤ [@balancer-labs/v2-pool-weighted]:     with valid creation parameters
➤ [@balancer-labs/v2-pool-weighted]:       when initialized with swaps disabled
➤ [@balancer-labs/v2-pool-weighted]:         ✓ swaps show disabled on start
➤ [@balancer-labs/v2-pool-weighted]:         ✓ swaps are blocked
➤ [@balancer-labs/v2-pool-weighted]:       when initialized with swaps enabled
➤ [@balancer-labs/v2-pool-weighted]:         ✓ swaps show enabled on start
➤ [@balancer-labs/v2-pool-weighted]:         ✓ swaps are not blocked
➤ [@balancer-labs/v2-pool-weighted]:         ✓ sets token weights
➤ [@balancer-labs/v2-pool-weighted]:         ✓ stores the initial weights as a zero duration weight change
➤ [@balancer-labs/v2-pool-weighted]:         permissioned actions
➤ [@balancer-labs/v2-pool-weighted]:           when the sender is the owner
➤ [@balancer-labs/v2-pool-weighted]:             ✓ swaps can be enabled and disabled
➤ [@balancer-labs/v2-pool-weighted]:             ✓ disabling swaps emits an event
➤ [@balancer-labs/v2-pool-weighted]:             ✓ enabling swaps emits an event
➤ [@balancer-labs/v2-pool-weighted]:             ✓ owner can join and receive BPT, then exit (451ms)
➤ [@balancer-labs/v2-pool-weighted]:             update weights gradually
➤ [@balancer-labs/v2-pool-weighted]:               with invalid parameters
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ fails if end weights are mismatched (too few)
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ fails if the end weights are mismatched (too many)
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ fails if start time > end time
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ fails with an end weight below the minimum
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ fails with invalid normalized end weights
➤ [@balancer-labs/v2-pool-weighted]:                 with start time in the past
➤ [@balancer-labs/v2-pool-weighted]:                   ✓ fast-forwards start time to present
➤ [@balancer-labs/v2-pool-weighted]:               with valid parameters (ongoing weight update)
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ updating weights emits an event
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ stores the params
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets start weights if called before the start time
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets end weights if called after the end time
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 5% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 10% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 15% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 20% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 25% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 30% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 35% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 40% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 45% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 50% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 55% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 60% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 65% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 70% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 75% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 80% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 85% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 90% through
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ gets correct intermediate weights if called 95% through
➤ [@balancer-labs/v2-pool-weighted]:           when the sender is not the owner
➤ [@balancer-labs/v2-pool-weighted]:             ✓ non-owner cannot initialize the pool
➤ [@balancer-labs/v2-pool-weighted]:             ✓ non-owners cannot join the pool
➤ [@balancer-labs/v2-pool-weighted]:             ✓ non-owners cannot update weights
➤ [@balancer-labs/v2-pool-weighted]: 
➤ [@balancer-labs/v2-pool-weighted]:   LiquidityBootstrappingPoolFactory
➤ [@balancer-labs/v2-pool-weighted]:     temporarily pausable
➤ [@balancer-labs/v2-pool-weighted]:       ✓ pools have the correct window end times (367ms)
➤ [@balancer-labs/v2-pool-weighted]:       ✓ multiple pools have the same window end times (650ms)
➤ [@balancer-labs/v2-pool-weighted]:       ✓ pools created after the pause window end date have no buffer period (340ms)
➤ [@balancer-labs/v2-pool-weighted]:       ✓ does not have asset managers (436ms)
➤ [@balancer-labs/v2-pool-weighted]:       ✓ creates it with swaps enabled (289ms)
➤ [@balancer-labs/v2-pool-weighted]:       ✓ creates it with swaps disabled
➤ [@balancer-labs/v2-pool-weighted]: 
➤ [@balancer-labs/v2-pool-weighted]:   WeightedMath
➤ [@balancer-labs/v2-pool-weighted]:     invariant
➤ [@balancer-labs/v2-pool-weighted]:       zero invariant
➤ [@balancer-labs/v2-pool-weighted]:         ✓ reverts
➤ [@balancer-labs/v2-pool-weighted]:       two tokens
➤ [@balancer-labs/v2-pool-weighted]:         ✓ returns invariant
➤ [@balancer-labs/v2-pool-weighted]:       three tokens
➤ [@balancer-labs/v2-pool-weighted]:         ✓ returns invariant
➤ [@balancer-labs/v2-pool-weighted]:     Simple swap
➤ [@balancer-labs/v2-pool-weighted]:       ✓ outGivenIn
➤ [@balancer-labs/v2-pool-weighted]:       ✓ inGivenOut
➤ [@balancer-labs/v2-pool-weighted]:     Extreme amounts
➤ [@balancer-labs/v2-pool-weighted]:       ✓ outGivenIn - min amount in
➤ [@balancer-labs/v2-pool-weighted]:       ✓ inGivenOut - min amount out
➤ [@balancer-labs/v2-pool-weighted]:     Extreme weights
➤ [@balancer-labs/v2-pool-weighted]:       ✓ outGivenIn - max weights relation
➤ [@balancer-labs/v2-pool-weighted]:       ✓ outGivenIn - min weights relation
➤ [@balancer-labs/v2-pool-weighted]:     protocol swap fees
➤ [@balancer-labs/v2-pool-weighted]:       two tokens
➤ [@balancer-labs/v2-pool-weighted]:         ✓ returns protocol swap fees
➤ [@balancer-labs/v2-pool-weighted]:         with large accumulated fees
➤ [@balancer-labs/v2-pool-weighted]:           ✓ caps the invariant growth
➤ [@balancer-labs/v2-pool-weighted]:       three tokens
➤ [@balancer-labs/v2-pool-weighted]:         ✓ returns protocol swap fees
➤ [@balancer-labs/v2-pool-weighted]: 
➤ [@balancer-labs/v2-pool-weighted]:   WeighteOracledMath
➤ [@balancer-labs/v2-pool-weighted]:     spot price
➤ [@balancer-labs/v2-pool-weighted]:       with equal weights
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 18 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1910ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 19 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1748ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 20 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1705ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 21 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1847ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 22 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1633ms)
➤ [@balancer-labs/v2-pool-weighted]:       with different weights
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 18 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1768ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 19 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1614ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 20 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1411ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 21 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1494ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 22 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1863ms)
➤ [@balancer-labs/v2-pool-weighted]:       with extreme weights
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 18 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1344ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 19 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1316ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 20 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1419ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 21 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1443ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 22 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1445ms)
➤ [@balancer-labs/v2-pool-weighted]:       with partial weights
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 18 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1235ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 19 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1304ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 20 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1300ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 21 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1425ms)
➤ [@balancer-labs/v2-pool-weighted]:         with balances powers of 22 and 20
➤ [@balancer-labs/v2-pool-weighted]:           ✓ computes log spot price with bounded relative error (1145ms)
➤ [@balancer-labs/v2-pool-weighted]:     BPT price
➤ [@balancer-labs/v2-pool-weighted]:       with low BPT supply
➤ [@balancer-labs/v2-pool-weighted]:         with low weight
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (271ms)
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:         with medium weight
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:         with large weight
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (302ms)
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:       with medium BPT supply
➤ [@balancer-labs/v2-pool-weighted]:         with low weight
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (251ms)
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:         with medium weight
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:         with large weight
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (289ms)
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:       with large BPT supply
➤ [@balancer-labs/v2-pool-weighted]:         with low weight
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (288ms)
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:         with medium weight
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (627ms)
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (437ms)
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:         with large weight
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 18
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 19
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 20
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 21
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error
➤ [@balancer-labs/v2-pool-weighted]:           with balances powers of 22
➤ [@balancer-labs/v2-pool-weighted]:             ✓ computes BPT price with bounded relative error (293ms)
➤ [@balancer-labs/v2-pool-weighted]: 
➤ [@balancer-labs/v2-pool-weighted]:   WeightedPool
➤ [@balancer-labs/v2-pool-weighted]:     with 2 tokens
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ [@balancer-labs/v2-pool-weighted]:     with 3 tokens
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ [@balancer-labs/v2-pool-weighted]:     with 4 tokens
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ [@balancer-labs/v2-pool-weighted]:     with 5 tokens
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ [@balancer-labs/v2-pool-weighted]:     with 6 tokens
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ [@balancer-labs/v2-pool-weighted]:     with 7 tokens
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ [@balancer-labs/v2-pool-weighted]:     with 8 tokens
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ [@balancer-labs/v2-pool-weighted]: 
➤ [@balancer-labs/v2-pool-weighted]:   WeightedPool2Tokens
➤ [@balancer-labs/v2-pool-weighted]:     as a 2 token weighted pool
➤ [@balancer-labs/v2-pool-weighted]:       creation
➤ [@balancer-labs/v2-pool-weighted]:         when the creation succeeds
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the vault
➤ [@balancer-labs/v2-pool-weighted]:           ✓ uses the corresponding specialization
➤ [@balancer-labs/v2-pool-weighted]:           ✓ registers tokens in the vault
➤ [@balancer-labs/v2-pool-weighted]:           ✓ starts with no BPT
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the asset managers
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets swap fee
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the name
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the symbol
➤ [@balancer-labs/v2-pool-weighted]:           ✓ sets the decimals
➤ [@balancer-labs/v2-pool-weighted]:         when the creation fails
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if there are repeated tokens (739ms)
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if the swap fee is too high (355ms)
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if at least one weight is too low (409ms)
➤ [@balancer-labs/v2-pool-weighted]:       onJoinPool
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if caller is not the vault
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if no user data
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if wrong user data
➤ [@balancer-labs/v2-pool-weighted]:         initialization
➤ [@balancer-labs/v2-pool-weighted]:           ✓ grants the n * invariant amount of BPT
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if already initialized
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:         join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if not initialized
➤ [@balancer-labs/v2-pool-weighted]:           once initialized
➤ [@balancer-labs/v2-pool-weighted]:             ✓ grants BPT for exact tokens
➤ [@balancer-labs/v2-pool-weighted]:             ✓ can tell how much BPT it will give in return (270ms)
➤ [@balancer-labs/v2-pool-weighted]:             ✓ fails if not enough BPT
➤ [@balancer-labs/v2-pool-weighted]:             ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:         join token in for exact BPT out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if not initialized
➤ [@balancer-labs/v2-pool-weighted]:           once initialized
➤ [@balancer-labs/v2-pool-weighted]:             ✓ grants exact BPT for token in
➤ [@balancer-labs/v2-pool-weighted]:             ✓ can tell how many token amounts it will have to receive
➤ [@balancer-labs/v2-pool-weighted]:             ✓ fails if invariant increases more than max allowed
➤ [@balancer-labs/v2-pool-weighted]:             ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:       onExitPool
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if caller is not the vault
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if no user data
➤ [@balancer-labs/v2-pool-weighted]:         ✓ fails if wrong user data
➤ [@balancer-labs/v2-pool-weighted]:         exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ grants one token for exact bpt
➤ [@balancer-labs/v2-pool-weighted]:           ✓ can tell how many tokens it will give in return
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if invariant decreases more than max allowed
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:         exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ grants all tokens for exact bpt
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fully exit
➤ [@balancer-labs/v2-pool-weighted]:           ✓ can tell how many token amounts it will give in return
➤ [@balancer-labs/v2-pool-weighted]:           ✓ does not revert if paused
➤ [@balancer-labs/v2-pool-weighted]:         exit BPT in for exact tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ grants exact tokens for bpt
➤ [@balancer-labs/v2-pool-weighted]:           ✓ can tell how much BPT it will have to receive
➤ [@balancer-labs/v2-pool-weighted]:           ✓ fails if more BTP needed
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:       onSwap
➤ [@balancer-labs/v2-pool-weighted]:         given in
➤ [@balancer-labs/v2-pool-weighted]:           ✓ calculates amount out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ calculates max amount out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in exceeds max in ratio
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:         given out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ calculates amount in
➤ [@balancer-labs/v2-pool-weighted]:           ✓ calculates max amount in
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if token in exceeds max out ratio
➤ [@balancer-labs/v2-pool-weighted]:           ✓ reverts if paused
➤ [@balancer-labs/v2-pool-weighted]:       protocol swap fees
➤ [@balancer-labs/v2-pool-weighted]:         without balance changes
➤ [@balancer-labs/v2-pool-weighted]:           ✓ joins and exits do not accumulate fees (751ms)
➤ [@balancer-labs/v2-pool-weighted]:         with previous swap
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ does not charges fee on exit if paused
➤ [@balancer-labs/v2-pool-weighted]:         with swap and exceeded min invariant ratio
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on join exact tokens in for BPT out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for one token out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit exact BPT in for all tokens out
➤ [@balancer-labs/v2-pool-weighted]:           ✓ pays swap protocol fees on exit BPT In for exact tokens out
➤ [@balancer-labs/v2-pool-weighted]:     weights
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets token weights
➤ [@balancer-labs/v2-pool-weighted]:     oracle
➤ [@balancer-labs/v2-pool-weighted]:       initialize
➤ [@balancer-labs/v2-pool-weighted]:         when the oracle is enabled
➤ [@balancer-labs/v2-pool-weighted]:           ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:           ✓ caches the log of the last invariant
➤ [@balancer-labs/v2-pool-weighted]:           ✓ caches the total supply
➤ [@balancer-labs/v2-pool-weighted]:         when the oracle is disabled
➤ [@balancer-labs/v2-pool-weighted]:           ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:           ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:       join
➤ [@balancer-labs/v2-pool-weighted]:         when the latest change block is an old block
➤ [@balancer-labs/v2-pool-weighted]:           when the oracle is enabled
➤ [@balancer-labs/v2-pool-weighted]:             ✓ caches the log of the last invariant
➤ [@balancer-labs/v2-pool-weighted]:             ✓ caches the total supply (283ms)
➤ [@balancer-labs/v2-pool-weighted]:             without updated oracle
➤ [@balancer-labs/v2-pool-weighted]:               ✓ updates the oracle data
➤ [@balancer-labs/v2-pool-weighted]:             with updated oracle
➤ [@balancer-labs/v2-pool-weighted]:               ✓ stores the pre-action spot price
➤ [@balancer-labs/v2-pool-weighted]:               ✓ stores the pre-action BPT price
➤ [@balancer-labs/v2-pool-weighted]:               ✓ stores the pre-action invariant
➤ [@balancer-labs/v2-pool-weighted]:           when the oracle is disabled
➤ [@balancer-labs/v2-pool-weighted]:             ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:             ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:         when the latest change block is the current block
➤ [@balancer-labs/v2-pool-weighted]:           when the oracle is enabled
➤ [@balancer-labs/v2-pool-weighted]:             ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:             ✓ caches the log of the last invariant
➤ [@balancer-labs/v2-pool-weighted]:             ✓ caches the total supply
➤ [@balancer-labs/v2-pool-weighted]:           when the oracle is disabled
➤ [@balancer-labs/v2-pool-weighted]:             ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:             ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:       exit
➤ [@balancer-labs/v2-pool-weighted]:         when the pool is paused
➤ [@balancer-labs/v2-pool-weighted]:           when the latest change block is an old block
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply (292ms)
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:           when the latest change block is the current block
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:         when the pool is not paused
➤ [@balancer-labs/v2-pool-weighted]:           when the latest change block is an old block
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ caches the log of the last invariant
➤ [@balancer-labs/v2-pool-weighted]:               ✓ caches the total supply
➤ [@balancer-labs/v2-pool-weighted]:               without updated oracle
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ updates the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               with updated oracle
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action spot price
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action BPT price
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action invariant
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:           when the latest change block is the current block
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               ✓ caches the log of the last invariant
➤ [@balancer-labs/v2-pool-weighted]:               ✓ caches the total supply
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:       swaps
➤ [@balancer-labs/v2-pool-weighted]:         given in
➤ [@balancer-labs/v2-pool-weighted]:           when the latest change block is an old block
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:               without updated oracle
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ updates the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               with updated oracle
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action spot price
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action BPT price
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action invariant
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:           when the latest change block is the current block
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:         given out
➤ [@balancer-labs/v2-pool-weighted]:           when the latest change block is an old block
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:               without updated oracle
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ updates the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               with updated oracle
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action spot price
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action BPT price
➤ [@balancer-labs/v2-pool-weighted]:                 ✓ stores the pre-action invariant
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:           when the latest change block is the current block
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is enabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:             when the oracle is disabled
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not update the oracle data
➤ [@balancer-labs/v2-pool-weighted]:               ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:       setting
➤ [@balancer-labs/v2-pool-weighted]:         when it starts enabled
➤ [@balancer-labs/v2-pool-weighted]:           ✓ is enabled
➤ [@balancer-labs/v2-pool-weighted]:           ✓ does not fail when trying to enable again
➤ [@balancer-labs/v2-pool-weighted]:           ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:         when it starts disabled
➤ [@balancer-labs/v2-pool-weighted]:           when the pool was not initialized
➤ [@balancer-labs/v2-pool-weighted]:             ✓ does not cache the log invariant and supply
➤ [@balancer-labs/v2-pool-weighted]:           when the pool was initialized
➤ [@balancer-labs/v2-pool-weighted]:             ✓ is disabled and can be enabled
➤ [@balancer-labs/v2-pool-weighted]:             ✓ can only be updated by the admin
➤ [@balancer-labs/v2-pool-weighted]:             ✓ caches the log of the last invariant
➤ [@balancer-labs/v2-pool-weighted]:             ✓ caches the total supply
➤ [@balancer-labs/v2-pool-weighted]:     queries
➤ [@balancer-labs/v2-pool-weighted]:       with positive values
➤ [@balancer-labs/v2-pool-weighted]:         getLatest
➤ [@balancer-labs/v2-pool-weighted]:           ✓ returns the latest pair price
➤ [@balancer-labs/v2-pool-weighted]:           ✓ returns the latest BPT price
➤ [@balancer-labs/v2-pool-weighted]:           ✓ returns the latest pair price
➤ [@balancer-labs/v2-pool-weighted]:         getPastAccumulators
➤ [@balancer-labs/v2-pool-weighted]:           ✓ returns the expected values
➤ [@balancer-labs/v2-pool-weighted]:         getTimeWeightedAverage
➤ [@balancer-labs/v2-pool-weighted]:           ✓ returns the expected values
➤ [@balancer-labs/v2-pool-weighted]:       with negative values
➤ [@balancer-labs/v2-pool-weighted]:         getLatest
➤ [@balancer-labs/v2-pool-weighted]:           ✓ returns the latest pair price
➤ [@balancer-labs/v2-pool-weighted]:           ✓ returns the latest BPT price
➤ [@balancer-labs/v2-pool-weighted]:           ✓ returns the latest pair price
➤ [@balancer-labs/v2-pool-weighted]:         getPastAccumulators
➤ [@balancer-labs/v2-pool-weighted]:           ✓ returns the expected values
➤ [@balancer-labs/v2-pool-weighted]:         getTimeWeightedAverage
➤ [@balancer-labs/v2-pool-weighted]:           ✓ returns the expected values
➤ [@balancer-labs/v2-pool-weighted]:     misc data
➤ [@balancer-labs/v2-pool-weighted]:       ✓ packs samples correctly (595ms)
➤ [@balancer-labs/v2-pool-weighted]: 
➤ [@balancer-labs/v2-pool-weighted]:   WeightedPoolFactory
➤ [@balancer-labs/v2-pool-weighted]:     constructor arguments
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets the vault
➤ [@balancer-labs/v2-pool-weighted]:       ✓ registers tokens in the vault
➤ [@balancer-labs/v2-pool-weighted]:       ✓ starts with no BPT
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets the asset managers
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets swap fee
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets the owner 
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets the name
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets the symbol
➤ [@balancer-labs/v2-pool-weighted]:       ✓ sets the decimals
➤ [@balancer-labs/v2-pool-weighted]:     temporarily pausable
➤ [@balancer-labs/v2-pool-weighted]:       ✓ pools have the correct window end times (273ms)
➤ [@balancer-labs/v2-pool-weighted]:       ✓ multiple pools have the same window end times (442ms)
➤ [@balancer-labs/v2-pool-weighted]:       ✓ pools created after the pause window end date have no buffer period
➤ [@balancer-labs/v2-pool-weighted]: 
➤ [@balancer-labs/v2-pool-weighted]: 
➤ [@balancer-labs/v2-pool-weighted]:   424 passing (2m)
➤ [@balancer-labs/v2-pool-weighted]: 
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   Asset Management
➤ [@balancer-labs/v2-vault]:     with general pool
➤ [@balancer-labs/v2-vault]:       with unregistered pool
➤ [@balancer-labs/v2-vault]:         withdraw
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]:         deposit
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]:         update
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]:       with registered pool
➤ [@balancer-labs/v2-vault]:         with unregistered token
➤ [@balancer-labs/v2-vault]:           withdraw
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:           deposit
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:           update
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         with registered token
➤ [@balancer-labs/v2-vault]:           setting
➤ [@balancer-labs/v2-vault]:             ✓ different managers can be set for different tokens
➤ [@balancer-labs/v2-vault]:             ✓ removes asset managers when deregistering (799ms)
➤ [@balancer-labs/v2-vault]:             ✓ reverts when querying the asset manager of an unknown pool
➤ [@balancer-labs/v2-vault]:             ✓ reverts when querying the asset manager of an unregistered token
➤ [@balancer-labs/v2-vault]:           withdraw
➤ [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ [@balancer-labs/v2-vault]:               when unpaused
➤ [@balancer-labs/v2-vault]:                 when withdrawing zero
➤ [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 when withdrawing less than the pool balance
➤ [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager (254ms)
➤ [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 when withdrawing all the pool balance
➤ [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 when withdrawing more than the pool balance
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:               when paused
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           deposit
➤ [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ [@balancer-labs/v2-vault]:               with managed amount
➤ [@balancer-labs/v2-vault]:                 when unpaused
➤ [@balancer-labs/v2-vault]:                   when depositing zero
➤ [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   when depositing less than the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   when depositing all the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   when depositing more than the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ reverts
➤ [@balancer-labs/v2-vault]:                 when paused
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           update
➤ [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ [@balancer-labs/v2-vault]:               with managed amount
➤ [@balancer-labs/v2-vault]:                 when unpaused
➤ [@balancer-labs/v2-vault]:                   with gains
➤ [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block of the updated token only
➤ [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   with losses
➤ [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block of the updated token only
➤ [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   with no change
➤ [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block of the updated token only
➤ [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 when paused
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           batch
➤ [@balancer-labs/v2-vault]:             with single pool
➤ [@balancer-labs/v2-vault]:               with the same managed token
➤ [@balancer-labs/v2-vault]:                 ✓ succeeds (257ms)
➤ [@balancer-labs/v2-vault]:               with managed and unmanaged tokens
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:               with managed and unregistered tokens
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:             with multiple pools
➤ [@balancer-labs/v2-vault]:               with the same managed token
➤ [@balancer-labs/v2-vault]:                 ✓ succeeds (388ms)
➤ [@balancer-labs/v2-vault]:               with multiple managed tokens
➤ [@balancer-labs/v2-vault]:                 ✓ succeeds (376ms)
➤ [@balancer-labs/v2-vault]:               with managed and unmanaged tokens
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:               with registered and unregistered pools
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:     with minimal swap info pool
➤ [@balancer-labs/v2-vault]:       with unregistered pool
➤ [@balancer-labs/v2-vault]:         withdraw
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]:         deposit
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]:         update
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]:       with registered pool
➤ [@balancer-labs/v2-vault]:         with unregistered token
➤ [@balancer-labs/v2-vault]:           withdraw
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:           deposit
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:           update
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         with registered token
➤ [@balancer-labs/v2-vault]:           setting
➤ [@balancer-labs/v2-vault]:             ✓ different managers can be set for different tokens
➤ [@balancer-labs/v2-vault]:             ✓ removes asset managers when deregistering (612ms)
➤ [@balancer-labs/v2-vault]:             ✓ reverts when querying the asset manager of an unknown pool
➤ [@balancer-labs/v2-vault]:             ✓ reverts when querying the asset manager of an unregistered token
➤ [@balancer-labs/v2-vault]:           withdraw
➤ [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ [@balancer-labs/v2-vault]:               when unpaused
➤ [@balancer-labs/v2-vault]:                 when withdrawing zero
➤ [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 when withdrawing less than the pool balance
➤ [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 when withdrawing all the pool balance
➤ [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                   ✓ does not update the last change block (293ms)
➤ [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 when withdrawing more than the pool balance
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:               when paused
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           deposit
➤ [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ [@balancer-labs/v2-vault]:               with managed amount
➤ [@balancer-labs/v2-vault]:                 when unpaused
➤ [@balancer-labs/v2-vault]:                   when depositing zero
➤ [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   when depositing less than the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   when depositing all the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   when depositing more than the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ reverts
➤ [@balancer-labs/v2-vault]:                 when paused
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           update
➤ [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ [@balancer-labs/v2-vault]:               with managed amount
➤ [@balancer-labs/v2-vault]:                 when unpaused
➤ [@balancer-labs/v2-vault]:                   with gains
➤ [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block of the updated token only (285ms)
➤ [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   with losses
➤ [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block of the updated token only
➤ [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   with no change
➤ [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens (282ms)
➤ [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block of the updated token only
➤ [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 when paused
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           batch
➤ [@balancer-labs/v2-vault]:             with single pool
➤ [@balancer-labs/v2-vault]:               with the same managed token
➤ [@balancer-labs/v2-vault]:                 ✓ succeeds (293ms)
➤ [@balancer-labs/v2-vault]:               with managed and unmanaged tokens
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:               with managed and unregistered tokens
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:             with multiple pools
➤ [@balancer-labs/v2-vault]:               with the same managed token
➤ [@balancer-labs/v2-vault]:                 ✓ succeeds (764ms)
➤ [@balancer-labs/v2-vault]:               with multiple managed tokens
➤ [@balancer-labs/v2-vault]:                 ✓ succeeds (527ms)
➤ [@balancer-labs/v2-vault]:               with managed and unmanaged tokens
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:               with registered and unregistered pools
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:     with two token pool
➤ [@balancer-labs/v2-vault]:       with unregistered pool
➤ [@balancer-labs/v2-vault]:         withdraw
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]:         deposit
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]:         update
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]:       with registered pool
➤ [@balancer-labs/v2-vault]:         with unregistered token
➤ [@balancer-labs/v2-vault]:           withdraw
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:           deposit
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:           update
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         with registered token
➤ [@balancer-labs/v2-vault]:           setting
➤ [@balancer-labs/v2-vault]:             ✓ different managers can be set for different tokens
➤ [@balancer-labs/v2-vault]:             ✓ removes asset managers when deregistering (373ms)
➤ [@balancer-labs/v2-vault]:             ✓ reverts when querying the asset manager of an unknown pool
➤ [@balancer-labs/v2-vault]:             ✓ reverts when querying the asset manager of an unregistered token
➤ [@balancer-labs/v2-vault]:           withdraw
➤ [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ [@balancer-labs/v2-vault]:               when unpaused
➤ [@balancer-labs/v2-vault]:                 when withdrawing zero
➤ [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 when withdrawing less than the pool balance
➤ [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 when withdrawing all the pool balance
➤ [@balancer-labs/v2-vault]:                   ✓ transfers the requested token from the vault to the manager
➤ [@balancer-labs/v2-vault]:                   ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                   ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                   ✓ moves the balance from cash to managed
➤ [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 when withdrawing more than the pool balance
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:               when paused
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           deposit
➤ [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ [@balancer-labs/v2-vault]:               with managed amount
➤ [@balancer-labs/v2-vault]:                 when unpaused
➤ [@balancer-labs/v2-vault]:                   when depositing zero
➤ [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   when depositing less than the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   when depositing all the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ transfers the requested token from the manager to the vault
➤ [@balancer-labs/v2-vault]:                     ✓ does not affect the balance of the pools
➤ [@balancer-labs/v2-vault]:                     ✓ does not update the last change block
➤ [@balancer-labs/v2-vault]:                     ✓ moves the balance from managed to cash
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   when depositing more than the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ reverts
➤ [@balancer-labs/v2-vault]:                 when paused
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           update
➤ [@balancer-labs/v2-vault]:             when the sender is the asset manager
➤ [@balancer-labs/v2-vault]:               with managed amount
➤ [@balancer-labs/v2-vault]:                 when unpaused
➤ [@balancer-labs/v2-vault]:                   with gains
➤ [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ [@balancer-labs/v2-vault]:                     ✓ updates both last change blocks when updating token A
➤ [@balancer-labs/v2-vault]:                     ✓ updates both last change blocks when updating token B
➤ [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   with losses
➤ [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ [@balancer-labs/v2-vault]:                     ✓ updates both last change blocks when updating token A
➤ [@balancer-labs/v2-vault]:                     ✓ updates both last change blocks when updating token B
➤ [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                   with no change
➤ [@balancer-labs/v2-vault]:                     ✓ does not transfer tokens
➤ [@balancer-labs/v2-vault]:                     ✓ updates the balance of the pool
➤ [@balancer-labs/v2-vault]:                     ✓ updates both last change blocks when updating token A
➤ [@balancer-labs/v2-vault]:                     ✓ updates both last change blocks when updating token B
➤ [@balancer-labs/v2-vault]:                     ✓ sets the managed balance
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 when paused
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the asset manager
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           batch
➤ [@balancer-labs/v2-vault]:             with single pool
➤ [@balancer-labs/v2-vault]:               with the same managed token
➤ [@balancer-labs/v2-vault]:                 ✓ succeeds
➤ [@balancer-labs/v2-vault]:               with managed and unmanaged tokens
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:               with managed and unregistered tokens
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:             with multiple pools
➤ [@balancer-labs/v2-vault]:               with the same managed token
➤ [@balancer-labs/v2-vault]:                 ✓ succeeds
➤ [@balancer-labs/v2-vault]:               with multiple managed tokens
➤ [@balancer-labs/v2-vault]:                 ✓ succeeds (325ms)
➤ [@balancer-labs/v2-vault]:               with managed and unmanaged tokens
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:               with registered and unregistered pools
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   AssetTransfersHandler
➤ [@balancer-labs/v2-vault]:     receiveAsset
➤ [@balancer-labs/v2-vault]:       when the asset is ETH
➤ [@balancer-labs/v2-vault]:         with some internal balance
➤ [@balancer-labs/v2-vault]:           when not receiving from internal balance
➤ [@balancer-labs/v2-vault]:             ✓ takes ETH from the caller
➤ [@balancer-labs/v2-vault]:             ✓ does not keep any ETH
➤ [@balancer-labs/v2-vault]:             ✓ wraps received ETH into WETH
➤ [@balancer-labs/v2-vault]:             ✓ does not return extra ETH to the caller
➤ [@balancer-labs/v2-vault]:             ✓ does not check if any ETH was supplied (356ms)
➤ [@balancer-labs/v2-vault]:             ✓ does take WETH from internal balance
➤ [@balancer-labs/v2-vault]:             ✓ reverts if not enough ETH was sent
➤ [@balancer-labs/v2-vault]:           when receiving from internal balance
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:       when the asset is a token
➤ [@balancer-labs/v2-vault]:         when the token is WETH
➤ [@balancer-labs/v2-vault]:           when receiving from internal balance
➤ [@balancer-labs/v2-vault]:             with no internal balance
➤ [@balancer-labs/v2-vault]:               ✓ deducts the expected amount from internal balance
➤ [@balancer-labs/v2-vault]:               ✓ transfers tokens not taken from internal balance from sender
➤ [@balancer-labs/v2-vault]:             with some internal balance
➤ [@balancer-labs/v2-vault]:               ✓ deducts the expected amount from internal balance
➤ [@balancer-labs/v2-vault]:               ✓ transfers tokens not taken from internal balance from sender
➤ [@balancer-labs/v2-vault]:             with enough internal balance
➤ [@balancer-labs/v2-vault]:               ✓ deducts the expected amount from internal balance
➤ [@balancer-labs/v2-vault]:               ✓ transfers tokens not taken from internal balance from sender
➤ [@balancer-labs/v2-vault]:           when not receiving from internal balance
➤ [@balancer-labs/v2-vault]:             with no internal balance
➤ [@balancer-labs/v2-vault]:               ✓ does not affect sender internal balance
➤ [@balancer-labs/v2-vault]:               ✓ transfers tokens from sender
➤ [@balancer-labs/v2-vault]:             with some internal balance
➤ [@balancer-labs/v2-vault]:               ✓ does not affect sender internal balance
➤ [@balancer-labs/v2-vault]:               ✓ transfers tokens from sender
➤ [@balancer-labs/v2-vault]:         when the token is not WETH
➤ [@balancer-labs/v2-vault]:           when receiving from internal balance
➤ [@balancer-labs/v2-vault]:             with no internal balance
➤ [@balancer-labs/v2-vault]:               ✓ deducts the expected amount from internal balance
➤ [@balancer-labs/v2-vault]:               ✓ transfers tokens not taken from internal balance from sender
➤ [@balancer-labs/v2-vault]:             with some internal balance
➤ [@balancer-labs/v2-vault]:               ✓ deducts the expected amount from internal balance
➤ [@balancer-labs/v2-vault]:               ✓ transfers tokens not taken from internal balance from sender
➤ [@balancer-labs/v2-vault]:             with enough internal balance
➤ [@balancer-labs/v2-vault]:               ✓ deducts the expected amount from internal balance
➤ [@balancer-labs/v2-vault]:               ✓ transfers tokens not taken from internal balance from sender
➤ [@balancer-labs/v2-vault]:           when not receiving from internal balance
➤ [@balancer-labs/v2-vault]:             with no internal balance
➤ [@balancer-labs/v2-vault]:               ✓ does not affect sender internal balance
➤ [@balancer-labs/v2-vault]:               ✓ transfers tokens from sender
➤ [@balancer-labs/v2-vault]:             with some internal balance
➤ [@balancer-labs/v2-vault]:               ✓ does not affect sender internal balance
➤ [@balancer-labs/v2-vault]:               ✓ transfers tokens from sender
➤ [@balancer-labs/v2-vault]:     sendAsset
➤ [@balancer-labs/v2-vault]:       when the asset is ETH
➤ [@balancer-labs/v2-vault]:         when not sending to internal balance
➤ [@balancer-labs/v2-vault]:           ✓ sends ETH to the recipient
➤ [@balancer-labs/v2-vault]:           ✓ does not affect the ETH balance
➤ [@balancer-labs/v2-vault]:           ✓ unwraps WETH into ETH
➤ [@balancer-labs/v2-vault]:           ✓ does not use internal balance
➤ [@balancer-labs/v2-vault]:         when sending to internal balance
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]:       when the asset is a token
➤ [@balancer-labs/v2-vault]:         when the token is WETH
➤ [@balancer-labs/v2-vault]:           when not sending to internal balance
➤ [@balancer-labs/v2-vault]:             ✓ sends tokens to the recipient
➤ [@balancer-labs/v2-vault]:             ✓ does not affect internal balance
➤ [@balancer-labs/v2-vault]:           when sending to internal balance
➤ [@balancer-labs/v2-vault]:             ✓ assigns tokens as internal balance
➤ [@balancer-labs/v2-vault]:             ✓ transfers no tokens
➤ [@balancer-labs/v2-vault]:         when the token is not WETH
➤ [@balancer-labs/v2-vault]:           when not sending to internal balance
➤ [@balancer-labs/v2-vault]:             ✓ sends tokens to the recipient
➤ [@balancer-labs/v2-vault]:             ✓ does not affect internal balance
➤ [@balancer-labs/v2-vault]:           when sending to internal balance
➤ [@balancer-labs/v2-vault]:             ✓ assigns tokens as internal balance
➤ [@balancer-labs/v2-vault]:             ✓ transfers no tokens
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   Authorizer
➤ [@balancer-labs/v2-vault]:     grantRoles
➤ [@balancer-labs/v2-vault]:       when the sender is the admin
➤ [@balancer-labs/v2-vault]:         ✓ grants a list of roles
➤ [@balancer-labs/v2-vault]:       when the sender is not the admin
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]:     grantRolesToMany
➤ [@balancer-labs/v2-vault]:       when the sender is the admin
➤ [@balancer-labs/v2-vault]:         ✓ grants a list of roles
➤ [@balancer-labs/v2-vault]:       when the sender is not the admin
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]:     revokeRoles
➤ [@balancer-labs/v2-vault]:       when the sender is the admin
➤ [@balancer-labs/v2-vault]:         when the roles where granted
➤ [@balancer-labs/v2-vault]:           ✓ revokes a list of roles
➤ [@balancer-labs/v2-vault]:         when one of the roles was not granted
➤ [@balancer-labs/v2-vault]:           ✓ ignores the request
➤ [@balancer-labs/v2-vault]:       when the sender is not the admin
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]:     revokeRolesFromMany
➤ [@balancer-labs/v2-vault]:       when the sender is the admin
➤ [@balancer-labs/v2-vault]:         when the roles where granted
➤ [@balancer-labs/v2-vault]:           ✓ revokes a list of roles
➤ [@balancer-labs/v2-vault]:         when one of the roles was not granted
➤ [@balancer-labs/v2-vault]:           ✓ ignores the request
➤ [@balancer-labs/v2-vault]:       when the sender is not the admin
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   Exit Pool
➤ [@balancer-labs/v2-vault]:     with general pool
➤ [@balancer-labs/v2-vault]:       with no registered tokens
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]:       with registered tokens
➤ [@balancer-labs/v2-vault]:         when called incorrectly
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the pool ID does not exist
➤ [@balancer-labs/v2-vault]:           ✓ reverts if a token is missing in the array
➤ [@balancer-labs/v2-vault]:           ✓ reverts if there is one extra token
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the tokens list is not sorted
➤ [@balancer-labs/v2-vault]:           ✓ reverts if token array is empty
➤ [@balancer-labs/v2-vault]:           ✓ reverts if tokens and amounts length do not match
➤ [@balancer-labs/v2-vault]:         when called correctly
➤ [@balancer-labs/v2-vault]:           with incorrect pool return values
➤ [@balancer-labs/v2-vault]:             ✓ reverts if exit amounts length does not match token length
➤ [@balancer-labs/v2-vault]:             ✓ reverts if due protocol fees length does not match token length
➤ [@balancer-labs/v2-vault]:             ✓ reverts if exit amounts and due protocol fees length do not match token length
➤ [@balancer-labs/v2-vault]:           with correct pool return values
➤ [@balancer-labs/v2-vault]:             with no due protocol fees
➤ [@balancer-labs/v2-vault]:               when the sender is the user
➤ [@balancer-labs/v2-vault]:                 not using internal balance
➤ [@balancer-labs/v2-vault]:                   without internal balance
➤ [@balancer-labs/v2-vault]:                     when unpaused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool (255ms)
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data (269ms)
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens (333ms)
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (382ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (452ms)
➤ [@balancer-labs/v2-vault]:                     when paused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (337ms)
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient (272ms)
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data (320ms)
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (378ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (527ms)
➤ [@balancer-labs/v2-vault]:                   with some internal balance
➤ [@balancer-labs/v2-vault]:                     when unpaused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (282ms)
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (417ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (369ms)
➤ [@balancer-labs/v2-vault]:                     when paused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (311ms)
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (332ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (296ms)
➤ [@balancer-labs/v2-vault]:                 using internal balance
➤ [@balancer-labs/v2-vault]:                   with no internal balance
➤ [@balancer-labs/v2-vault]:                     when unpaused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (312ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (334ms)
➤ [@balancer-labs/v2-vault]:                     when paused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (379ms)
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (343ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                   with some internal balance
➤ [@balancer-labs/v2-vault]:                     when unpaused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (264ms)
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (549ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (426ms)
➤ [@balancer-labs/v2-vault]:                     when paused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (488ms)
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (304ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:               when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                 when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                   when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                     not using internal balance
➤ [@balancer-labs/v2-vault]:                       without internal balance
➤ [@balancer-labs/v2-vault]:                         when unpaused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool (278ms)
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (366ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (495ms)
➤ [@balancer-labs/v2-vault]:                         when paused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient (252ms)
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (268ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (464ms)
➤ [@balancer-labs/v2-vault]:                       with some internal balance
➤ [@balancer-labs/v2-vault]:                         when unpaused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (397ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (398ms)
➤ [@balancer-labs/v2-vault]:                         when paused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient (279ms)
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (637ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (409ms)
➤ [@balancer-labs/v2-vault]:                     using internal balance
➤ [@balancer-labs/v2-vault]:                       with no internal balance
➤ [@balancer-labs/v2-vault]:                         when unpaused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (371ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (325ms)
➤ [@balancer-labs/v2-vault]:                         when paused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient (256ms)
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (514ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (393ms)
➤ [@balancer-labs/v2-vault]:                       with some internal balance
➤ [@balancer-labs/v2-vault]:                         when unpaused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees (263ms)
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                         when paused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault (281ms)
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (355ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (309ms)
➤ [@balancer-labs/v2-vault]:                   when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                     when the relayer is not eternally-allowed by the user
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                     when the relayer is allowed by signature
➤ [@balancer-labs/v2-vault]:                       not using internal balance
➤ [@balancer-labs/v2-vault]:                         without internal balance
➤ [@balancer-labs/v2-vault]:                           when unpaused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (256ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (325ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (525ms)
➤ [@balancer-labs/v2-vault]:                           when paused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data (297ms)
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (455ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (321ms)
➤ [@balancer-labs/v2-vault]:                         with some internal balance
➤ [@balancer-labs/v2-vault]:                           when unpaused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (325ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient (273ms)
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault (260ms)
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (337ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (468ms)
➤ [@balancer-labs/v2-vault]:                           when paused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (310ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (930ms)
➤ [@balancer-labs/v2-vault]:                       using internal balance
➤ [@balancer-labs/v2-vault]:                         with no internal balance
➤ [@balancer-labs/v2-vault]:                           when unpaused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool (279ms)
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (356ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (369ms)
➤ [@balancer-labs/v2-vault]:                           when paused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (262ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (352ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (585ms)
➤ [@balancer-labs/v2-vault]:                         with some internal balance
➤ [@balancer-labs/v2-vault]:                           when unpaused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (320ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (391ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (324ms)
➤ [@balancer-labs/v2-vault]:                           when paused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (457ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (507ms)
➤ [@balancer-labs/v2-vault]:                 when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                   when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                     ✓ reverts
➤ [@balancer-labs/v2-vault]:                   when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                     ✓ reverts
➤ [@balancer-labs/v2-vault]:             with due protocol fees
➤ [@balancer-labs/v2-vault]:               not using internal balance
➤ [@balancer-labs/v2-vault]:                 without internal balance
➤ [@balancer-labs/v2-vault]:                   when unpaused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (298ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully (320ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (444ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (294ms)
➤ [@balancer-labs/v2-vault]:                   when paused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (338ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data (343ms)
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (484ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (410ms)
➤ [@balancer-labs/v2-vault]:                 with some internal balance
➤ [@balancer-labs/v2-vault]:                   when unpaused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (263ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (314ms)
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (443ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (477ms)
➤ [@balancer-labs/v2-vault]:                   when paused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (275ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (399ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (327ms)
➤ [@balancer-labs/v2-vault]:               using internal balance
➤ [@balancer-labs/v2-vault]:                 with no internal balance
➤ [@balancer-labs/v2-vault]:                   when unpaused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (274ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool (331ms)
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (430ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (399ms)
➤ [@balancer-labs/v2-vault]:                   when paused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (292ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data (278ms)
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (350ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (336ms)
➤ [@balancer-labs/v2-vault]:                 with some internal balance
➤ [@balancer-labs/v2-vault]:                   when unpaused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (341ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (513ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (323ms)
➤ [@balancer-labs/v2-vault]:                   when paused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (294ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully (374ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (470ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (518ms)
➤ [@balancer-labs/v2-vault]:     with minimal swap info pool
➤ [@balancer-labs/v2-vault]:       with no registered tokens
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]:       with registered tokens
➤ [@balancer-labs/v2-vault]:         when called incorrectly
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the pool ID does not exist
➤ [@balancer-labs/v2-vault]:           ✓ reverts if a token is missing in the array
➤ [@balancer-labs/v2-vault]:           ✓ reverts if there is one extra token
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the tokens list is not sorted
➤ [@balancer-labs/v2-vault]:           ✓ reverts if token array is empty
➤ [@balancer-labs/v2-vault]:           ✓ reverts if tokens and amounts length do not match
➤ [@balancer-labs/v2-vault]:         when called correctly
➤ [@balancer-labs/v2-vault]:           with incorrect pool return values
➤ [@balancer-labs/v2-vault]:             ✓ reverts if exit amounts length does not match token length
➤ [@balancer-labs/v2-vault]:             ✓ reverts if due protocol fees length does not match token length
➤ [@balancer-labs/v2-vault]:             ✓ reverts if exit amounts and due protocol fees length do not match token length
➤ [@balancer-labs/v2-vault]:           with correct pool return values
➤ [@balancer-labs/v2-vault]:             with no due protocol fees
➤ [@balancer-labs/v2-vault]:               when the sender is the user
➤ [@balancer-labs/v2-vault]:                 not using internal balance
➤ [@balancer-labs/v2-vault]:                   without internal balance
➤ [@balancer-labs/v2-vault]:                     when unpaused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient (275ms)
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                     when paused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens (267ms)
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                   with some internal balance
➤ [@balancer-labs/v2-vault]:                     when unpaused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (329ms)
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data (320ms)
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                     when paused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (307ms)
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (253ms)
➤ [@balancer-labs/v2-vault]:                 using internal balance
➤ [@balancer-labs/v2-vault]:                   with no internal balance
➤ [@balancer-labs/v2-vault]:                     when unpaused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (268ms)
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (262ms)
➤ [@balancer-labs/v2-vault]:                     when paused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (312ms)
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (252ms)
➤ [@balancer-labs/v2-vault]:                   with some internal balance
➤ [@balancer-labs/v2-vault]:                     when unpaused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (280ms)
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees (264ms)
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (335ms)
➤ [@balancer-labs/v2-vault]:                     when paused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees (295ms)
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (267ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:               when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                 when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                   when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                     not using internal balance
➤ [@balancer-labs/v2-vault]:                       without internal balance
➤ [@balancer-labs/v2-vault]:                         when unpaused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data (270ms)
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (314ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (593ms)
➤ [@balancer-labs/v2-vault]:                         when paused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient (315ms)
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool (285ms)
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees (256ms)
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (254ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                       with some internal balance
➤ [@balancer-labs/v2-vault]:                         when unpaused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully (277ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (372ms)
➤ [@balancer-labs/v2-vault]:                         when paused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool (277ms)
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (358ms)
➤ [@balancer-labs/v2-vault]:                     using internal balance
➤ [@balancer-labs/v2-vault]:                       with no internal balance
➤ [@balancer-labs/v2-vault]:                         when unpaused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees (290ms)
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (254ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (353ms)
➤ [@balancer-labs/v2-vault]:                         when paused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (491ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                       with some internal balance
➤ [@balancer-labs/v2-vault]:                         when unpaused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool (299ms)
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (463ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (292ms)
➤ [@balancer-labs/v2-vault]:                         when paused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient (418ms)
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully (333ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough (278ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (457ms)
➤ [@balancer-labs/v2-vault]:                   when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                     when the relayer is not eternally-allowed by the user
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                     when the relayer is allowed by signature
➤ [@balancer-labs/v2-vault]:                       not using internal balance
➤ [@balancer-labs/v2-vault]:                         without internal balance
➤ [@balancer-labs/v2-vault]:                           when unpaused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (293ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data (274ms)
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully (340ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (252ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (327ms)
➤ [@balancer-labs/v2-vault]:                           when paused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (316ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (326ms)
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (738ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (609ms)
➤ [@balancer-labs/v2-vault]:                         with some internal balance
➤ [@balancer-labs/v2-vault]:                           when unpaused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (359ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool (383ms)
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (427ms)
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (269ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (295ms)
➤ [@balancer-labs/v2-vault]:                           when paused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (427ms)
➤ [@balancer-labs/v2-vault]:                       using internal balance
➤ [@balancer-labs/v2-vault]:                         with no internal balance
➤ [@balancer-labs/v2-vault]:                           when unpaused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (281ms)
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                           when paused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient (351ms)
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (317ms)
➤ [@balancer-labs/v2-vault]:                         with some internal balance
➤ [@balancer-labs/v2-vault]:                           when unpaused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (278ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (308ms)
➤ [@balancer-labs/v2-vault]:                           when paused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (251ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (263ms)
➤ [@balancer-labs/v2-vault]:                 when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                   when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                     ✓ reverts
➤ [@balancer-labs/v2-vault]:                   when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                     ✓ reverts
➤ [@balancer-labs/v2-vault]:             with due protocol fees
➤ [@balancer-labs/v2-vault]:               not using internal balance
➤ [@balancer-labs/v2-vault]:                 without internal balance
➤ [@balancer-labs/v2-vault]:                   when unpaused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient (293ms)
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (435ms)
➤ [@balancer-labs/v2-vault]:                   when paused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (409ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (268ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                 with some internal balance
➤ [@balancer-labs/v2-vault]:                   when unpaused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (293ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (298ms)
➤ [@balancer-labs/v2-vault]:                   when paused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully (269ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (319ms)
➤ [@balancer-labs/v2-vault]:               using internal balance
➤ [@balancer-labs/v2-vault]:                 with no internal balance
➤ [@balancer-labs/v2-vault]:                   when unpaused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (435ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (299ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                   when paused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (404ms)
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees (402ms)
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (391ms)
➤ [@balancer-labs/v2-vault]:                 with some internal balance
➤ [@balancer-labs/v2-vault]:                   when unpaused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (327ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees (285ms)
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                   when paused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient (318ms)
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (359ms)
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough (317ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (252ms)
➤ [@balancer-labs/v2-vault]:     with two token pool
➤ [@balancer-labs/v2-vault]:       with no registered tokens
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]:       with registered tokens
➤ [@balancer-labs/v2-vault]:         when called incorrectly
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the pool ID does not exist
➤ [@balancer-labs/v2-vault]:           ✓ reverts if a token is missing in the array
➤ [@balancer-labs/v2-vault]:           ✓ reverts if there is one extra token
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the tokens list is not sorted
➤ [@balancer-labs/v2-vault]:           ✓ reverts if token array is empty
➤ [@balancer-labs/v2-vault]:           ✓ reverts if tokens and amounts length do not match
➤ [@balancer-labs/v2-vault]:         when called correctly
➤ [@balancer-labs/v2-vault]:           with incorrect pool return values
➤ [@balancer-labs/v2-vault]:             ✓ reverts if exit amounts length does not match token length
➤ [@balancer-labs/v2-vault]:             ✓ reverts if due protocol fees length does not match token length
➤ [@balancer-labs/v2-vault]:             ✓ reverts if exit amounts and due protocol fees length do not match token length
➤ [@balancer-labs/v2-vault]:           with correct pool return values
➤ [@balancer-labs/v2-vault]:             with no due protocol fees
➤ [@balancer-labs/v2-vault]:               when the sender is the user
➤ [@balancer-labs/v2-vault]:                 not using internal balance
➤ [@balancer-labs/v2-vault]:                   without internal balance
➤ [@balancer-labs/v2-vault]:                     when unpaused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient (288ms)
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough (373ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                     when paused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                   with some internal balance
➤ [@balancer-labs/v2-vault]:                     when unpaused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                     when paused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                 using internal balance
➤ [@balancer-labs/v2-vault]:                   with no internal balance
➤ [@balancer-labs/v2-vault]:                     when unpaused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient (259ms)
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                     when paused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens (277ms)
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                   with some internal balance
➤ [@balancer-labs/v2-vault]:                     when unpaused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                     when paused
➤ [@balancer-labs/v2-vault]:                       ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                       ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (348ms)
➤ [@balancer-labs/v2-vault]:               when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                 when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                   when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                     not using internal balance
➤ [@balancer-labs/v2-vault]:                       without internal balance
➤ [@balancer-labs/v2-vault]:                         when unpaused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient (340ms)
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully (281ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                         when paused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient (306ms)
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool (268ms)
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (299ms)
➤ [@balancer-labs/v2-vault]:                       with some internal balance
➤ [@balancer-labs/v2-vault]:                         when unpaused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                         when paused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                     using internal balance
➤ [@balancer-labs/v2-vault]:                       with no internal balance
➤ [@balancer-labs/v2-vault]:                         when unpaused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                         when paused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient (279ms)
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                       with some internal balance
➤ [@balancer-labs/v2-vault]:                         when unpaused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data (268ms)
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees (271ms)
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                         when paused
➤ [@balancer-labs/v2-vault]:                           ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                           ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (268ms)
➤ [@balancer-labs/v2-vault]:                   when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                     when the relayer is not eternally-allowed by the user
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                     when the relayer is allowed by signature
➤ [@balancer-labs/v2-vault]:                       not using internal balance
➤ [@balancer-labs/v2-vault]:                         without internal balance
➤ [@balancer-labs/v2-vault]:                           when unpaused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data (258ms)
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully (252ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                           when paused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient (297ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data (319ms)
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully (286ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                         with some internal balance
➤ [@balancer-labs/v2-vault]:                           when unpaused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                           when paused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough (426ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (282ms)
➤ [@balancer-labs/v2-vault]:                       using internal balance
➤ [@balancer-labs/v2-vault]:                         with no internal balance
➤ [@balancer-labs/v2-vault]:                           when unpaused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                           when paused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data (279ms)
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                         with some internal balance
➤ [@balancer-labs/v2-vault]:                           when unpaused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                           when paused
➤ [@balancer-labs/v2-vault]:                             ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                             ✓ assigns internal balance to the recipient (255ms)
➤ [@balancer-labs/v2-vault]:                             ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees (271ms)
➤ [@balancer-labs/v2-vault]:                             ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                 when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                   when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                     ✓ reverts
➤ [@balancer-labs/v2-vault]:                   when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                     ✓ reverts
➤ [@balancer-labs/v2-vault]:             with due protocol fees
➤ [@balancer-labs/v2-vault]:               not using internal balance
➤ [@balancer-labs/v2-vault]:                 without internal balance
➤ [@balancer-labs/v2-vault]:                   when unpaused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees (255ms)
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                   when paused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                 with some internal balance
➤ [@balancer-labs/v2-vault]:                   when unpaused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data (252ms)
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                   when paused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:               using internal balance
➤ [@balancer-labs/v2-vault]:                 with no internal balance
➤ [@balancer-labs/v2-vault]:                   when unpaused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (295ms)
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                   when paused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient (337ms)
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                 with some internal balance
➤ [@balancer-labs/v2-vault]:                   when unpaused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance
➤ [@balancer-labs/v2-vault]:                   when paused
➤ [@balancer-labs/v2-vault]:                     ✓ sends tokens from the vault to the recipient (253ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns internal balance to the recipient
➤ [@balancer-labs/v2-vault]:                     ✓ deducts tokens from the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the exit data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ exits multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ exits the pool fully (288ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the min amounts out is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to exit plus fees is larger than the pool balance (301ms)
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   Fees
➤ [@balancer-labs/v2-vault]:     set fees
➤ [@balancer-labs/v2-vault]:       when the sender is allowed
➤ [@balancer-labs/v2-vault]:         when the given input is valid
➤ [@balancer-labs/v2-vault]:           swap fee
➤ [@balancer-labs/v2-vault]:             ✓ sets the percentage properly
➤ [@balancer-labs/v2-vault]:             ✓ emits an event
➤ [@balancer-labs/v2-vault]:           flash loan fee
➤ [@balancer-labs/v2-vault]:             ✓ sets the percentage properly
➤ [@balancer-labs/v2-vault]:             ✓ emits an event
➤ [@balancer-labs/v2-vault]:         when the given input is invalid
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the swap fee percentage is above the maximum
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the flash loan fee percentage is above the maximum
➤ [@balancer-labs/v2-vault]:       when the sender is not allowed
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]:     collected fees
➤ [@balancer-labs/v2-vault]:       ✓ fees are initially zero
➤ [@balancer-labs/v2-vault]:       with collected protocol fees
➤ [@balancer-labs/v2-vault]:         ✓ reports collected fee
➤ [@balancer-labs/v2-vault]:         ✓ authorized accounts can withdraw protocol fees to any recipient
➤ [@balancer-labs/v2-vault]:         ✓ protocol fees cannot be over-withdrawn
➤ [@balancer-labs/v2-vault]:         ✓ unauthorized accounts cannot withdraw collected fees
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   Flash Loans
➤ [@balancer-labs/v2-vault]:     with no protocol fees
➤ [@balancer-labs/v2-vault]:       ✓ causes no net balance change on the Vault
➤ [@balancer-labs/v2-vault]:       ✓ all balance can be loaned
➤ [@balancer-labs/v2-vault]:       ✓ reverts if the loan is larger than available balance
➤ [@balancer-labs/v2-vault]:       ✓ reverts if the borrower does not repay the loan (251ms)
➤ [@balancer-labs/v2-vault]:     with protocol fees
➤ [@balancer-labs/v2-vault]:       ✓ zero loans are possible
➤ [@balancer-labs/v2-vault]:       ✓ zero loans are possible
➤ [@balancer-labs/v2-vault]:       ✓ the fees module receives protocol fees
➤ [@balancer-labs/v2-vault]:       ✓ protocol fees are rounded up
➤ [@balancer-labs/v2-vault]:       ✓ excess fees can be paid
➤ [@balancer-labs/v2-vault]:       ✓ all balance can be loaned
➤ [@balancer-labs/v2-vault]:       ✓ reverts if the borrower does not repay the loan
➤ [@balancer-labs/v2-vault]:       ✓ reverts if the borrower reenters the Vault
➤ [@balancer-labs/v2-vault]:       multi asset loan
➤ [@balancer-labs/v2-vault]:         ✓ the Vault receives protocol fees proportional to each loan (297ms)
➤ [@balancer-labs/v2-vault]:         ✓ all balance can be loaned
➤ [@balancer-labs/v2-vault]:         ✓ reverts if tokens are not unique
➤ [@balancer-labs/v2-vault]:         ✓ reverts if tokens are not sorted
➤ [@balancer-labs/v2-vault]:         ✓ reverts if a token is invalid
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   Internal Balance
➤ [@balancer-labs/v2-vault]:     deposit internal balance
➤ [@balancer-labs/v2-vault]:       when the sender is the user
➤ [@balancer-labs/v2-vault]:         when the asset is a token
➤ [@balancer-labs/v2-vault]:           when the sender does hold enough balance
➤ [@balancer-labs/v2-vault]:             when the given amount is approved by the sender
➤ [@balancer-labs/v2-vault]:               when tokens and balances match
➤ [@balancer-labs/v2-vault]:                 when depositing zero balance
➤ [@balancer-labs/v2-vault]:                   ✓ transfers the tokens from the sender to the vault
➤ [@balancer-labs/v2-vault]:                   ✓ deposits the internal balance into the recipient account
➤ [@balancer-labs/v2-vault]:                   ✓ returns ETH if any is sent
➤ [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 when depositing some balance
➤ [@balancer-labs/v2-vault]:                   ✓ transfers the tokens from the sender to the vault
➤ [@balancer-labs/v2-vault]:                   ✓ deposits the internal balance into the recipient account
➤ [@balancer-labs/v2-vault]:                   ✓ returns ETH if any is sent
➤ [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ [@balancer-labs/v2-vault]:             when the given amount is not approved by the sender
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the sender does not hold enough balance
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         when the asset is ETH
➤ [@balancer-labs/v2-vault]:           ✓ does not take WETH from the sender
➤ [@balancer-labs/v2-vault]:           ✓ increases the WETH internal balance for the recipient
➤ [@balancer-labs/v2-vault]:           ✓ emits an event with WETH as the token address
➤ [@balancer-labs/v2-vault]:           ✓ accepts deposits of both ETH and WETH (262ms)
➤ [@balancer-labs/v2-vault]:           ✓ accepts multiple ETH deposits
➤ [@balancer-labs/v2-vault]:           ✓ reverts if not enough ETH was supplied
➤ [@balancer-labs/v2-vault]:       when the sender is a relayer
➤ [@balancer-labs/v2-vault]:         when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:           when the relayer is allowed to deposit by the user
➤ [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to the vault
➤ [@balancer-labs/v2-vault]:             ✓ deposits the internal balance into the recipient account
➤ [@balancer-labs/v2-vault]:             ✓ returns ETH if any is sent
➤ [@balancer-labs/v2-vault]:             ✓ emits an event
➤ [@balancer-labs/v2-vault]:             when the asset is ETH
➤ [@balancer-labs/v2-vault]:               ✓ returns excess ETH to the relayer
➤ [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:           when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:     withdraw internal balance
➤ [@balancer-labs/v2-vault]:       when the sender is a user
➤ [@balancer-labs/v2-vault]:         when the asset is a token
➤ [@balancer-labs/v2-vault]:           when the sender has enough internal balance
➤ [@balancer-labs/v2-vault]:             when requesting all the available balance
➤ [@balancer-labs/v2-vault]:               when tokens and balances match
➤ [@balancer-labs/v2-vault]:                 ✓ transfers the tokens from the vault to recipient
➤ [@balancer-labs/v2-vault]:                 ✓ withdraws the internal balance from the sender account
➤ [@balancer-labs/v2-vault]:                 ✓ emits an event
➤ [@balancer-labs/v2-vault]:             when requesting part of the balance
➤ [@balancer-labs/v2-vault]:               when tokens and balances match
➤ [@balancer-labs/v2-vault]:                 ✓ transfers the tokens from the vault to recipient
➤ [@balancer-labs/v2-vault]:                 ✓ withdraws the internal balance from the sender account
➤ [@balancer-labs/v2-vault]:                 ✓ emits an event
➤ [@balancer-labs/v2-vault]:             when requesting no balance
➤ [@balancer-labs/v2-vault]:               when tokens and balances match
➤ [@balancer-labs/v2-vault]:                 ✓ transfers the tokens from the vault to recipient
➤ [@balancer-labs/v2-vault]:                 ✓ withdraws the internal balance from the sender account
➤ [@balancer-labs/v2-vault]:                 ✓ emits an event
➤ [@balancer-labs/v2-vault]:             with requesting more balance than available
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the sender does not have any internal balance
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         when the asset is ETH
➤ [@balancer-labs/v2-vault]:           when the sender has enough internal balance
➤ [@balancer-labs/v2-vault]:             ✓ does not send WETH to the recipient
➤ [@balancer-labs/v2-vault]:             ✓ decreases the WETH internal balance for the sender
➤ [@balancer-labs/v2-vault]:             ✓ emits an event with WETH as the token address
➤ [@balancer-labs/v2-vault]:             ✓ accepts withdrawals of both ETH and WETH
➤ [@balancer-labs/v2-vault]:       when the sender is a relayer
➤ [@balancer-labs/v2-vault]:         when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:           when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:             when tokens and balances match
➤ [@balancer-labs/v2-vault]:               ✓ transfers the tokens from the vault to recipient
➤ [@balancer-labs/v2-vault]:               ✓ withdraws the internal balance from the sender account
➤ [@balancer-labs/v2-vault]:               ✓ emits an event
➤ [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:           when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:     transfer internal balance
➤ [@balancer-labs/v2-vault]:       when the sender is a user
➤ [@balancer-labs/v2-vault]:         when the sender specifies some balance
➤ [@balancer-labs/v2-vault]:           when the sender holds enough balance
➤ [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to a single recipient
➤ [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to multiple recipients
➤ [@balancer-labs/v2-vault]:             ✓ does not affect the token balances of the sender nor the recipient
➤ [@balancer-labs/v2-vault]:             ✓ emits an event for each transfer
➤ [@balancer-labs/v2-vault]:           when the sender does not hold said balance
➤ [@balancer-labs/v2-vault]:             when the sender does not hold enough balance of one token
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender does not hold enough balance of the other token
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender does not hold enough balance of both tokens
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:         when the sender does not specify any balance
➤ [@balancer-labs/v2-vault]:           when the sender holds some balance
➤ [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to a single recipient
➤ [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to multiple recipients
➤ [@balancer-labs/v2-vault]:             ✓ does not affect the token balances of the sender nor the recipient
➤ [@balancer-labs/v2-vault]:             ✓ emits an event for each transfer
➤ [@balancer-labs/v2-vault]:           when the sender does not have any balance
➤ [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to a single recipient
➤ [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to multiple recipients
➤ [@balancer-labs/v2-vault]:             ✓ does not affect the token balances of the sender nor the recipient
➤ [@balancer-labs/v2-vault]:             ✓ emits an event for each transfer
➤ [@balancer-labs/v2-vault]:       when the sender is a relayer
➤ [@balancer-labs/v2-vault]:         when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:           when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to a single recipient
➤ [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to multiple recipients
➤ [@balancer-labs/v2-vault]:             ✓ does not affect the token balances of the sender nor the recipient
➤ [@balancer-labs/v2-vault]:             ✓ emits an event for each transfer
➤ [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:           when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:     transfer external balance
➤ [@balancer-labs/v2-vault]:       when the sender is the user
➤ [@balancer-labs/v2-vault]:         when the token is not the zero address
➤ [@balancer-labs/v2-vault]:           when the sender does hold enough balance
➤ [@balancer-labs/v2-vault]:             when the given amount is approved by the sender
➤ [@balancer-labs/v2-vault]:               when tokens and balances match
➤ [@balancer-labs/v2-vault]:                 when depositing zero balance
➤ [@balancer-labs/v2-vault]:                   ✓ transfers the tokens from the sender to the recipient, using the vault allowance of the sender
➤ [@balancer-labs/v2-vault]:                   ✓ does not change the internal balances of the accounts
➤ [@balancer-labs/v2-vault]:                   ✓ does not emit an event
➤ [@balancer-labs/v2-vault]:                 when depositing some balance
➤ [@balancer-labs/v2-vault]:                   ✓ transfers the tokens from the sender to the recipient, using the vault allowance of the sender
➤ [@balancer-labs/v2-vault]:                   ✓ does not change the internal balances of the accounts
➤ [@balancer-labs/v2-vault]:                   ✓ emits an event
➤ [@balancer-labs/v2-vault]:             when the given amount is not approved by the sender
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the sender does not hold enough balance
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:       when the sender is a relayer
➤ [@balancer-labs/v2-vault]:         when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:           when the relayer is allowed to transfer by the user
➤ [@balancer-labs/v2-vault]:             ✓ transfers the tokens from the sender to the recipient, using the vault allowance of the sender
➤ [@balancer-labs/v2-vault]:             ✓ does not change the internal balances of the accounts
➤ [@balancer-labs/v2-vault]:             ✓ emits an event
➤ [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:           when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:     batch
➤ [@balancer-labs/v2-vault]:       when unpaused
➤ [@balancer-labs/v2-vault]:         when all the senders allowed the relayer
➤ [@balancer-labs/v2-vault]:           when all ops add up
➤ [@balancer-labs/v2-vault]:             ✓ succeeds
➤ [@balancer-labs/v2-vault]:           when all ops do not add up
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         when one of the senders did not allow the relayer
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]:       when paused
➤ [@balancer-labs/v2-vault]:         when only withdrawing internal balance
➤ [@balancer-labs/v2-vault]:           ✓ succeeds
➤ [@balancer-labs/v2-vault]:         when trying to perform multiple ops
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   Join Pool
➤ [@balancer-labs/v2-vault]:     with general pool
➤ [@balancer-labs/v2-vault]:       with no registered tokens
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]:       with registered tokens
➤ [@balancer-labs/v2-vault]:         when called incorrectly
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the pool ID does not exist
➤ [@balancer-labs/v2-vault]:           ✓ reverts if a token is missing in the array
➤ [@balancer-labs/v2-vault]:           ✓ reverts if there is one extra token
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the tokens list is not sorted
➤ [@balancer-labs/v2-vault]:           ✓ reverts if token array is empty
➤ [@balancer-labs/v2-vault]:           ✓ reverts if tokens and amounts length do not match
➤ [@balancer-labs/v2-vault]:         when called correctly
➤ [@balancer-labs/v2-vault]:           with incorrect pool return values
➤ [@balancer-labs/v2-vault]:             ✓ reverts if join amounts length does not match token length
➤ [@balancer-labs/v2-vault]:             ✓ reverts if due protocol fees length does not match token length
➤ [@balancer-labs/v2-vault]:             ✓ reverts if join amounts and due protocol fees length do not match token length
➤ [@balancer-labs/v2-vault]:           with correct pool return values
➤ [@balancer-labs/v2-vault]:             when unpaused
➤ [@balancer-labs/v2-vault]:               with no due protocol fees
➤ [@balancer-labs/v2-vault]:                 when the sender is the user
➤ [@balancer-labs/v2-vault]:                   not using internal balance
➤ [@balancer-labs/v2-vault]:                     with no internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (337ms)
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault (275ms)
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (276ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance (396ms)
➤ [@balancer-labs/v2-vault]:                     with some internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees (269ms)
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance (421ms)
➤ [@balancer-labs/v2-vault]:                   using internal balance
➤ [@balancer-labs/v2-vault]:                     with no internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (312ms)
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (339ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance (375ms)
➤ [@balancer-labs/v2-vault]:                     with some internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool (325ms)
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (362ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                     with enough internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (256ms)
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool (349ms)
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees (282ms)
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (320ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                 when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                   when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                     when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                       not using internal balance
➤ [@balancer-labs/v2-vault]:                         with no internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (343ms)
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault (320ms)
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough (342ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance (271ms)
➤ [@balancer-labs/v2-vault]:                         with some internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough (390ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance (367ms)
➤ [@balancer-labs/v2-vault]:                       using internal balance
➤ [@balancer-labs/v2-vault]:                         with no internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (263ms)
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees (366ms)
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough (370ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance (350ms)
➤ [@balancer-labs/v2-vault]:                         with some internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens (289ms)
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough (258ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance (342ms)
➤ [@balancer-labs/v2-vault]:                         with enough internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (340ms)
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data (253ms)
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance (255ms)
➤ [@balancer-labs/v2-vault]:                     when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                       when the relayer is not eternally-allowed by the user
➤ [@balancer-labs/v2-vault]:                         ✓ reverts
➤ [@balancer-labs/v2-vault]:                       when the relayer is allowed by signature
➤ [@balancer-labs/v2-vault]:                         not using internal balance
➤ [@balancer-labs/v2-vault]:                           with no internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (284ms)
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees (257ms)
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (313ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (337ms)
➤ [@balancer-labs/v2-vault]:                           with some internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees (314ms)
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (548ms)
➤ [@balancer-labs/v2-vault]:                         using internal balance
➤ [@balancer-labs/v2-vault]:                           with no internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (267ms)
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool (385ms)
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (277ms)
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (666ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (255ms)
➤ [@balancer-labs/v2-vault]:                           with some internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP (284ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (340ms)
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (344ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (366ms)
➤ [@balancer-labs/v2-vault]:                           with enough internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (347ms)
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP (258ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (337ms)
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (385ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (455ms)
➤ [@balancer-labs/v2-vault]:                   when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                     when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                     when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:               with due protocol fees
➤ [@balancer-labs/v2-vault]:                 not using internal balance
➤ [@balancer-labs/v2-vault]:                   with no internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data (389ms)
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (261ms)
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault (315ms)
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (545ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                   with some internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault (453ms)
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data (312ms)
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (298ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance (296ms)
➤ [@balancer-labs/v2-vault]:                 using internal balance
➤ [@balancer-labs/v2-vault]:                   with no internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault (549ms)
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP (291ms)
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (315ms)
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault (305ms)
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (454ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance (375ms)
➤ [@balancer-labs/v2-vault]:                   with some internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault (315ms)
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool (282ms)
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (251ms)
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance (340ms)
➤ [@balancer-labs/v2-vault]:                   with enough internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool (251ms)
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (428ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance (269ms)
➤ [@balancer-labs/v2-vault]:             when paused
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:     with minimal swap info pool
➤ [@balancer-labs/v2-vault]:       with no registered tokens
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]:       with registered tokens
➤ [@balancer-labs/v2-vault]:         when called incorrectly
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the pool ID does not exist
➤ [@balancer-labs/v2-vault]:           ✓ reverts if a token is missing in the array
➤ [@balancer-labs/v2-vault]:           ✓ reverts if there is one extra token
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the tokens list is not sorted
➤ [@balancer-labs/v2-vault]:           ✓ reverts if token array is empty
➤ [@balancer-labs/v2-vault]:           ✓ reverts if tokens and amounts length do not match
➤ [@balancer-labs/v2-vault]:         when called correctly
➤ [@balancer-labs/v2-vault]:           with incorrect pool return values
➤ [@balancer-labs/v2-vault]:             ✓ reverts if join amounts length does not match token length
➤ [@balancer-labs/v2-vault]:             ✓ reverts if due protocol fees length does not match token length
➤ [@balancer-labs/v2-vault]:             ✓ reverts if join amounts and due protocol fees length do not match token length
➤ [@balancer-labs/v2-vault]:           with correct pool return values
➤ [@balancer-labs/v2-vault]:             when unpaused
➤ [@balancer-labs/v2-vault]:               with no due protocol fees
➤ [@balancer-labs/v2-vault]:                 when the sender is the user
➤ [@balancer-labs/v2-vault]:                   not using internal balance
➤ [@balancer-labs/v2-vault]:                     with no internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (311ms)
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens (286ms)
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance (315ms)
➤ [@balancer-labs/v2-vault]:                     with some internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (261ms)
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (391ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                   using internal balance
➤ [@balancer-labs/v2-vault]:                     with no internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (299ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                     with some internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (268ms)
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool (294ms)
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                     with enough internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                 when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                   when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                     when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                       not using internal balance
➤ [@balancer-labs/v2-vault]:                         with no internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance (405ms)
➤ [@balancer-labs/v2-vault]:                         with some internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (322ms)
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool (274ms)
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough (373ms)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                       using internal balance
➤ [@balancer-labs/v2-vault]:                         with no internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens (311ms)
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                         with some internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data (280ms)
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                         with enough internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault (283ms)
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                     when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                       when the relayer is not eternally-allowed by the user
➤ [@balancer-labs/v2-vault]:                         ✓ reverts
➤ [@balancer-labs/v2-vault]:                       when the relayer is allowed by signature
➤ [@balancer-labs/v2-vault]:                         not using internal balance
➤ [@balancer-labs/v2-vault]:                           with no internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (262ms)
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP (267ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees (309ms)
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (258ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (291ms)
➤ [@balancer-labs/v2-vault]:                           with some internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool (389ms)
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens (263ms)
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (271ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (360ms)
➤ [@balancer-labs/v2-vault]:                         using internal balance
➤ [@balancer-labs/v2-vault]:                           with no internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (409ms)
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (280ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (371ms)
➤ [@balancer-labs/v2-vault]:                           with some internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (334ms)
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool (267ms)
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (263ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (328ms)
➤ [@balancer-labs/v2-vault]:                           with enough internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data (263ms)
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (377ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (380ms)
➤ [@balancer-labs/v2-vault]:                   when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                     when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                     when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:               with due protocol fees
➤ [@balancer-labs/v2-vault]:                 not using internal balance
➤ [@balancer-labs/v2-vault]:                   with no internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault (258ms)
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool (334ms)
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data (451ms)
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (367ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance (295ms)
➤ [@balancer-labs/v2-vault]:                   with some internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool (298ms)
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault (251ms)
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (292ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                 using internal balance
➤ [@balancer-labs/v2-vault]:                   with no internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault (328ms)
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (252ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance (335ms)
➤ [@balancer-labs/v2-vault]:                   with some internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens (254ms)
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (281ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                   with enough internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough (324ms)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:             when paused
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:     with two token pool
➤ [@balancer-labs/v2-vault]:       with no registered tokens
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]:       with registered tokens
➤ [@balancer-labs/v2-vault]:         when called incorrectly
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the pool ID does not exist
➤ [@balancer-labs/v2-vault]:           ✓ reverts if a token is missing in the array
➤ [@balancer-labs/v2-vault]:           ✓ reverts if there is one extra token
➤ [@balancer-labs/v2-vault]:           ✓ reverts if the tokens list is not sorted
➤ [@balancer-labs/v2-vault]:           ✓ reverts if token array is empty
➤ [@balancer-labs/v2-vault]:           ✓ reverts if tokens and amounts length do not match
➤ [@balancer-labs/v2-vault]:         when called correctly
➤ [@balancer-labs/v2-vault]:           with incorrect pool return values
➤ [@balancer-labs/v2-vault]:             ✓ reverts if join amounts length does not match token length
➤ [@balancer-labs/v2-vault]:             ✓ reverts if due protocol fees length does not match token length
➤ [@balancer-labs/v2-vault]:             ✓ reverts if join amounts and due protocol fees length do not match token length (259ms)
➤ [@balancer-labs/v2-vault]:           with correct pool return values
➤ [@balancer-labs/v2-vault]:             when unpaused
➤ [@balancer-labs/v2-vault]:               with no due protocol fees
➤ [@balancer-labs/v2-vault]:                 when the sender is the user
➤ [@balancer-labs/v2-vault]:                   not using internal balance
➤ [@balancer-labs/v2-vault]:                     with no internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data (253ms)
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                     with some internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data (265ms)
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough (256ms)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                   using internal balance
➤ [@balancer-labs/v2-vault]:                     with no internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance (283ms)
➤ [@balancer-labs/v2-vault]:                     with some internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                     with enough internal balance
➤ [@balancer-labs/v2-vault]:                       ✓ takes tokens from the LP into the vault (289ms)
➤ [@balancer-labs/v2-vault]:                       ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                       ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                       ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                       ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                       ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                       ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                       ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                       ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                 when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                   when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                     when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                       not using internal balance
➤ [@balancer-labs/v2-vault]:                         with no internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (308ms)
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                         with some internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                       using internal balance
➤ [@balancer-labs/v2-vault]:                         with no internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (467ms)
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                         with some internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (291ms)
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                         with enough internal balance
➤ [@balancer-labs/v2-vault]:                           ✓ takes tokens from the LP into the vault (267ms)
➤ [@balancer-labs/v2-vault]:                           ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                           ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                           ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                           ✓ updates the last change block used for all tokens (274ms)
➤ [@balancer-labs/v2-vault]:                           ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                           ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                           ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                           ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                     when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                       when the relayer is not eternally-allowed by the user
➤ [@balancer-labs/v2-vault]:                         ✓ reverts
➤ [@balancer-labs/v2-vault]:                       when the relayer is allowed by signature
➤ [@balancer-labs/v2-vault]:                         not using internal balance
➤ [@balancer-labs/v2-vault]:                           with no internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (305ms)
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (262ms)
➤ [@balancer-labs/v2-vault]:                           with some internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP (445ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool (344ms)
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough (295ms)
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance (345ms)
➤ [@balancer-labs/v2-vault]:                         using internal balance
➤ [@balancer-labs/v2-vault]:                           with no internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (363ms)
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP (328ms)
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees (264ms)
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                           with some internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault (291ms)
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                           with enough internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                             ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                             ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                             ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                             ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                             ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                             ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                             ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                             ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                   when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                     when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                     when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:               with due protocol fees
➤ [@balancer-labs/v2-vault]:                 not using internal balance
➤ [@balancer-labs/v2-vault]:                   with no internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                   with some internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                 using internal balance
➤ [@balancer-labs/v2-vault]:                   with no internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault (333ms)
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                   with some internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:                   with enough internal balance
➤ [@balancer-labs/v2-vault]:                     ✓ takes tokens from the LP into the vault
➤ [@balancer-labs/v2-vault]:                     ✓ deducts internal balance from the LP
➤ [@balancer-labs/v2-vault]:                     ✓ assigns tokens to the pool
➤ [@balancer-labs/v2-vault]:                     ✓ calls the pool with the join data
➤ [@balancer-labs/v2-vault]:                     ✓ updates the last change block used for all tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits PoolBalanceChanged from the vault
➤ [@balancer-labs/v2-vault]:                     ✓ collects protocol fees
➤ [@balancer-labs/v2-vault]:                     ✓ joins multiple times
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the max amounts in is not enough
➤ [@balancer-labs/v2-vault]:                     ✓ reverts if any of the amounts to transfer is larger than lp balance
➤ [@balancer-labs/v2-vault]:             when paused
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   PoolRegistry
➤ [@balancer-labs/v2-vault]:     pool creation
➤ [@balancer-labs/v2-vault]:       ✓ any account can create pools
➤ [@balancer-labs/v2-vault]:       ✓ pools require a valid pool specialization setting
➤ [@balancer-labs/v2-vault]:     pool properties
➤ [@balancer-labs/v2-vault]:       ✓ has an address and an specialization setting
➤ [@balancer-labs/v2-vault]:       ✓ starts with no tokens
➤ [@balancer-labs/v2-vault]:       ✓ gets a new id
➤ [@balancer-labs/v2-vault]:     token management
➤ [@balancer-labs/v2-vault]:       with general pool
➤ [@balancer-labs/v2-vault]:         ✓ reverts when querying token balances of unexisting pools
➤ [@balancer-labs/v2-vault]:       with minimal swap info pool
➤ [@balancer-labs/v2-vault]:         ✓ reverts when querying token balances of unexisting pools
➤ [@balancer-labs/v2-vault]:       with two token pool
➤ [@balancer-labs/v2-vault]:         ✓ reverts when querying token balances of unexisting pools
➤ [@balancer-labs/v2-vault]:     token registration
➤ [@balancer-labs/v2-vault]:       register
➤ [@balancer-labs/v2-vault]:         for a minimal swap info pool
➤ [@balancer-labs/v2-vault]:           when the pool was created
➤ [@balancer-labs/v2-vault]:             when the sender is the pool
➤ [@balancer-labs/v2-vault]:               when the given addresses where not registered yet
➤ [@balancer-labs/v2-vault]:                 when one of the given tokens is the zero address
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:                 when the number of tokens and asset managers does not match
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:                 when none of the tokens is the zero address
➤ [@balancer-labs/v2-vault]:                   with one token
➤ [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                     ✓ can be registered individually
➤ [@balancer-labs/v2-vault]:                   with two tokens
➤ [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                     ✓ can be registered individually
➤ [@balancer-labs/v2-vault]:                   with three tokens
➤ [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                     ✓ can be registered individually
➤ [@balancer-labs/v2-vault]:               when one of the given tokens was already registered
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the pool
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the pool was not created
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         for a general pool
➤ [@balancer-labs/v2-vault]:           when the pool was created
➤ [@balancer-labs/v2-vault]:             when the sender is the pool
➤ [@balancer-labs/v2-vault]:               when the given addresses where not registered yet
➤ [@balancer-labs/v2-vault]:                 when one of the given tokens is the zero address
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:                 when the number of tokens and asset managers does not match
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:                 when none of the tokens is the zero address
➤ [@balancer-labs/v2-vault]:                   with one token
➤ [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                     ✓ can be registered individually
➤ [@balancer-labs/v2-vault]:                   with two tokens
➤ [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                     ✓ can be registered individually
➤ [@balancer-labs/v2-vault]:                   with three tokens
➤ [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                     ✓ can be registered individually
➤ [@balancer-labs/v2-vault]:               when one of the given tokens was already registered
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the pool
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the pool was not created
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         for a two token pool
➤ [@balancer-labs/v2-vault]:           when the pool was created
➤ [@balancer-labs/v2-vault]:             when the sender is the pool
➤ [@balancer-labs/v2-vault]:               when the given addresses where not registered yet
➤ [@balancer-labs/v2-vault]:                 when one of the given tokens is the zero address
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:                 when the number of tokens and asset managers does not match
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:                 when none of the tokens is the zero address
➤ [@balancer-labs/v2-vault]:                   with one token
➤ [@balancer-labs/v2-vault]:                     ✓ reverts
➤ [@balancer-labs/v2-vault]:                   with two tokens
➤ [@balancer-labs/v2-vault]:                     ✓ registers the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                     ✓ cannot be registered individually
➤ [@balancer-labs/v2-vault]:                   with three tokens
➤ [@balancer-labs/v2-vault]:                     ✓ reverts
➤ [@balancer-labs/v2-vault]:               when one of the given tokens was already registered
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the pool
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the pool was not created
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:       deregister
➤ [@balancer-labs/v2-vault]:         for a minimal swap info pool
➤ [@balancer-labs/v2-vault]:           when the pool was created
➤ [@balancer-labs/v2-vault]:             when the sender is the pool
➤ [@balancer-labs/v2-vault]:               when the given addresses where registered
➤ [@balancer-labs/v2-vault]:                 with one token
➤ [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ [@balancer-labs/v2-vault]:                       ✓ can deregister the tokens without balance
➤ [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ [@balancer-labs/v2-vault]:                       ✓ can deregister the tokens without balance
➤ [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ [@balancer-labs/v2-vault]:                       ✓ can deregister the tokens without balance
➤ [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:               when one of the given addresses was not registered
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the pool
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the pool was not created
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         for a general pool
➤ [@balancer-labs/v2-vault]:           when the pool was created
➤ [@balancer-labs/v2-vault]:             when the sender is the pool
➤ [@balancer-labs/v2-vault]:               when the given addresses where registered
➤ [@balancer-labs/v2-vault]:                 with one token
➤ [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ [@balancer-labs/v2-vault]:                       ✓ can deregister the tokens without balance
➤ [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ [@balancer-labs/v2-vault]:                       ✓ can deregister the tokens without balance
➤ [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ [@balancer-labs/v2-vault]:                       ✓ can deregister the tokens without balance
➤ [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:               when one of the given addresses was not registered
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the pool
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the pool was not created
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:         for a two token pool
➤ [@balancer-labs/v2-vault]:           when the pool was created
➤ [@balancer-labs/v2-vault]:             when the sender is the pool
➤ [@balancer-labs/v2-vault]:               when the given addresses where registered
➤ [@balancer-labs/v2-vault]:                 with one token
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   when some tokens still have some balance
➤ [@balancer-labs/v2-vault]:                     when trying to deregister individually
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                     when trying to deregister all tokens at once
➤ [@balancer-labs/v2-vault]:                       ✓ reverts
➤ [@balancer-labs/v2-vault]:                   when all the tokens have no balance
➤ [@balancer-labs/v2-vault]:                     ✓ deregisters the requested tokens
➤ [@balancer-labs/v2-vault]:                     ✓ cannot query balances any more
➤ [@balancer-labs/v2-vault]:                     ✓ emits an event
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   ✓ reverts
➤ [@balancer-labs/v2-vault]:               when one of the given addresses was not registered
➤ [@balancer-labs/v2-vault]:                 ✓ reverts
➤ [@balancer-labs/v2-vault]:             when the sender is not the pool
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the pool was not created
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   Swap Queries
➤ [@balancer-labs/v2-vault]:     given in
➤ [@balancer-labs/v2-vault]:       single swap
➤ [@balancer-labs/v2-vault]:         ✓ returns the expected amounts
➤ [@balancer-labs/v2-vault]:       multiple pools
➤ [@balancer-labs/v2-vault]:         ✓ returns the expected amounts
➤ [@balancer-labs/v2-vault]:       multihop
➤ [@balancer-labs/v2-vault]:         ✓ returns the expected amounts
➤ [@balancer-labs/v2-vault]:       error
➤ [@balancer-labs/v2-vault]:         ✓ bubbles up revert reasons
➤ [@balancer-labs/v2-vault]:     given out
➤ [@balancer-labs/v2-vault]:       single swap
➤ [@balancer-labs/v2-vault]:         ✓ returns the expected amounts
➤ [@balancer-labs/v2-vault]:       multiple pools
➤ [@balancer-labs/v2-vault]:         ✓ returns the expected amounts
➤ [@balancer-labs/v2-vault]:       multihop
➤ [@balancer-labs/v2-vault]:         ✓ returns the expected amounts
➤ [@balancer-labs/v2-vault]:       error
➤ [@balancer-labs/v2-vault]:         ✓ bubbles up revert reasons
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   Swap Validation
➤ [@balancer-labs/v2-vault]:     in swaps given in
➤ [@balancer-labs/v2-vault]:       with expired deadline
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]:       with unexpired deadline
➤ [@balancer-labs/v2-vault]:         when paused
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]:         when unpaused
➤ [@balancer-labs/v2-vault]:           ✓ reverts if there are less limits than tokens
➤ [@balancer-labs/v2-vault]:           ✓ reverts if there are more limits than tokens
➤ [@balancer-labs/v2-vault]:           with correct limit length
➤ [@balancer-labs/v2-vault]:             without withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:               without depositing to internal balance
➤ [@balancer-labs/v2-vault]:                 with limits too low
➤ [@balancer-labs/v2-vault]:                   ✓ reverts (787ms)
➤ [@balancer-labs/v2-vault]:                 with exact limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (374ms)
➤ [@balancer-labs/v2-vault]:                 with sufficient limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (848ms)
➤ [@balancer-labs/v2-vault]:               depositing to internal balance
➤ [@balancer-labs/v2-vault]:                 with limits too low
➤ [@balancer-labs/v2-vault]:                   ✓ reverts (1280ms)
➤ [@balancer-labs/v2-vault]:                 with exact limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (348ms)
➤ [@balancer-labs/v2-vault]:                 with sufficient limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (1169ms)
➤ [@balancer-labs/v2-vault]:             withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:               without depositing to internal balance
➤ [@balancer-labs/v2-vault]:                 with limits too low
➤ [@balancer-labs/v2-vault]:                   ✓ reverts (495ms)
➤ [@balancer-labs/v2-vault]:                 with exact limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (484ms)
➤ [@balancer-labs/v2-vault]:                 with sufficient limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (971ms)
➤ [@balancer-labs/v2-vault]:               depositing to internal balance
➤ [@balancer-labs/v2-vault]:                 with limits too low
➤ [@balancer-labs/v2-vault]:                   ✓ reverts (1087ms)
➤ [@balancer-labs/v2-vault]:                 with exact limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (289ms)
➤ [@balancer-labs/v2-vault]:                 with sufficient limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (1133ms)
➤ [@balancer-labs/v2-vault]:     in swaps given out
➤ [@balancer-labs/v2-vault]:       with expired deadline
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]:       with unexpired deadline
➤ [@balancer-labs/v2-vault]:         when paused
➤ [@balancer-labs/v2-vault]:           ✓ reverts
➤ [@balancer-labs/v2-vault]:         when unpaused
➤ [@balancer-labs/v2-vault]:           ✓ reverts if there are less limits than tokens
➤ [@balancer-labs/v2-vault]:           ✓ reverts if there are more limits than tokens
➤ [@balancer-labs/v2-vault]:           with correct limit length
➤ [@balancer-labs/v2-vault]:             without withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:               without depositing to internal balance
➤ [@balancer-labs/v2-vault]:                 with limits too low
➤ [@balancer-labs/v2-vault]:                   ✓ reverts (1011ms)
➤ [@balancer-labs/v2-vault]:                 with exact limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap
➤ [@balancer-labs/v2-vault]:                 with sufficient limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (1171ms)
➤ [@balancer-labs/v2-vault]:               depositing to internal balance
➤ [@balancer-labs/v2-vault]:                 with limits too low
➤ [@balancer-labs/v2-vault]:                   ✓ reverts (859ms)
➤ [@balancer-labs/v2-vault]:                 with exact limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (357ms)
➤ [@balancer-labs/v2-vault]:                 with sufficient limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (1017ms)
➤ [@balancer-labs/v2-vault]:             withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:               without depositing to internal balance
➤ [@balancer-labs/v2-vault]:                 with limits too low
➤ [@balancer-labs/v2-vault]:                   ✓ reverts (1137ms)
➤ [@balancer-labs/v2-vault]:                 with exact limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap
➤ [@balancer-labs/v2-vault]:                 with sufficient limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (1079ms)
➤ [@balancer-labs/v2-vault]:               depositing to internal balance
➤ [@balancer-labs/v2-vault]:                 with limits too low
➤ [@balancer-labs/v2-vault]:                   ✓ reverts (721ms)
➤ [@balancer-labs/v2-vault]:                 with exact limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (283ms)
➤ [@balancer-labs/v2-vault]:                 with sufficient limits
➤ [@balancer-labs/v2-vault]:                   ✓ accepts the swap (1274ms)
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   Swaps
➤ [@balancer-labs/v2-vault]:     with two tokens
➤ [@balancer-labs/v2-vault]:       with a general pool
➤ [@balancer-labs/v2-vault]:         swap given in
➤ [@balancer-labs/v2-vault]:           for a single swap
➤ [@balancer-labs/v2-vault]:             when the pool is registered
➤ [@balancer-labs/v2-vault]:               when an amount is specified
➤ [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ [@balancer-labs/v2-vault]:                       when requesting another token
➤ [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ [@balancer-labs/v2-vault]:                           when using managed balance
➤ [@balancer-labs/v2-vault]:                             when the sender is the user
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   when the relayer has a valid signature from the user
➤ [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                   when the relayer has an invalid signature from the user
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                   when there is no signature
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when draining the pool
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:               when no amount is specified
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:             when the pool is not registered
➤ [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:           for a multi swap
➤ [@balancer-labs/v2-vault]:             without hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:             with hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 when token in and out match
➤ [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:         swap given out
➤ [@balancer-labs/v2-vault]:           for a single swap
➤ [@balancer-labs/v2-vault]:             when the pool is registered
➤ [@balancer-labs/v2-vault]:               when an amount is specified
➤ [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ [@balancer-labs/v2-vault]:                       when the requesting another token
➤ [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ [@balancer-labs/v2-vault]:                           when using managed balance
➤ [@balancer-labs/v2-vault]:                             when the sender is the user
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when draining the pool
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:               when no amount is specified
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:             when the pool is not registered
➤ [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:           for a multi swap
➤ [@balancer-labs/v2-vault]:             without hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:             with hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 when token in and out match
➤ [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:       with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:         swap given in
➤ [@balancer-labs/v2-vault]:           for a single swap
➤ [@balancer-labs/v2-vault]:             when the pool is registered
➤ [@balancer-labs/v2-vault]:               when an amount is specified
➤ [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ [@balancer-labs/v2-vault]:                       when requesting another token
➤ [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ [@balancer-labs/v2-vault]:                           when using managed balance
➤ [@balancer-labs/v2-vault]:                             when the sender is the user
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   when the relayer has a valid signature from the user
➤ [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                   when the relayer has an invalid signature from the user
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                   when there is no signature
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when draining the pool
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:               when no amount is specified
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:             when the pool is not registered
➤ [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:           for a multi swap
➤ [@balancer-labs/v2-vault]:             without hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:             with hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 when token in and out match
➤ [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:         swap given out
➤ [@balancer-labs/v2-vault]:           for a single swap
➤ [@balancer-labs/v2-vault]:             when the pool is registered
➤ [@balancer-labs/v2-vault]:               when an amount is specified
➤ [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ [@balancer-labs/v2-vault]:                       when the requesting another token
➤ [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ [@balancer-labs/v2-vault]:                           when using managed balance
➤ [@balancer-labs/v2-vault]:                             when the sender is the user
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when draining the pool
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:               when no amount is specified
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:             when the pool is not registered
➤ [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:           for a multi swap
➤ [@balancer-labs/v2-vault]:             without hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount  (270ms)
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:             with hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 when token in and out match
➤ [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:       with a two token pool
➤ [@balancer-labs/v2-vault]:         swap given in
➤ [@balancer-labs/v2-vault]:           for a single swap
➤ [@balancer-labs/v2-vault]:             when the pool is registered
➤ [@balancer-labs/v2-vault]:               when an amount is specified
➤ [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ [@balancer-labs/v2-vault]:                       when requesting another token
➤ [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ [@balancer-labs/v2-vault]:                           when using managed balance
➤ [@balancer-labs/v2-vault]:                             when the sender is the user
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   when the relayer has a valid signature from the user
➤ [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                   when the relayer has an invalid signature from the user
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                   when there is no signature
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when draining the pool
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:               when no amount is specified
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:             when the pool is not registered
➤ [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:           for a multi swap
➤ [@balancer-labs/v2-vault]:             without hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:             with hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 when token in and out match
➤ [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount  (302ms)
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:         swap given out
➤ [@balancer-labs/v2-vault]:           for a single swap
➤ [@balancer-labs/v2-vault]:             when the pool is registered
➤ [@balancer-labs/v2-vault]:               when an amount is specified
➤ [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ [@balancer-labs/v2-vault]:                       when the requesting another token
➤ [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ [@balancer-labs/v2-vault]:                           when using managed balance
➤ [@balancer-labs/v2-vault]:                             when the sender is the user
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when draining the pool
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:               when no amount is specified
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:             when the pool is not registered
➤ [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:           for a multi swap
➤ [@balancer-labs/v2-vault]:             without hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount  (285ms)
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:             with hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 when token in and out match
➤ [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:     with three tokens
➤ [@balancer-labs/v2-vault]:       with a general pool
➤ [@balancer-labs/v2-vault]:         swap given in
➤ [@balancer-labs/v2-vault]:           for a single swap
➤ [@balancer-labs/v2-vault]:             when the pool is registered
➤ [@balancer-labs/v2-vault]:               when an amount is specified
➤ [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ [@balancer-labs/v2-vault]:                       when requesting another token
➤ [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ [@balancer-labs/v2-vault]:                           when using managed balance
➤ [@balancer-labs/v2-vault]:                             when the sender is the user
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   when the relayer has a valid signature from the user
➤ [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                   when the relayer has an invalid signature from the user
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                   when there is no signature
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when draining the pool
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:               when no amount is specified
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:             when the pool is not registered
➤ [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:           for a multi swap
➤ [@balancer-labs/v2-vault]:             without hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount  (362ms)
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount  (370ms)
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount  (301ms)
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:             with hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 when token in and out match
➤ [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount  (267ms)
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:         swap given out
➤ [@balancer-labs/v2-vault]:           for a single swap
➤ [@balancer-labs/v2-vault]:             when the pool is registered
➤ [@balancer-labs/v2-vault]:               when an amount is specified
➤ [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ [@balancer-labs/v2-vault]:                       when the requesting another token
➤ [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ [@balancer-labs/v2-vault]:                           when using managed balance
➤ [@balancer-labs/v2-vault]:                             when the sender is the user
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when draining the pool
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:               when no amount is specified
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:             when the pool is not registered
➤ [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:           for a multi swap
➤ [@balancer-labs/v2-vault]:             without hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:             with hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 when token in and out match
➤ [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:       with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:         swap given in
➤ [@balancer-labs/v2-vault]:           for a single swap
➤ [@balancer-labs/v2-vault]:             when the pool is registered
➤ [@balancer-labs/v2-vault]:               when an amount is specified
➤ [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ [@balancer-labs/v2-vault]:                       when requesting another token
➤ [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ [@balancer-labs/v2-vault]:                           when using managed balance
➤ [@balancer-labs/v2-vault]:                             when the sender is the user
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   when the relayer has a valid signature from the user
➤ [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                   when the relayer has an invalid signature from the user
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                   when there is no signature
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when draining the pool
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:               when no amount is specified
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:             when the pool is not registered
➤ [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:           for a multi swap
➤ [@balancer-labs/v2-vault]:             without hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:             with hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 when token in and out match
➤ [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:         swap given out
➤ [@balancer-labs/v2-vault]:           for a single swap
➤ [@balancer-labs/v2-vault]:             when the pool is registered
➤ [@balancer-labs/v2-vault]:               when an amount is specified
➤ [@balancer-labs/v2-vault]:                 when the given indexes are valid
➤ [@balancer-labs/v2-vault]:                   when the given token is in the pool
➤ [@balancer-labs/v2-vault]:                     when the requested token is in the pool
➤ [@balancer-labs/v2-vault]:                       when the requesting another token
➤ [@balancer-labs/v2-vault]:                         when requesting a reasonable amount
➤ [@balancer-labs/v2-vault]:                           when using managed balance
➤ [@balancer-labs/v2-vault]:                             when the sender is the user
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when the sender is a relayer
➤ [@balancer-labs/v2-vault]:                               when the relayer is whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                               when the relayer is not whitelisted by the authorizer
➤ [@balancer-labs/v2-vault]:                                 when the relayer is allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                                 when the relayer is not allowed by the user
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                                   ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                           when withdrawing from internal balance
➤ [@balancer-labs/v2-vault]:                             when using less than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                             when using more than available as internal balance
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                               ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                           when depositing from internal balance
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                             ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when draining the pool
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (single)
➤ [@balancer-labs/v2-vault]:                           ✓ trades the expected amount (batch)
➤ [@balancer-labs/v2-vault]:                         when requesting more than the available balance
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                           ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                       when the requesting the same token
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                         ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                     when the requested token is not in the pool
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                       ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the given token is not in the pool
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                 when the given indexes are not valid
➤ [@balancer-labs/v2-vault]:                   when the token index in is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:                   when the token index out is not valid
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                     ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:               when no amount is specified
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:                 ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:             when the pool is not registered
➤ [@balancer-labs/v2-vault]:               ✓ reverts (single)
➤ [@balancer-labs/v2-vault]:               ✓ reverts (batch)
➤ [@balancer-labs/v2-vault]:           for a multi swap
➤ [@balancer-labs/v2-vault]:             without hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount  (252ms)
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       when pools offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                       when pools do not offer same price
➤ [@balancer-labs/v2-vault]:                         ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount  (281ms)
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     for a single pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                     for a multi pair
➤ [@balancer-labs/v2-vault]:                       ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:             with hops
➤ [@balancer-labs/v2-vault]:               with the same pool
➤ [@balancer-labs/v2-vault]:                 when token in and out match
➤ [@balancer-labs/v2-vault]:                   ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                 when token in and out mismatch
➤ [@balancer-labs/v2-vault]:                   ✓ reverts 
➤ [@balancer-labs/v2-vault]:               with another pool
➤ [@balancer-labs/v2-vault]:                 with two tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a two token pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount  (256ms)
➤ [@balancer-labs/v2-vault]:                 with three tokens
➤ [@balancer-labs/v2-vault]:                   with a general pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:                   with a minimal swap info pool
➤ [@balancer-labs/v2-vault]:                     ✓ trades the expected amount 
➤ [@balancer-labs/v2-vault]:     when one of the assets is ETH
➤ [@balancer-labs/v2-vault]:       with minimal swap info pool
➤ [@balancer-labs/v2-vault]:         when the sender is the trader
➤ [@balancer-labs/v2-vault]:           ✓ received ETH is wrapped into WETH
➤ [@balancer-labs/v2-vault]:           ✓ sent WETH is unwrapped into ETH
➤ [@balancer-labs/v2-vault]:           ✓ emits an event with WETH as the token address
➤ [@balancer-labs/v2-vault]:           ✓ reverts if less ETH than required was supplied
➤ [@balancer-labs/v2-vault]:           ✓ returns excess ETH if more ETH than required was supplied
➤ [@balancer-labs/v2-vault]:         when the sender is an approved relayer
➤ [@balancer-labs/v2-vault]:           ✓ returns excess sent ETH to the relayer
➤ [@balancer-labs/v2-vault]:           ✓ returns unreceived ETH to the relayer
➤ [@balancer-labs/v2-vault]:       with general pool
➤ [@balancer-labs/v2-vault]:         when the sender is the trader
➤ [@balancer-labs/v2-vault]:           ✓ received ETH is wrapped into WETH
➤ [@balancer-labs/v2-vault]:           ✓ sent WETH is unwrapped into ETH (334ms)
➤ [@balancer-labs/v2-vault]:           ✓ emits an event with WETH as the token address
➤ [@balancer-labs/v2-vault]:           ✓ reverts if less ETH than required was supplied
➤ [@balancer-labs/v2-vault]:           ✓ returns excess ETH if more ETH than required was supplied
➤ [@balancer-labs/v2-vault]:         when the sender is an approved relayer
➤ [@balancer-labs/v2-vault]:           ✓ returns excess sent ETH to the relayer
➤ [@balancer-labs/v2-vault]:           ✓ returns unreceived ETH to the relayer
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   VaultAuthorization
➤ [@balancer-labs/v2-vault]:     authorizer
➤ [@balancer-labs/v2-vault]:       ✓ has an initial authorizer (368ms)
➤ [@balancer-labs/v2-vault]:       ✓ can be initialized to the zero address (410ms)
➤ [@balancer-labs/v2-vault]:     change authorizer
➤ [@balancer-labs/v2-vault]:       when the sender is has the permission to do it
➤ [@balancer-labs/v2-vault]:         ✓ can change the authorizer to another address
➤ [@balancer-labs/v2-vault]:         ✓ emits an event when authorizer changed
➤ [@balancer-labs/v2-vault]:         ✓ can change the authorizer to the zero address
➤ [@balancer-labs/v2-vault]:         ✓ can not change the authorizer if the permission was revoked
➤ [@balancer-labs/v2-vault]:       when the sender does not have the permission to do it
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]:     set relayer approval
➤ [@balancer-labs/v2-vault]:       when the sender is the user
➤ [@balancer-labs/v2-vault]:         when the relayer was not approved
➤ [@balancer-labs/v2-vault]:           ✓ sets the approval
➤ [@balancer-labs/v2-vault]:           ✓ emits an event when setting relayer approval
➤ [@balancer-labs/v2-vault]:           ✓ resets the approval
➤ [@balancer-labs/v2-vault]:           ✓ emits an event when resetting relayer approval
➤ [@balancer-labs/v2-vault]:         when the relayer was approved
➤ [@balancer-labs/v2-vault]:           ✓ sets the approval
➤ [@balancer-labs/v2-vault]:           ✓ emits an event when setting relayer approval
➤ [@balancer-labs/v2-vault]:           ✓ resets the approval
➤ [@balancer-labs/v2-vault]:           ✓ emits an event when resetting relayer approval
➤ [@balancer-labs/v2-vault]:       when the sender is not the user
➤ [@balancer-labs/v2-vault]:         when the sender is allowed by the authorizer
➤ [@balancer-labs/v2-vault]:           when the sender is approved by the user
➤ [@balancer-labs/v2-vault]:             when the relayer was not approved
➤ [@balancer-labs/v2-vault]:               ✓ sets the approval
➤ [@balancer-labs/v2-vault]:               ✓ emits an event when setting relayer approval
➤ [@balancer-labs/v2-vault]:               ✓ resets the approval
➤ [@balancer-labs/v2-vault]:               ✓ emits an event when resetting relayer approval
➤ [@balancer-labs/v2-vault]:             when the relayer was approved
➤ [@balancer-labs/v2-vault]:               ✓ sets the approval
➤ [@balancer-labs/v2-vault]:               ✓ emits an event when setting relayer approval
➤ [@balancer-labs/v2-vault]:               ✓ resets the approval
➤ [@balancer-labs/v2-vault]:               ✓ emits an event when resetting relayer approval
➤ [@balancer-labs/v2-vault]:           when the sender is not approved by the user
➤ [@balancer-labs/v2-vault]:             when the sender is allowed by signature
➤ [@balancer-labs/v2-vault]:               when the relayer was not approved
➤ [@balancer-labs/v2-vault]:                 ✓ sets the approval
➤ [@balancer-labs/v2-vault]:                 ✓ emits an event when setting relayer approval
➤ [@balancer-labs/v2-vault]:                 ✓ resets the approval
➤ [@balancer-labs/v2-vault]:                 ✓ emits an event when resetting relayer approval
➤ [@balancer-labs/v2-vault]:               when the relayer was approved
➤ [@balancer-labs/v2-vault]:                 ✓ sets the approval
➤ [@balancer-labs/v2-vault]:                 ✓ emits an event when setting relayer approval
➤ [@balancer-labs/v2-vault]:                 ✓ resets the approval
➤ [@balancer-labs/v2-vault]:                 ✓ emits an event when resetting relayer approval
➤ [@balancer-labs/v2-vault]:             with no signature
➤ [@balancer-labs/v2-vault]:               ✓ reverts
➤ [@balancer-labs/v2-vault]:         when the sender is not allowed by the authorizer
➤ [@balancer-labs/v2-vault]:           when the sender is approved by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:           when the sender is not approved by the user
➤ [@balancer-labs/v2-vault]:             ✓ reverts
➤ [@balancer-labs/v2-vault]:     temporarily pausable
➤ [@balancer-labs/v2-vault]:       when the sender has the permission to pause and unpause
➤ [@balancer-labs/v2-vault]:         ✓ can pause
➤ [@balancer-labs/v2-vault]:         ✓ can unpause
➤ [@balancer-labs/v2-vault]:         ✓ cannot pause if the permission is revoked
➤ [@balancer-labs/v2-vault]:       when the sender does not have the permission to unpause
➤ [@balancer-labs/v2-vault]:         ✓ reverts
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   balance allocation
➤ [@balancer-labs/v2-vault]:     cash, managed & last change block
➤ [@balancer-labs/v2-vault]:       ✓ stores zero balance
➤ [@balancer-labs/v2-vault]:       ✓ stores partial zero balances
➤ [@balancer-labs/v2-vault]:       ✓ stores non-zero balances
➤ [@balancer-labs/v2-vault]:       ✓ stores extreme cash
➤ [@balancer-labs/v2-vault]:       ✓ stores extreme managed
➤ [@balancer-labs/v2-vault]:       ✓ stores extreme balance
➤ [@balancer-labs/v2-vault]:       ✓ stores extreme block number
➤ [@balancer-labs/v2-vault]:       ✓ reverts on total overflow
➤ [@balancer-labs/v2-vault]:     cash
➤ [@balancer-labs/v2-vault]:       increase
➤ [@balancer-labs/v2-vault]:         ✓ increases cash by zero (267ms)
➤ [@balancer-labs/v2-vault]:         ✓ increases cash by non-zero (514ms)
➤ [@balancer-labs/v2-vault]:         ✓ increases cash to extreme amount
➤ [@balancer-labs/v2-vault]:         ✓ reverts on cash overflow
➤ [@balancer-labs/v2-vault]:         ✓ reverts on total overflow
➤ [@balancer-labs/v2-vault]:       decrease
➤ [@balancer-labs/v2-vault]:         ✓ decreases cash by zero (255ms)
➤ [@balancer-labs/v2-vault]:         ✓ decreases cash by non-zero (427ms)
➤ [@balancer-labs/v2-vault]:         ✓ decreases cash to zero
➤ [@balancer-labs/v2-vault]:         ✓ reverts on negative cash
➤ [@balancer-labs/v2-vault]:     managed
➤ [@balancer-labs/v2-vault]:       cash to managed
➤ [@balancer-labs/v2-vault]:         ✓ manages zero
➤ [@balancer-labs/v2-vault]:         ✓ manages non-zero
➤ [@balancer-labs/v2-vault]:         ✓ manages extreme amounts
➤ [@balancer-labs/v2-vault]:         ✓ reverts when transferring more cash than available
➤ [@balancer-labs/v2-vault]:       managed to cash
➤ [@balancer-labs/v2-vault]:         ✓ cashes out zero
➤ [@balancer-labs/v2-vault]:         ✓ cashes out non-zero
➤ [@balancer-labs/v2-vault]:         ✓ cashes out extreme amounts
➤ [@balancer-labs/v2-vault]:         ✓ reverts when cashing out more managed balance than available
➤ [@balancer-labs/v2-vault]:       set managed balance
➤ [@balancer-labs/v2-vault]:         ✓ sets managed to zero
➤ [@balancer-labs/v2-vault]:         ✓ sets managed to non-zero
➤ [@balancer-labs/v2-vault]:         ✓ sets managed to extreme value
➤ [@balancer-labs/v2-vault]:         ✓ reverts on total overflow
➤ [@balancer-labs/v2-vault]:     shared balances
➤ [@balancer-labs/v2-vault]:       ✓ packs and unpacks zero balances
➤ [@balancer-labs/v2-vault]:       ✓ packs and unpacks partial balances (535ms)
➤ [@balancer-labs/v2-vault]:       ✓ packs and unpacks extreme partial balances (620ms)
➤ [@balancer-labs/v2-vault]:       if A has a more recent last change block
➤ [@balancer-labs/v2-vault]:         ✓ stores the most recent last change block
➤ [@balancer-labs/v2-vault]:       if B has a more recent last change block
➤ [@balancer-labs/v2-vault]:         ✓ stores the most recent last change block
➤ [@balancer-labs/v2-vault]:     total balances
➤ [@balancer-labs/v2-vault]:       ✓ handles zero balances
➤ [@balancer-labs/v2-vault]:       ✓ handles normal values
➤ [@balancer-labs/v2-vault]:       ✓ handles extreme cash values
➤ [@balancer-labs/v2-vault]:       ✓ handles extreme managed values
➤ [@balancer-labs/v2-vault]:       ✓ handles extreme values
➤ [@balancer-labs/v2-vault]:     zeroed balances
➤ [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ [@balancer-labs/v2-vault]:       ✓ handles zeroed balances correctly
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]: 
➤ [@balancer-labs/v2-vault]:   2917 passing (9m)
➤ [@balancer-labs/v2-vault]: 
➤ Done in 12m 30s
```
