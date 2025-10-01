import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';

describe('Read-Only Reentrancy Protection', () => {
  let admin: SignerWithAddress, attacker: SignerWithAddress;
  let vault: Contract, pool: Contract;
  let tokens: TokenList;
  let poolId: string;
  let maliciousContract: Contract;

  before(async () => {
    [, admin, attacker] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    ({ instance: vault } = await Vault.create({
      admin,
      pauseWindowDuration: MONTH,
      bufferPeriodDuration: MONTH,
    }));

    tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });
    await tokens.mint({ to: [attacker], amount: bn(100e18) });
    await tokens.approve({ to: vault, from: [attacker] });

    // Deploy pool
    pool = await deploy('MockPool', { args: [vault.address, PoolSpecialization.TwoTokenPool] });
    poolId = await pool.getPoolId();
    await pool.registerTokens(tokens.addresses, [ZERO_ADDRESS, ZERO_ADDRESS]);

    // Initialize pool with some liquidity
    await vault.connect(attacker).joinPool(poolId, attacker.address, ZERO_ADDRESS, {
      assets: tokens.addresses,
      maxAmountsIn: [MAX_UINT256, MAX_UINT256],
      fromInternalBalance: false,
      userData: encodeJoin([bn(50e18), bn(50e18)], [0, 0]),
    });
  });

  sharedBeforeEach('deploy malicious contract', async () => {
    // This contract will attempt to exploit read-only reentrancy
    const ReentrancyAttack = await ethers.getContractFactory('ReentrancyAttack');
    maliciousContract = await ReentrancyAttack.deploy(vault.address, poolId, pool.address);
    await maliciousContract.deployed();

    // Fund the malicious contract.
    await tokens.mint({ to: [maliciousContract.address], amount: bn(100e18) });

    // Approve vault to spend the malicious contract's tokens.
    await maliciousContract.approveVault(tokens.addresses);
  });

  it('prevents read-only reentrancy via ETH return callback', async () => {
    // The malicious contract will:
    // 1. Join the pool with ETH.
    // 2. Receive callback when excess ETH is returned.
    // 3. Try to read pool balances during callback (before storage update in old code).
    // 4. In the old code, we would see an inconsistent state (BPT minted but balances not updated).
    // 5. In the fixed code, storage is updated before the callback, so the state is consistent.

    // Store initial pool token info.
    const { balances: initialBalances } = await vault.getPoolTokens(poolId);
    const initialSupply = await pool.totalSupply();

    // Attempt the attack.
    await expect(
      maliciousContract.connect(attacker).attemptReadOnlyReentrancy({
        value: ethers.utils.parseEther('1.0'),
      })
    ).to.not.be.reverted;

    // Verify that the attack didn't succeed in creating inconsistent state
    const { balances: finalBalances } = await vault.getPoolTokens(poolId);
    const finalSupply = await pool.totalSupply();

    // Check that the callback saw a consistent state.
    expect(await maliciousContract.consistentState()).to.be.true;

    // Balances should be properly updated
    expect(finalBalances[0]).to.be.gt(initialBalances[0]);
    expect(finalBalances[1]).to.be.gt(initialBalances[1]);
    expect(finalSupply).to.be.gt(initialSupply);
  });

  it('maintains consistent state between BPT supply and balances during callbacks', async () => {
    // This test verifies that when the callback is triggered:
    // - The pool's BPT totalSupply (updated in pool contract during onJoinPool).
    // - The pool's token balances (updated in Vault storage).
    // In the fixed version, BOTH are updated before the callback happens.
    // In the vulnerable version, the supply would be updated, but the balances would be stale.

    // Get the state before joining.
    const { balances: initialBalances } = await vault.getPoolTokens(poolId);
    const initialSupply = await pool.totalSupply();

    // The malicious contract will record the state during callback.
    await maliciousContract.connect(attacker).attemptReadOnlyReentrancy({
      value: ethers.utils.parseEther('0.1'),
    });

    // Get the state that was observed during the callback.
    const callbackSupply = await maliciousContract.supplyDuringCallback();
    const callbackBalances = await maliciousContract.balancesDuringCallback();

    // Get the state after the full transaction.
    const finalSupply = await pool.totalSupply();
    const { balances: finalBalances } = await vault.getPoolTokens(poolId);

    // In the fixed version:
    // - Both supply and balances should be updated during the callback.
    // - So callback values should equal final values.
    expect(callbackSupply).to.equal(finalSupply);
    expect(callbackBalances[0]).to.equal(finalBalances[0]);
    expect(callbackBalances[1]).to.equal(finalBalances[1]);

    // Also verify they changed from the initial values (i.e., the join actually happened).
    expect(finalSupply).to.be.gt(initialSupply);
    expect(finalBalances[0]).to.be.gt(initialBalances[0]);
    expect(finalBalances[1]).to.be.gt(initialBalances[1]);
  });
});
