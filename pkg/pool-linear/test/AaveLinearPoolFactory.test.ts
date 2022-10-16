import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { fp, FP_ZERO } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT112 } from '@balancer-labs/v2-helpers/src/constants';
import { advanceTime, currentTimestamp, MONTH } from '@balancer-labs/v2-helpers/src/time';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';

describe('AaveLinearPoolFactory', function () {
  let vault: Vault, tokens: TokenList, factory: Contract;
  let creationTime: BigNumber, owner: SignerWithAddress;

  const NAME = 'Balancer Linear Pool Token';
  const SYMBOL = 'LPT';
  const UPPER_TARGET = fp(2000);
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  before('setup signers', async () => {
    [, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy factory & tokens', async () => {
    vault = await Vault.create();
    const queries = await deploy('v2-standalone-utils/BalancerQueries', { args: [vault.address] });
    factory = await deploy('AaveLinearPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address, queries.address],
    });
    creationTime = await currentTimestamp();

    const mainToken = await Token.create('DAI');
    const wrappedTokenInstance = await deploy('MockStaticAToken', { args: ['cDAI', 'cDAI', 18, mainToken.address] });
    const wrappedToken = await Token.deployedAt(wrappedTokenInstance.address);

    tokens = new TokenList([mainToken, wrappedToken]).sort();
  });

  async function createPool(): Promise<Contract> {
    const receipt = await factory.create(
      NAME,
      SYMBOL,
      tokens.DAI.address,
      tokens.CDAI.address,
      UPPER_TARGET,
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address
    );

    const event = expectEvent.inReceipt(await receipt.wait(), 'PoolCreated');
    return deployedAt('LinearPool', event.args.pool);
  }

  describe('constructor arguments', () => {
    let pool: Contract;

    sharedBeforeEach('create pool', async () => {
      pool = await createPool();
    });

    it('sets the vault', async () => {
      expect(await pool.getVault()).to.equal(vault.address);
    });

    it('registers tokens in the vault', async () => {
      const poolId = await pool.getPoolId();
      const poolTokens = await vault.getPoolTokens(poolId);

      expect(poolTokens.tokens).to.have.lengthOf(3);
      expect(poolTokens.tokens).to.include(tokens.DAI.address);
      expect(poolTokens.tokens).to.include(tokens.CDAI.address);
      expect(poolTokens.tokens).to.include(pool.address);

      poolTokens.tokens.forEach((token, i) => {
        expect(poolTokens.balances[i]).to.be.eq(token === pool.address ? MAX_UINT112 : 0);
      });
    });

    it('starts with all the BPT minted', async () => {
      expect(await pool.totalSupply()).to.be.equal(MAX_UINT112);
    });

    it('sets a rebalancer as the asset manager', async () => {
      const poolId = await pool.getPoolId();
      // We only check the first token, but this will be the asset manager for both main and wrapped
      const { assetManager } = await vault.getPoolTokenInfo(poolId, tokens.first);

      const rebalancer = await deployedAt('AaveLinearPoolRebalancer', assetManager);

      expect(await rebalancer.getPool()).to.equal(pool.address);
    });

    it('sets swap fee', async () => {
      expect(await pool.getSwapFeePercentage()).to.equal(POOL_SWAP_FEE_PERCENTAGE);
    });

    it('sets the owner ', async () => {
      expect(await pool.getOwner()).to.equal(owner.address);
    });

    it('sets the name', async () => {
      expect(await pool.name()).to.equal(NAME);
    });

    it('sets the symbol', async () => {
      expect(await pool.symbol()).to.equal(SYMBOL);
    });

    it('sets the decimals', async () => {
      expect(await pool.decimals()).to.equal(18);
    });

    it('sets main token', async () => {
      expect(await pool.getMainToken()).to.equal(tokens.DAI.address);
    });

    it('sets wrapped token', async () => {
      expect(await pool.getWrappedToken()).to.equal(tokens.CDAI.address);
    });

    it('sets the targets', async () => {
      const targets = await pool.getTargets();
      expect(targets.lowerTarget).to.be.equal(FP_ZERO);
      expect(targets.upperTarget).to.be.equal(UPPER_TARGET);
    });
  });

  describe('with a created pool', () => {
    let pool: Contract;

    sharedBeforeEach('create pool', async () => {
      pool = await createPool();
    });

    it('returns the address of the last pool created by the factory', async () => {
      expect(await factory.getLastCreatedPool()).to.equal(pool.address);
    });
  });

  describe('temporarily pausable', () => {
    it('pools have the correct window end times', async () => {
      const pool = await createPool();
      const { pauseWindowEndTime, bufferPeriodEndTime } = await pool.getPausedState();

      expect(pauseWindowEndTime).to.equal(creationTime.add(BASE_PAUSE_WINDOW_DURATION));
      expect(bufferPeriodEndTime).to.equal(creationTime.add(BASE_PAUSE_WINDOW_DURATION + BASE_BUFFER_PERIOD_DURATION));
    });

    it('multiple pools have the same window end times', async () => {
      const firstPool = await createPool();
      await advanceTime(BASE_PAUSE_WINDOW_DURATION / 3);
      const secondPool = await createPool();

      const { firstPauseWindowEndTime, firstBufferPeriodEndTime } = await firstPool.getPausedState();
      const { secondPauseWindowEndTime, secondBufferPeriodEndTime } = await secondPool.getPausedState();

      expect(firstPauseWindowEndTime).to.equal(secondPauseWindowEndTime);
      expect(firstBufferPeriodEndTime).to.equal(secondBufferPeriodEndTime);
    });

    it('pools created after the pause window end date have no buffer period', async () => {
      await advanceTime(BASE_PAUSE_WINDOW_DURATION + 1);

      const pool = await createPool();
      const { pauseWindowEndTime, bufferPeriodEndTime } = await pool.getPausedState();
      const now = await currentTimestamp();

      expect(pauseWindowEndTime).to.equal(now);
      expect(bufferPeriodEndTime).to.equal(now);
    });
  });
});
