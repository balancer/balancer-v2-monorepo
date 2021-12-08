import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { advanceTime, DAY, fromNow, HOUR } from '@balancer-labs/v2-helpers/src/time';
import { MultiDistributor } from '@balancer-labs/v2-helpers/src/models/distributor/MultiDistributor';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

enum DistributionStatus {
  UNINITIALIZED,
  PENDING,
  STARTED,
  CANCELLED,
}

describe('Distribution Scheduler', () => {
  let vault: Vault;
  let distributor: MultiDistributor;
  let scheduler: Contract;

  let tokens: TokenList;
  let stakingToken: Token;
  let distributionToken: Token;

  let distributionOwner: SignerWithAddress, other: SignerWithAddress;
  let distributionId: string;

  before('setup signers', async () => {
    [, distributionOwner, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy distributor', async () => {
    vault = await Vault.create();
    distributor = await MultiDistributor.create(vault);
    scheduler = await deploy('DistributionScheduler', { args: [distributor.address] });
  });

  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(2);
    [stakingToken, distributionToken] = tokens.tokens;

    await distributionToken.mint(distributionOwner);
    await distributionToken.approve(scheduler, MAX_UINT256, { from: distributionOwner });
  });

  sharedBeforeEach('create distribution channel', async () => {
    await distributor.newDistribution(stakingToken, distributionToken, 100, { from: distributionOwner });
    distributionId = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
  });

  sharedBeforeEach('approve scheduler', async () => {
    const fundRole = await actionId(distributor.instance, 'fundDistribution');
    await vault.grantRoleGlobally(fundRole, scheduler);

    await vault.setRelayerApproval(distributionOwner, scheduler, true);
  });

  describe('scheduleDistribution', () => {
    const amount = fp(1);

    it('creates a scheduled distribution', async () => {
      const distributionStartTime = await fromNow(DAY);
      const tx = await scheduler
        .connect(distributionOwner)
        .scheduleDistribution(distributionId, amount, distributionStartTime);

      const event = expectEvent.inReceipt(await tx.wait(), 'DistributionScheduled');

      const response = await scheduler.getScheduledDistributionInfo(event.args.scheduleId);

      expect(response.distributionId).to.equal(distributionId);
      expect(response.startTime).to.equal(distributionStartTime);
      expect(response.amount).to.equal(amount);
      expect(response.status).to.equal(DistributionStatus.PENDING);
    });

    it('transfers distributionTokens to the scheduler', async () => {
      const distributionStartTime = await fromNow(DAY);

      await expectBalanceChange(
        () => scheduler.connect(distributionOwner).scheduleDistribution(distributionId, amount, distributionStartTime),
        tokens,
        [
          { account: scheduler.address, changes: { [distributionToken.symbol]: amount } },
          { account: distributionOwner.address, changes: { [distributionToken.symbol]: amount.mul(-1) } },
        ]
      );
    });

    it('emits a DistributionScheduled event', async () => {
      const distributionStartTime = await fromNow(DAY);

      const receipt = await (
        await scheduler.connect(distributionOwner).scheduleDistribution(distributionId, amount, distributionStartTime)
      ).wait();

      const scheduleId = await scheduler.getScheduleId(distributionId, distributionStartTime);

      expectEvent.inReceipt(receipt, 'DistributionScheduled', {
        distributionId,
        scheduleId,
        startTime: distributionStartTime,
        amount: amount,
      });
    });
  });

  describe('startDistributions', () => {
    const amount = fp(1);

    context('when distribution is pending', () => {
      let scheduleId: string;
      let distributionStartTime: BigNumber;
      sharedBeforeEach(async () => {
        distributionStartTime = await fromNow(DAY);
        await scheduler.connect(distributionOwner).scheduleDistribution(distributionId, amount, distributionStartTime);

        scheduleId = await scheduler.getScheduleId(distributionId, distributionStartTime);
      });

      context('when start time has passed', () => {
        sharedBeforeEach(async () => {
          await advanceTime(DAY + HOUR);
        });

        it('allows anyone to poke the contract to notify the staking contract and transfer rewards', async () => {
          await expectBalanceChange(
            () => scheduler.connect(other).startDistributions([scheduleId]),
            tokens,
            [{ account: distributor.address, changes: { [distributionToken.symbol]: amount } }],
            vault.instance
          );
        });

        it('emits DistributionStarted', async () => {
          const receipt = await (await scheduler.connect(other).startDistributions([scheduleId])).wait();

          expectEvent.inReceipt(receipt, 'DistributionStarted', {
            distributionId,
            scheduleId,
            startTime: distributionStartTime,
            amount: amount,
          });
        });

        it('emits DistributionFunded in MultiDistributor', async () => {
          const receipt = await (await scheduler.connect(other).startDistributions([scheduleId])).wait();

          expectEvent.inIndirectReceipt(receipt, distributor.instance.interface, 'DistributionFunded', {
            distribution: distributionId,
            amount: amount,
          });
        });

        it('marks scheduled distribution as STARTED', async () => {
          await scheduler.connect(other).startDistributions([scheduleId]);

          const response = await scheduler.getScheduledDistributionInfo(scheduleId);
          expect(response.status).to.equal(DistributionStatus.STARTED);
        });
      });

      context('when start time has not passed', () => {
        it('reverts', async () => {
          await expect(scheduler.connect(other).startDistributions([scheduleId])).to.be.revertedWith(
            'Distribution start time is in the future'
          );
        });
      });
    });

    context('when distribution has been started', () => {
      let scheduleId: string;
      sharedBeforeEach(async () => {
        const distributionStartTime = await fromNow(DAY);
        await scheduler.connect(distributionOwner).scheduleDistribution(distributionId, amount, distributionStartTime);

        scheduleId = await scheduler.getScheduleId(distributionId, distributionStartTime);
        await advanceTime(DAY + HOUR);
        await scheduler.connect(other).startDistributions([scheduleId]);
      });

      it('skips the distribution', async () => {
        const receipt = await (await scheduler.connect(other).startDistributions([scheduleId])).wait();

        await expectEvent.notEmitted(receipt, 'DistributionStarted');
      });
    });
  });
});
