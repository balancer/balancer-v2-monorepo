import { ethers } from 'hardhat';
import { Contract, BigNumber } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { advanceTime, currentTimestamp } from '@balancer-labs/v2-helpers/src/time';
import { setup, rewardsDuration } from './MultiRewardsSharedSetup';

describe('Rewards Scheduler', () => {
  let admin: SignerWithAddress, lp: SignerWithAddress, rewarder: SignerWithAddress;

  let rewardTokens: TokenList;
  let vault: Contract;
  let stakingContract: Contract;
  let rewardsScheduler: Contract;
  let rewardsToken: Token;
  let pool: Contract;

  before('deploy base contracts', async () => {
    [admin, , lp, , rewarder] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager and mock callback', async () => {
    const { contracts } = await setup();

    pool = contracts.pool;
    vault = contracts.vault;
    stakingContract = contracts.stakingContract;
    rewardsToken = contracts.rewardTokens.DAI;
    rewardTokens = contracts.rewardTokens;

    rewardsScheduler = await deploy('RewardsScheduler', { args: [stakingContract.address] });

    await rewardTokens.approve({ to: rewardsScheduler.address, from: [rewarder] });

    stakingContract.connect(admin).setRewardsScheduler(rewardsScheduler.address);

    await stakingContract.connect(admin).allowlistRewarder(pool.address, rewardsToken.address, rewarder.address);
    await stakingContract.connect(rewarder).addReward(pool.address, rewardsToken.address, rewardsDuration);
  });

  it('allows an allowlisted rewarder to schedule a reward', async () => {
    const time = (await currentTimestamp()).add(3600 * 24);
    const rewardAmount = fp(1);

    await expectBalanceChange(
      () => rewardsScheduler.connect(rewarder).scheduleReward(pool.address, rewardsToken.address, rewardAmount, time),
      rewardTokens,
      [{ account: rewardsScheduler.address, changes: { DAI: rewardAmount } }]
    );
  });

  it('emits RewardScheduled', async () => {
    const time = (await currentTimestamp()).add(3600 * 24);
    const rewardAmount = fp(1);

    const receipt = await (
      await rewardsScheduler.connect(rewarder).scheduleReward(pool.address, rewardsToken.address, rewardAmount, time)
    ).wait();

    const rewardId = await rewardsScheduler.getRewardId(pool.address, rewardsToken.address, rewarder.address, time);

    expectEvent.inReceipt(receipt, 'RewardScheduled', {
      rewardId,
      scheduler: rewarder.address,
      rewardsToken: rewardsToken.address,
      startTime: time,
    });
  });

  it('prevents an unallowlisted rewarder to schedule a reward', async () => {
    const time = (await currentTimestamp()).add(3600 * 24);
    const rewardAmount = fp(1);
    await expect(
      rewardsScheduler.connect(lp).scheduleReward(pool.address, rewardsToken.address, rewardAmount, time)
    ).to.be.revertedWith('only allowlisted rewarders can schedule reward');
  });

  describe('with a scheduled reward', () => {
    const rewardAmount = fp(1);
    let rewardId: string;
    let time: BigNumber;

    sharedBeforeEach(async () => {
      // reward duration is important.  These tests assume a very short duration
      time = (await currentTimestamp()).add(3600 * 24);
      await rewardsScheduler.connect(rewarder).scheduleReward(pool.address, rewardsToken.address, rewardAmount, time);

      rewardId = await rewardsScheduler.getRewardId(pool.address, rewardsToken.address, rewarder.address, time);
    });

    it('doesnt reward before time has passed', async () => {
      await expect(rewardsScheduler.connect(lp).poke([rewardId])).to.be.revertedWith('reward cannot be started');
    });

    it('allows you to unschedule a reward that hasnt started', async () => {
      await expectBalanceChange(() => rewardsScheduler.connect(rewarder).unscheduleReward(rewardId), rewardTokens, [
        { account: rewarder.address, changes: { DAI: ['very-near', fp(1)] } },
      ]);
    });

    it('emits RewardUnscheduled', async () => {
      const receipt = await (await rewardsScheduler.connect(rewarder).unscheduleReward(rewardId)).wait();

      expectEvent.inReceipt(receipt, 'RewardUnscheduled', {
        rewardId,
        scheduler: rewarder.address,
        rewardsToken: rewardsToken.address,
        startTime: time,
      });
    });

    describe('when time has passed', async () => {
      sharedBeforeEach(async () => {
        await advanceTime(3600 * 25);
      });

      it('allows anyone to poke the contract to notify the staking contract and transfer rewards', async () => {
        const expectedReward = fp(1);

        await expectBalanceChange(
          () => rewardsScheduler.connect(lp).poke([rewardId]),
          rewardTokens,
          [{ account: stakingContract.address, changes: { DAI: ['very-near', expectedReward] } }],
          vault
        );
      });

      it('emits RewardAdded in MultiRewards', async () => {
        const receipt = await (await rewardsScheduler.connect(lp).poke([rewardId])).wait();

        expectEvent.inIndirectReceipt(receipt, stakingContract.interface, 'RewardAdded', {
          token: rewardsToken.address,
          amount: rewardAmount,
        });
      });

      it('prevents unscheduling a reward that is past its start time', async () => {
        await expect(rewardsScheduler.connect(rewarder).unscheduleReward(rewardId)).to.be.revertedWith(
          'reward cannot be cancelled once reward period has begun'
        );
      });
    });
  });
});
