import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('IdleLinearPool', function () {  
  let vault: Vault;
  let pool: LinearPool, tokens: TokenList, token: Token, wrappedYieldToken: Token;
  let poolFactory: Contract;
  let wrappedYieldTokenInstance: Contract;
  let trader: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  before('setup', async () => {
    [, lp, trader, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    token = await Token.create({ symbol: 'USDC', decimals: 6 });
    wrappedYieldTokenInstance = await deploy('MockIdleTokenV3_1', {
      args: ['idleUSDC', 'idleUSDC', 18, token.address],
    });
    wrappedYieldToken = await Token.deployedAt(wrappedYieldTokenInstance.address);

    tokens = new TokenList([token, wrappedYieldToken]).sort();

    await tokens.mint({ to: [lp, trader], amount: fp(100) });
  });

  sharedBeforeEach('deploy pool factory', async () => {
    vault = await Vault.create();
    const queries = await deploy('v2-standalone-utils/BalancerQueries', { args: [vault.address] });
    poolFactory = await deploy('IdleLinearPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address, queries.address],
    });
  });

  sharedBeforeEach('deploy and initialize pool', async () => {
    const tx = await poolFactory.create(
      'Balancer Pool Token',
      'BPT',
      token.address,
      wrappedYieldToken.address,
      bn(0),
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    pool = await LinearPool.deployedAt(event.args.pool);
  });

  describe('asset managers', () => {
    it('sets the same asset manager for main and wrapped token', async () => {
      const poolId = await pool.getPoolId();

      const { assetManager: firstAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.first);
      const { assetManager: secondAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.second);

      expect(firstAssetManager).to.equal(secondAssetManager);
    });

    it('sets the no asset manager for the BPT', async () => {
      const poolId = await pool.getPoolId();
      const { assetManager } = await vault.instance.getPoolTokenInfo(poolId, pool.address);
      expect(assetManager).to.equal(ZERO_ADDRESS);
    });
  });

  describe('getWrappedTokenRate', () => {
    it('returns the expected value', async () => {
      // Reserve's normalised income is stored with 27 decimals (i.e. a 'ray' value)
      // 1e27 implies a 1:1 exchange rate between main and wrapped token
      await wrappedYieldTokenInstance.setRate(bn(1e6));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1));

      // We now double the reserve's normalised income to change the exchange rate to 2:1
      await wrappedYieldTokenInstance.setRate(bn(2e6));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2));
    });
  });

  describe('constructor', () => {
    it('reverts if the mainToken is not the ASSET of the wrappedToken', async () => {
      const otherToken = await Token.create('DAI');

      await expect(
        poolFactory.create(
          'Balancer Pool Token',
          'BPT',
          otherToken.address,
          wrappedYieldToken.address,
          bn(0),
          POOL_SWAP_FEE_PERCENTAGE,
          owner.address
        )
      ).to.be.revertedWith('TOKENS_MISMATCH');
    });
  });
});
