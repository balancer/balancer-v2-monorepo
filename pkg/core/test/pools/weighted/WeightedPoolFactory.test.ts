import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime, currentTimestamp, MONTH } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '../../helpers/expectEvent';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { deploy } from '@balancer-labs/v2-helpers/src/deploy';

import Vault from '../../helpers/models/vault/Vault';
import TokenList from '../../helpers/models/tokens/TokenList';
import { toNormalizedWeights } from '@balancer-labs/v2-helpers/src/weights';

describe('WeightedPoolFactory', function () {
  let tokens: TokenList;
  let factory: Contract;

  const NAME = 'Balancer Pool Token';
  const SYMBOL = 'BPT';
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = toNormalizedWeights([fp(30), fp(70), fp(5), fp(5)]);

  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  let createTime: BigNumber;

  sharedBeforeEach('deploy factory & tokens', async () => {
    const vault = await Vault.create();

    factory = await deploy('WeightedPoolFactory', { args: [vault.address] });
    createTime = await currentTimestamp();

    tokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });
  });

  async function createPool(): Promise<Contract> {
    const receipt = await (
      await factory.create(NAME, SYMBOL, tokens.addresses, WEIGHTS, POOL_SWAP_FEE_PERCENTAGE, ZERO_ADDRESS)
    ).wait();

    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    return ethers.getContractAt('WeightedPool', event.args.pool);
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
  });
});
