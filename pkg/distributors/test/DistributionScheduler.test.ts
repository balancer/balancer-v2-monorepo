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
import { MAX_UINT256, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

enum DistributionStatus {
  UNINITIALIZED,
  PENDING,
  STARTED,
  CANCELLED,
}

const DISTRIBUTION_AMOUNT = fp(1);

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
    await vault.grantPermissionsGlobally([fundRole], scheduler);

    await vault.setRelayerApproval(distributionOwner, scheduler, true);
  });

  describe('scheduleDistribution', () => {
    const distributionStartTime = MAX_UINT256;

    context('when called by the distribution owner', () => {
      context('when scheduling a distribution for the future', () => {
        context('when there is no conflicting distribution', () => {
          it('creates a scheduled distribution', async () => {
            const tx = await scheduler
              .connect(distributionOwner)
              .scheduleDistribution(distributionId, DISTRIBUTION_AMOUNT, distributionStartTime);

            const event = expectEvent.inReceipt(await tx.wait(), 'DistributionScheduled');

            const response = await scheduler.getScheduledDistributionInfo(event.args.scheduleId);

            expect(response.distributionId).to.equal(distributionId);
            expect(response.startTime).to.equal(distributionStartTime);
            expect(response.amount).to.equal(DISTRIBUTION_AMOUNT);
            expect(response.status).to.equal(DistributionStatus.PENDING);
          });

          it('transfers distributionTokens to the scheduler', async () => {
            await expectBalanceChange(
              () =>
                scheduler
                  .connect(distributionOwner)
                  .scheduleDistribution(distributionId, DISTRIBUTION_AMOUNT, distributionStartTime),
              tokens,
              [
                { account: scheduler.address, changes: { [distributionToken.symbol]: DISTRIBUTION_AMOUNT } },
                {
                  account: distributionOwner.address,
                  changes: { [distributionToken.symbol]: DISTRIBUTION_AMOUNT.mul(-1) },
                },
              ]
            );
          });

          it('emits a DistributionScheduled event', async () => {
            const receipt = await (
              await scheduler
                .connect(distributionOwner)
                .scheduleDistribution(distributionId, DISTRIBUTION_AMOUNT, distributionStartTime)
            ).wait();

            const scheduleId = await scheduler.getScheduleId(distributionId, distributionStartTime);

            expectEvent.inReceipt(receipt, 'DistributionScheduled', {
              distributionId,
              scheduleId,
              startTime: distributionStartTime,
              amount: DISTRIBUTION_AMOUNT,
            });
          });
        });

        context('when there is a previously scheduled conflicting distribution', () => {
          sharedBeforeEach('schedule another distribution', async () => {
            await scheduler
              .connect(distributionOwner)
              .scheduleDistribution(distributionId, DISTRIBUTION_AMOUNT, distributionStartTime);
          });

          it('reverts', async () => {
            await expect(
              scheduler.connect(other).scheduleDistribution(distributionId, DISTRIBUTION_AMOUNT, distributionStartTime)
            ).to.be.revertedWith('Distribution has already been scheduled');
          });
        });
      });

      context('when scheduling a distribution for the past', () => {
        it('reverts', async () => {
          await expect(
            scheduler.connect(other).scheduleDistribution(distributionId, DISTRIBUTION_AMOUNT, 0)
          ).to.be.revertedWith('Distribution can only be scheduled for the future');
        });
      });
    });

    context('when called by another address', () => {
      it('reverts', async () => {
        await expect(
          scheduler.connect(other).scheduleDistribution(distributionId, DISTRIBUTION_AMOUNT, distributionStartTime)
        ).to.be.revertedWith('Only distribution owner can schedule');
      });
    });
  });

  describe('startDistributions', () => {
    context('when distribution is pending', () => {
      let scheduleId: string;
      let distributionStartTime: BigNumber;
      sharedBeforeEach(async () => {
        distributionStartTime = await fromNow(DAY);
        await scheduler
          .connect(distributionOwner)
          .scheduleDistribution(distributionId, DISTRIBUTION_AMOUNT, distributionStartTime);

        scheduleId = await scheduler.getScheduleId(distributionId, distributionStartTime);
      });

      context('when start time has passed', () => {
        sharedBeforeEach(async () => {
          await advanceTime(DAY + HOUR);
        });

        it('sends the correct amount of distributionTokens to the MultiDistributor', async () => {
          await expectBalanceChange(
            () => scheduler.connect(other).startDistributions([scheduleId]),
            tokens,
            [{ account: distributor.address, changes: { [distributionToken.symbol]: DISTRIBUTION_AMOUNT } }],
            vault.instance
          );
        });

        it('starts a fresh distribution in the MultiDistributor', async () => {
          const receipt = await (await scheduler.connect(other).startDistributions([scheduleId])).wait();

          expectEvent.inIndirectReceipt(receipt, distributor.instance.interface, 'DistributionFunded', {
            distribution: distributionId,
            amount: DISTRIBUTION_AMOUNT,
          });
        });

        it('emits a DistributionStarted event', async () => {
          const receipt = await (await scheduler.connect(other).startDistributions([scheduleId])).wait();

          expectEvent.inReceipt(receipt, 'DistributionStarted', {
            distributionId,
            scheduleId,
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

    context('when distribution has already been started', () => {
      let scheduleId: string;
      sharedBeforeEach(async () => {
        const distributionStartTime = await fromNow(DAY);
        await scheduler
          .connect(distributionOwner)
          .scheduleDistribution(distributionId, DISTRIBUTION_AMOUNT, distributionStartTime);

        scheduleId = await scheduler.getScheduleId(distributionId, distributionStartTime);
        await advanceTime(DAY + HOUR);
        await scheduler.connect(other).startDistributions([scheduleId]);
      });

      it('skips the distribution', async () => {
        const receipt = await (await scheduler.connect(other).startDistributions([scheduleId])).wait();

        await expectEvent.notEmitted(receipt, 'DistributionStarted');
      });
    });

    context('when distribution has already been cancelled', () => {
      let scheduleId: string;
      sharedBeforeEach(async () => {
        const distributionStartTime = await fromNow(DAY);
        await scheduler
          .connect(distributionOwner)
          .scheduleDistribution(distributionId, DISTRIBUTION_AMOUNT, distributionStartTime);

        scheduleId = await scheduler.getScheduleId(distributionId, distributionStartTime);
        await scheduler.connect(distributionOwner).cancelDistribution(scheduleId);
      });

      it('skips the distribution', async () => {
        const receipt = await (await scheduler.connect(other).startDistributions([scheduleId])).wait();

        await expectEvent.notEmitted(receipt, 'DistributionStarted');
      });
    });
  });

  describe('cancelDistribution', () => {
    context('when the distribution exists', () => {
      let scheduleId: string;
      let distributionStartTime: BigNumber;
      sharedBeforeEach(async () => {
        distributionStartTime = await fromNow(DAY);
        await scheduler
          .connect(distributionOwner)
          .scheduleDistribution(distributionId, DISTRIBUTION_AMOUNT, distributionStartTime);

        scheduleId = await scheduler.getScheduleId(distributionId, distributionStartTime);
      });

      context('when the distribution is pending', () => {
        context('when called by distribution owner', () => {
          it('refunds the expected amount of tokens to the distribution owner', async () => {
            await expectBalanceChange(
              () => scheduler.connect(distributionOwner).cancelDistribution(scheduleId),
              tokens,
              [
                { account: distributionOwner.address, changes: { [distributionToken.symbol]: DISTRIBUTION_AMOUNT } },
                { account: scheduler.address, changes: { [distributionToken.symbol]: DISTRIBUTION_AMOUNT.mul(-1) } },
              ]
            );
          });

          it('emits DistributionCancelled', async () => {
            const receipt = await (await scheduler.connect(distributionOwner).cancelDistribution(scheduleId)).wait();

            expectEvent.inReceipt(receipt, 'DistributionCancelled', {
              distributionId,
              scheduleId,
            });
          });

          it('marks the scheduled distribution as cancelled', async () => {
            await scheduler.connect(distributionOwner).cancelDistribution(scheduleId);

            const scheduledDistributionInfo = await scheduler.getScheduledDistributionInfo(scheduleId);
            expect(scheduledDistributionInfo.status).to.be.eq(DistributionStatus.CANCELLED);
          });
        });

        context('when called by another address', () => {
          it('reverts', async () => {
            await expect(scheduler.connect(other).cancelDistribution(scheduleId)).to.be.revertedWith(
              'Only distribution owner can cancel'
            );
          });
        });
      });

      context('when the distribution has started', () => {
        sharedBeforeEach(async () => {
          await advanceTime(DAY + HOUR);
          scheduler.connect(other).startDistributions([scheduleId]);
        });

        it('reverts', async () => {
          await expect(scheduler.connect(distributionOwner).cancelDistribution(scheduleId)).to.be.revertedWith(
            'Distribution has already started'
          );
        });
      });

      context('when the distribution has already been cancelled', () => {
        sharedBeforeEach(async () => {
          scheduler.connect(distributionOwner).cancelDistribution(scheduleId);
        });

        it('reverts', async () => {
          await expect(scheduler.connect(distributionOwner).cancelDistribution(scheduleId)).to.be.revertedWith(
            'Distribution has already been cancelled'
          );
        });
      });
    });

    context('when the distribution does not exist', () => {
      it('reverts', async () => {
        await expect(scheduler.connect(distributionOwner).cancelDistribution(ZERO_BYTES32)).to.be.revertedWith(
          'Distribution does not exist'
        );
      });
    });
  });
});
