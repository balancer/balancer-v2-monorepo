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
import { ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import { MultiDistributor } from './helpers/MultiDistributor';

describe('Distribution Scheduler', () => {
  let vault: Contract;
  let distributor: MultiDistributor;
  let scheduler: Contract;

  let stakingToken: Token, stakingTokens: TokenList;
  let distributionToken: Token, distributionTokens: TokenList;

  let distributionOwner: SignerWithAddress, poker: SignerWithAddress;

  before('setup signers', async () => {
    [, distributionOwner, poker] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy distributor', async () => {
    distributor = await MultiDistributor.create();
    scheduler = await deploy('DistributionScheduler', { args: [distributor.address] });
    vault = distributor.vault;
  });

  sharedBeforeEach('deploy tokens', async () => {
    stakingTokens = await TokenList.create(1);
    stakingToken = stakingTokens.first;

    distributionTokens = await TokenList.create(1);
    distributionToken = distributionTokens.first;

    await distributionTokens.mint({ to: distributionOwner });
    await distributionTokens.approve({ to: scheduler, from: distributionOwner });
  });

  it('allows anyone to schedule a reward', async () => {
    const time = (await currentTimestamp()).add(3600 * 24);
    const amount = fp(1);

    await expectBalanceChange(
      () =>
        scheduler
          .connect(distributionOwner)
          .scheduleDistribution(ZERO_BYTES32, stakingToken.address, distributionToken.address, amount, time),
      distributionTokens,
      [{ account: scheduler.address, changes: { [distributionToken.symbol]: amount } }]
    );
  });

  it('emits DistributionScheduled', async () => {
    const time = (await currentTimestamp()).add(3600 * 24);
    const amount = fp(1);

    const receipt = await (
      await scheduler
        .connect(distributionOwner)
        .scheduleDistribution(ZERO_BYTES32, stakingToken.address, distributionToken.address, amount, time)
    ).wait();

    const scheduleId = await scheduler.getScheduleId(
      stakingToken.address,
      distributionToken.address,
      distributionOwner.address,
      time
    );

    expectEvent.inReceipt(receipt, 'DistributionScheduled', {
      scheduleId,
      owner: distributionOwner.address,
      distributionToken: distributionToken.address,
      startTime: time,
      amount: amount,
    });
  });

  describe('with a scheduled reward', () => {
    const amount = fp(1);
    let scheduleId: string;
    let time: BigNumber;

    sharedBeforeEach(async () => {
      // reward duration is important.  These tests assume a very short duration
      time = (await currentTimestamp()).add(3600 * 24);
      await scheduler
        .connect(distributionOwner)
        .scheduleDistribution(ZERO_BYTES32, stakingToken.address, distributionToken.address, amount, time);

      scheduleId = await scheduler.getScheduleId(
        stakingToken.address,
        distributionToken.address,
        distributionOwner.address,
        time
      );
    });

    it("doesn't start distribution before time has passed", async () => {
      await expect(scheduler.connect(poker).startDistributions([scheduleId])).to.be.revertedWith(
        'Distribution start time is in the future'
      );
    });

    it('responds to getScheduledDistributionInfo', async () => {
      const response = await scheduler.getScheduledDistributionInfo(scheduleId);

      expect(response.stakingToken).to.equal(stakingToken.address);
      expect(response.distributionToken).to.equal(distributionToken.address);
      expect(response.startTime).to.equal(time);
      expect(response.owner).to.equal(distributionOwner.address);
      expect(response.amount).to.equal(amount);
      expect(response.status).to.equal(1);
    });

    // TODO: Re-think rewards scheduler
    describe.skip('when time has passed', async () => {
      sharedBeforeEach(async () => {
        await advanceTime(3600 * 25);
      });

      it('allows anyone to poke the contract to notify the staking contract and transfer rewards', async () => {
        await expectBalanceChange(
          () => scheduler.connect(poker).startDistribution([scheduleId]),
          distributionTokens,
          [{ account: distributor.address, changes: { DAI: ['very-near', amount] } }],
          vault
        );
      });

      it('emits DistributionStarted', async () => {
        const receipt = await (await scheduler.connect(poker).startDistributions([scheduleId])).wait();

        expectEvent.inReceipt(receipt, 'DistributionStarted', {
          scheduleId,
          owner: distributionOwner.address,
          stakingToken: stakingToken.address,
          distributionToken: distributionToken.address,
          startTime: time,
          amount: amount,
        });
      });

      it('emits RewardAdded in MultiDistributor', async () => {
        const receipt = await (await scheduler.connect(poker).startDistribution([scheduleId])).wait();

        expectEvent.inIndirectReceipt(receipt, distributor.instance.interface, 'RewardAdded', {
          distributionToken: distributionToken.address,
          amount: amount,
        });
      });

      describe('and a reward has been started', async () => {
        sharedBeforeEach(async () => {
          await scheduler.connect(poker).startDistribution([scheduleId]);
        });

        it('cannot be started again', async () => {
          await expect(scheduler.connect(poker).startDistribution([scheduleId])).to.be.revertedWith(
            'Reward cannot be started'
          );
        });

        it('has reward status set to STARTED', async () => {
          const response = await scheduler.getScheduledDistributionInfo(scheduleId);
          expect(response.status).to.equal(2);
        });
      });
    });
  });
});
