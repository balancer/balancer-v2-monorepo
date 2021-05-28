import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime, currentTimestamp, MONTH } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { toNormalizedWeights } from '@balancer-labs/v2-helpers/src/models/pools/weighted/misc';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('WeightedPoolFactory', function () {
  let tokens: TokenList;
  let factory: Contract;
  let vault: Vault;
  let assetManagers: string[];
  let assetManager: SignerWithAddress;

  const NAME = 'Balancer Pool Token';
  const SYMBOL = 'BPT';
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = toNormalizedWeights([fp(30), fp(70), fp(5), fp(5)]);

  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  let createTime: BigNumber;

  before('setup signers', async () => {
    [, assetManager] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy factory & tokens', async () => {
    vault = await Vault.create();

    factory = await deploy('WeightedPoolFactory', { args: [vault.address] });
    createTime = await currentTimestamp();

    tokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });

    assetManagers = Array(tokens.length).fill(assetManager.address);
  });

  async function createPool(): Promise<Contract> {
    const receipt = await (
      await factory.create(
        NAME,
        SYMBOL,
        tokens.addresses,
        WEIGHTS,
        assetManagers,
        POOL_SWAP_FEE_PERCENTAGE,
        ZERO_ADDRESS
      )
    ).wait();

    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    return deployedAt('WeightedPool', event.args.pool);
  }

  describe('temporarily pausable', () => {
    it('pools have the correct window end times', async () => {
      const pool = await createPool();
      const { pauseWindowEndTime, bufferPeriodEndTime } = await pool.getPausedState();

      expect(pauseWindowEndTime).to.equal(createTime.add(BASE_PAUSE_WINDOW_DURATION));
      expect(bufferPeriodEndTime).to.equal(createTime.add(BASE_PAUSE_WINDOW_DURATION + BASE_BUFFER_PERIOD_DURATION));
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

    it('has asset managers', async () => {
      const pool = await createPool();
      const poolId = await pool.getPoolId();

      await tokens.asyncEach(async (token) => {
        const info = await vault.getPoolTokenInfo(poolId, token);
        expect(info.assetManager).to.equal(assetManager.address);
      });
    });
  });
});
