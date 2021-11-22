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
import { setup, rewardsDuration } from './MultiDistributorSharedSetup';
import { ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';

describe('Rewards Scheduler', () => {
  let lp: SignerWithAddress, distributionOwner: SignerWithAddress;

  let rewardTokens: TokenList;
  let vault: Contract;
  let stakingContract: Contract;
  let rewardsScheduler: Contract;
  let rewardsToken: Token;
  let pool: Contract;

  sharedBeforeEach('set up asset manager and mock callback', async () => {
    const { contracts, users } = await setup();

    pool = contracts.pool;
    vault = contracts.vault;
    stakingContract = contracts.stakingContract;
    rewardsToken = contracts.rewardTokens.DAI;
    rewardTokens = contracts.rewardTokens;

    lp = users.lp;
    distributionOwner = users.rewarder;

    rewardsScheduler = await deploy('RewardsScheduler', { args: [stakingContract.address] });

    await rewardTokens.approve({ to: rewardsScheduler.address, from: [distributionOwner] });

    await stakingContract
      .connect(distributionOwner)
      .createDistribution(pool.address, rewardsToken.address, rewardsDuration);
  });

  it('allows anyone to schedule a reward', async () => {
    const time = (await currentTimestamp()).add(3600 * 24);
    const rewardAmount = fp(1);

    await expectBalanceChange(
      () =>
        rewardsScheduler
          .connect(distributionOwner)
          .scheduleDistribution(ZERO_BYTES32, pool.address, rewardsToken.address, rewardAmount, time),
      rewardTokens,
      [{ account: rewardsScheduler.address, changes: { DAI: rewardAmount } }]
    );
  });

  it('emits DistributionScheduled', async () => {
    const time = (await currentTimestamp()).add(3600 * 24);
    const rewardAmount = fp(1);

    const receipt = await (
      await rewardsScheduler
        .connect(distributionOwner)
        .scheduleDistribution(ZERO_BYTES32, pool.address, rewardsToken.address, rewardAmount, time)
    ).wait();

    const rewardId = await rewardsScheduler.claimId(
      pool.address,
      rewardsToken.address,
      distributionOwner.address,
      time
    );

    expectEvent.inReceipt(receipt, 'DistributionScheduled', {
      rewardId,
      owner: distributionOwner.address,
      distributionToken: rewardsToken.address,
      startTime: time,
      amount: rewardAmount,
    });
  });

  describe('with a scheduled reward', () => {
    const rewardAmount = fp(1);
    let rewardId: string;
    let time: BigNumber;

    sharedBeforeEach(async () => {
      // reward duration is important.  These tests assume a very short duration
      time = (await currentTimestamp()).add(3600 * 24);
      await rewardsScheduler
        .connect(distributionOwner)
        .scheduleDistribution(ZERO_BYTES32, pool.address, rewardsToken.address, rewardAmount, time);

      rewardId = await rewardsScheduler.claimId(pool.address, rewardsToken.address, distributionOwner.address, time);
    });

    it('doesnt reward before time has passed', async () => {
      await expect(rewardsScheduler.connect(lp).startRewards([rewardId])).to.be.revertedWith(
        'Reward start time is in the future'
      );
    });

    it('responds to getScheduledDistributionInfo', async () => {
      const response = await rewardsScheduler.getScheduledDistributionInfo(rewardId);

      expect(response.stakingToken).to.equal(pool.address);
      expect(response.distributionToken).to.equal(rewardsToken.address);
      expect(response.startTime).to.equal(time);
      expect(response.owner).to.equal(distributionOwner.address);
      expect(response.amount).to.equal(rewardAmount);
      expect(response.status).to.equal(1);
    });

    // TODO: Re-think rewards scheduler
    describe.skip('when time has passed', async () => {
      sharedBeforeEach(async () => {
        await advanceTime(3600 * 25);
      });

      it('allows anyone to poke the contract to notify the staking contract and transfer rewards', async () => {
        const expectedReward = fp(1);

        await expectBalanceChange(
          () => rewardsScheduler.connect(lp).startDistribution([rewardId]),
          rewardTokens,
          [{ account: stakingContract.address, changes: { DAI: ['very-near', expectedReward] } }],
          vault
        );
      });

      it('emits DistributionStarted', async () => {
        const receipt = await (await rewardsScheduler.connect(lp).startRewards([rewardId])).wait();

        expectEvent.inReceipt(receipt, 'DistributionStarted', {
          rewardId,
          owner: distributionOwner.address,
          stakingToken: pool.address,
          distributionToken: rewardsToken.address,
          startTime: time,
          amount: rewardAmount,
        });
      });

      it('emits RewardAdded in MultiDistributor', async () => {
        const receipt = await (await rewardsScheduler.connect(lp).startDistribution([rewardId])).wait();

        expectEvent.inIndirectReceipt(receipt, stakingContract.interface, 'RewardAdded', {
          distributionToken: rewardsToken.address,
          amount: rewardAmount,
        });
      });

      describe('and a reward has been started', async () => {
        sharedBeforeEach(async () => {
          await rewardsScheduler.connect(lp).startDistribution([rewardId]);
        });

        it('cannot be started again', async () => {
          await expect(rewardsScheduler.connect(lp).startDistribution([rewardId])).to.be.revertedWith(
            'Reward cannot be started'
          );
        });

        it('has reward status set to STARTED', async () => {
          const response = await rewardsScheduler.getScheduledDistributionInfo(rewardId);
          expect(response.status).to.equal(2);
        });
      });
    });
  });
});
