import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { ANY_ADDRESS, MAX_UINT256, MAX_UINT32, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { advanceToTimestamp, currentTimestamp, WEEK } from '@balancer-labs/v2-helpers/src/time';
import { BigNumberish, maxUint } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

const MAX_UINT224 = maxUint(224);
const HEAD = 0;
const NULL = 0;

const roundDownTimestamp = (timestamp: BigNumberish): BigNumber => {
  return BigNumber.from(timestamp).div(WEEK).mul(WEEK);
};

const roundUpTimestamp = (timestamp: BigNumberish): BigNumber => {
  return roundDownTimestamp(BigNumber.from(timestamp).add(WEEK).sub(1));
};

type RewardNode = {
  amount: BigNumber;
  nextTimestamp: number;
};

describe('ChildChainDistributionScheduler', () => {
  let vault: Vault;
  let adaptor: Contract;

  let gauge: Contract;
  let streamer: Contract;

  let balToken: Token;
  let rewardToken: Token;
  let distributionScheduler: Contract;

  let gaugeTokenAdder: Contract;

  let admin: SignerWithAddress, caller: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, caller, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy gauge', async () => {
    vault = await Vault.create({ admin });
    if (!vault.authorizer) throw Error('Vault has no Authorizer');

    adaptor = await deploy('AuthorizerAdaptor', { args: [vault.address] });

    const token = await Token.create({ symbol: 'BPT' });
    balToken = await Token.create({ symbol: 'BAL' });

    const gaugeImplementation = await deploy('RewardsOnlyGauge', {
      args: [balToken.address, vault.address, adaptor.address],
    });
    const streamerImplementation = await deploy('ChildChainStreamer', { args: [balToken.address, adaptor.address] });

    const factory = await deploy('ChildChainLiquidityGaugeFactory', {
      args: [gaugeImplementation.address, streamerImplementation.address],
    });

    await factory.create(token.address);

    gauge = await deployedAt('RewardsOnlyGauge', await factory.getPoolGauge(token.address));
    streamer = await deployedAt('ChildChainStreamer', await factory.getPoolStreamer(token.address));

    gaugeTokenAdder = await deploy('ChildChainGaugeTokenAdder', { args: [factory.address, adaptor.address] });
  });

  sharedBeforeEach('set up ChildChainGaugeTokenAdder permissions', async () => {
    // Allow the ChildChainGaugeTokenAdder to call the relevant functions on the AuthorizerAdaptor.
    const addRewardRole = await actionId(adaptor, 'add_reward', streamer.interface);
    const setRewardsRole = await actionId(adaptor, 'set_rewards', gauge.interface);

    await vault.grantPermissionsGlobally([addRewardRole, setRewardsRole], gaugeTokenAdder);

    const addTokenToGaugeRole = await actionId(gaugeTokenAdder, 'addTokenToGauge');

    await vault.grantPermissionsGlobally([addTokenToGaugeRole], admin);
  });

  sharedBeforeEach('deploy ChildChainDistributionScheduler', async () => {
    distributionScheduler = await deploy('ChildChainDistributionScheduler', { args: [adaptor.address] });
  });

  sharedBeforeEach('deploy Token', async () => {
    rewardToken = await Token.create('REWARD');
    await rewardToken.mint(caller);
    await rewardToken.approve(distributionScheduler, MAX_UINT256, { from: caller });
  });

  async function getRewardNode(startTime: BigNumberish): Promise<RewardNode> {
    return distributionScheduler.getRewardNode(gauge.address, rewardToken.address, startTime);
  }

  async function getNextNodeKey(nodeKey: BigNumberish): Promise<BigNumber> {
    return BigNumber.from((await getRewardNode(nodeKey)).nextTimestamp);
  }

  async function scheduleDistribution(amount: BigNumberish, timestamp: BigNumberish): Promise<ContractReceipt> {
    const tx = await distributionScheduler
      .connect(caller)
      .scheduleDistribution(gauge.address, rewardToken.address, amount, timestamp);
    return tx.wait();
  }

  describe('scheduleDistribution', () => {
    const amount = 42;

    context('when providing zero tokens', () => {
      it('reverts', async () => {
        await expect(scheduleDistribution(0, 0)).to.be.revertedWith('Must provide non-zero number of tokens');
      });
    });

    context('when providing more tokens than fit in a uint224', () => {
      it('reverts', async () => {
        await expect(scheduleDistribution(MAX_UINT224.add(1), 0)).to.be.revertedWith('Reward amount overflow');
      });
    });

    context("when distribution starts at a timestamp which doesn't fit in a uint32", () => {
      it('reverts', async () => {
        await expect(scheduleDistribution(amount, MAX_UINT32.add(1))).to.be.revertedWith('Reward timestamp overflow');
      });
    });

    context('when reward token does not exist on gauge', () => {
      it('reverts', async () => {
        await expect(scheduleDistribution(amount, 0)).to.be.revertedWith('Reward token does not exist on gauge');
      });
    });

    context('when DistributionScheduler is the distributor for reward token', () => {
      sharedBeforeEach('set reward token distributor to DistributionScheduler', async () => {
        await gaugeTokenAdder
          .connect(admin)
          .addTokenToGauge(gauge.address, rewardToken.address, distributionScheduler.address);
      });

      context('when distribution is scheduled in the past', () => {
        it('reverts', async () => {
          await expect(scheduleDistribution(amount, (await currentTimestamp()).sub(1))).to.be.revertedWith(
            'Distribution can only be scheduled for the future'
          );
        });
      });

      context('when distribution is scheduled in the future', () => {
        let startTime: BigNumber;

        sharedBeforeEach('set the first valid timestamp to schedule rewards', async () => {
          startTime = roundUpTimestamp(await currentTimestamp());
        });

        context('when distribution does not start at the beginning of a week', () => {
          it('reverts', async () => {
            const invalidTimestamp = startTime.add(1);

            await expect(
              distributionScheduler.scheduleDistribution(gauge.address, rewardToken.address, amount, invalidTimestamp)
            ).to.be.revertedWith('Distribution must start at the beginning of the week');
          });
        });

        context('when distribution starts at the beginning of a week', () => {
          context('no rewards currently exist for this gauge', () => {
            it('updates the the head node to point at the new node', async () => {
              expect(await getNextNodeKey(HEAD)).to.be.eq(0);

              await scheduleDistribution(amount, startTime);

              expect(await getNextNodeKey(HEAD)).to.be.eq(startTime);
            });

            it('writes the expected node', async () => {
              const oldRewardNode = await getRewardNode(startTime);
              expect(oldRewardNode.amount).to.be.eq(0);

              await scheduleDistribution(amount, startTime);

              const newRewardNode = await getRewardNode(startTime);
              expect(newRewardNode.amount).to.be.eq(amount);
              expect(newRewardNode.nextTimestamp).to.be.eq(NULL);
            });
          });

          context('when there are already rewards scheduled for this gauge', () => {
            let scheduledRewardsTimes: BigNumber[];

            sharedBeforeEach('schedule some existing distributions', async () => {
              scheduledRewardsTimes = Array.from({ length: 10 }, (_, i) => startTime.add(i * 2 * WEEK));
              for (const timestamp of scheduledRewardsTimes) {
                await scheduleDistribution(100, timestamp);
              }
            });

            context('when a reward is being added after the last existing reward', () => {
              let insertedTime: BigNumber;

              sharedBeforeEach('set insertedTime', async () => {
                insertedTime = startTime.add(999 * WEEK);
              });

              it('updates the previous node to point at the new node', async () => {
                const prevNodeKey = scheduledRewardsTimes[scheduledRewardsTimes.length - 1];
                expect(await getNextNodeKey(prevNodeKey)).to.be.eq(0);

                await scheduleDistribution(amount, insertedTime);

                expect(await getNextNodeKey(prevNodeKey)).to.be.eq(insertedTime);
              });

              it('writes the expected node', async () => {
                const oldRewardNode = await getRewardNode(insertedTime);
                expect(oldRewardNode.amount).to.be.eq(0);

                await scheduleDistribution(amount, insertedTime);

                const newRewardNode = await getRewardNode(insertedTime);
                expect(newRewardNode.amount).to.be.eq(amount);
                expect(newRewardNode.nextTimestamp).to.be.eq(NULL);
              });
            });

            context('when a reward is being inserted in between two existing rewards', () => {
              let insertedTime: BigNumber;

              sharedBeforeEach('set insertedTime', async () => {
                insertedTime = startTime.add(3 * WEEK);
              });

              it('updates the previous node to point at the new node', async () => {
                const prevNodeKey = insertedTime.sub(WEEK);
                expect(await getNextNodeKey(prevNodeKey)).to.be.eq(insertedTime.add(WEEK));

                await scheduleDistribution(amount, insertedTime);

                expect(await getNextNodeKey(prevNodeKey)).to.be.eq(insertedTime);
              });

              it('writes the expected node', async () => {
                const oldRewardNode = await getRewardNode(insertedTime);
                expect(oldRewardNode.amount).to.be.eq(0);

                await scheduleDistribution(amount, insertedTime);

                const newRewardNode = await getRewardNode(insertedTime);
                expect(newRewardNode.amount).to.be.eq(amount);
                expect(newRewardNode.nextTimestamp).to.be.eq(insertedTime.add(WEEK));
              });
            });

            context('when a reward is being added onto an existing reward', () => {
              let insertedTime: BigNumber;

              sharedBeforeEach('set insertedTime', async () => {
                insertedTime = startTime.add(2 * WEEK);
              });

              it('maintains the existing link from the previous node', async () => {
                const prevNodeKey = insertedTime.sub(2 * WEEK);
                expect(await getNextNodeKey(prevNodeKey)).to.be.eq(insertedTime);

                await scheduleDistribution(amount, insertedTime);

                expect(await getNextNodeKey(prevNodeKey)).to.be.eq(insertedTime);
              });

              it('writes the expected node', async () => {
                const oldRewardNode = await getRewardNode(insertedTime);
                expect(oldRewardNode.amount).to.be.eq(100);

                await scheduleDistribution(amount, insertedTime);

                const newRewardNode = await getRewardNode(insertedTime);
                expect(newRewardNode.amount).to.be.eq(oldRewardNode.amount.add(amount));
                expect(newRewardNode.nextTimestamp).to.be.eq(oldRewardNode.nextTimestamp);
              });

              context('when providing more tokens would cause an overflow on the node', () => {
                it('reverts', async () => {
                  const { amount: existingRewardAmount } = await getRewardNode(insertedTime);
                  const rewardAmount = MAX_UINT224.sub(existingRewardAmount).add(1);

                  // Expect that an overflow would occur if tx was successful.
                  expect(existingRewardAmount.add(rewardAmount)).to.be.gt(MAX_UINT224);

                  await expect(scheduleDistribution(rewardAmount, insertedTime)).to.be.revertedWith(
                    'Reward amount overflow'
                  );
                });
              });
            });
          });
        });
      });
    });
  });

  describe('startDistributionForToken', () => {
    let startTime: BigNumber;
    let scheduledRewardsTimes: BigNumber[];

    async function startDistributionForToken(): Promise<ContractReceipt> {
      const tx = await distributionScheduler.startDistributionForToken(gauge.address, rewardToken.address);
      return tx.wait();
    }

    sharedBeforeEach('set reward token distributor to DistributionScheduler', async () => {
      await gaugeTokenAdder
        .connect(admin)
        .addTokenToGauge(gauge.address, rewardToken.address, distributionScheduler.address);
    });

    sharedBeforeEach('schedule some existing distributions', async () => {
      startTime = roundUpTimestamp(await currentTimestamp());
      scheduledRewardsTimes = Array.from({ length: 10 }, (_, i) => startTime.add(i * WEEK));
      for (const timestamp of scheduledRewardsTimes) {
        await scheduleDistribution(100, timestamp);
      }
      await advanceToTimestamp(startTime);
    });

    it('transfers tokens to the gauge', async () => {
      const pendingRewards = await distributionScheduler.getPendingRewards(gauge.address, rewardToken.address);

      const receipt = await startDistributionForToken();

      expectEvent.inIndirectReceipt(receipt, rewardToken.instance.interface, 'Transfer', {
        from: distributionScheduler.address,
        to: streamer.address,
        value: pendingRewards,
      });
    });

    it('resets pending rewards to zero', async () => {
      await startDistributionForToken();

      const pendingRewards = await distributionScheduler.getPendingRewards(gauge.address, rewardToken.address);

      expect(pendingRewards).to.be.eq(0);
    });

    context('when only some of the scheduled distributions are processed', () => {
      it('updates the head node to point towards the first unprocessed node', async () => {
        expect(await getNextNodeKey(HEAD)).to.be.eq(startTime);

        await startDistributionForToken();

        expect(await getNextNodeKey(HEAD)).to.be.eq(startTime.add(WEEK));
      });
    });

    context('when the last scheduled distribution is processed', () => {
      sharedBeforeEach('advance time past the last scheduled distribution', async () => {
        const lastTimestamp = scheduledRewardsTimes[scheduledRewardsTimes.length - 1];
        await advanceToTimestamp(lastTimestamp.add(WEEK * 99));
      });

      it('updates the head node to point towards NULL', async () => {
        expect(await getNextNodeKey(HEAD)).to.be.eq(startTime);

        await startDistributionForToken();

        expect(await getNextNodeKey(HEAD)).to.be.eq(NULL);
      });
    });
  });

  describe('startDistributions', () => {
    let rewardToken2: Token;
    let startTime: BigNumber;
    let scheduledRewardsTimes: BigNumber[];

    sharedBeforeEach('deploy Token', async () => {
      rewardToken2 = await Token.create('REWARD2');
      await rewardToken2.mint(caller);
      await rewardToken2.approve(distributionScheduler, MAX_UINT256, { from: caller });
    });

    sharedBeforeEach('set reward token distributor to DistributionScheduler', async () => {
      await gaugeTokenAdder
        .connect(admin)
        .addTokenToGauge(gauge.address, rewardToken.address, distributionScheduler.address);
      await gaugeTokenAdder.connect(admin).addTokenToGauge(gauge.address, rewardToken2.address, ANY_ADDRESS);
    });

    sharedBeforeEach('schedule some existing distributions', async () => {
      startTime = roundUpTimestamp(await currentTimestamp());
      scheduledRewardsTimes = Array.from({ length: 10 }, (_, i) => startTime.add(i * 2 * WEEK));
      for (const timestamp of scheduledRewardsTimes) {
        await scheduleDistribution(100, timestamp);
        await distributionScheduler
          .connect(caller)
          .scheduleDistribution(gauge.address, rewardToken2.address, 50, timestamp);
      }
      await advanceToTimestamp(startTime.add(1));
    });

    it('starts all distributions for gauge', async () => {
      // As we only call into `startDistributionForToken`, it's sufficient to test that multiple tokens are transferred.

      const pendingToken1 = await distributionScheduler.getPendingRewards(gauge.address, rewardToken.address);
      const pendingToken2 = await distributionScheduler.getPendingRewards(gauge.address, rewardToken2.address);

      const tx = await distributionScheduler.startDistributions(gauge.address);
      const receipt = await tx.wait();

      expectEvent.inIndirectReceipt(
        receipt,
        rewardToken.instance.interface,
        'Transfer',
        {
          from: distributionScheduler.address,
          to: streamer.address,
          value: pendingToken1,
        },
        rewardToken.address
      );

      expectEvent.inIndirectReceipt(
        receipt,
        rewardToken.instance.interface,
        'Transfer',
        {
          from: distributionScheduler.address,
          to: streamer.address,
          value: pendingToken2,
        },
        rewardToken2.address
      );
    });
  });

  describe('recoverInvalidPendingRewards', () => {
    const amount = 42;

    sharedBeforeEach('set reward token distributor to DistributionScheduler', async () => {
      await gaugeTokenAdder
        .connect(admin)
        .addTokenToGauge(gauge.address, rewardToken.address, distributionScheduler.address);
    });

    sharedBeforeEach('schedule distributions', async () => {
      const startTime = roundUpTimestamp(await currentTimestamp());
      const distributionTimes = [0, WEEK, 2 * WEEK, 10 * 52 * WEEK].map((delay) => startTime.add(delay));
      for (const distributionTime of distributionTimes) {
        await scheduleDistribution(amount, distributionTime);
      }
    });

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(
          distributionScheduler
            .connect(other)
            .recoverInvalidPendingRewards(gauge.address, rewardToken.address, other.address)
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when caller is authorized', () => {
      sharedBeforeEach('authorize admin to recover funds', async () => {
        const recoverRewardsActionId = await actionId(distributionScheduler, 'recoverInvalidPendingRewards');
        await vault.grantPermissionsGlobally([recoverRewardsActionId], admin);
      });

      context('when rewards are still able to be sent to the gauge', () => {
        it('reverts', async () => {
          await expect(
            distributionScheduler
              .connect(admin)
              .recoverInvalidPendingRewards(gauge.address, rewardToken.address, other.address)
          ).to.be.revertedWith('Reward token can still be distributed to gauge');
        });
      });

      context('when rewards are no longer able to be sent to the gauge', () => {
        sharedBeforeEach('remove reward token from streamer', async () => {
          const removeRewardActionId = await actionId(adaptor, 'remove_reward', streamer.interface);
          await vault.grantPermissionsGlobally([removeRewardActionId], admin);

          await adaptor
            .connect(admin)
            .performAction(
              streamer.address,
              streamer.interface.encodeFunctionData('remove_reward', [rewardToken.address, ANY_ADDRESS])
            );
        });

        it('sends the expected number of reward tokens to the recipient', async () => {
          const schedulerBalanceBefore = await rewardToken.balanceOf(distributionScheduler);
          await expectBalanceChange(
            () =>
              distributionScheduler
                .connect(admin)
                .recoverInvalidPendingRewards(gauge.address, rewardToken.address, other.address),
            new TokenList([rewardToken]),
            [
              { account: distributionScheduler, changes: { [rewardToken.symbol]: schedulerBalanceBefore.mul(-1) } },
              { account: other, changes: { [rewardToken.symbol]: schedulerBalanceBefore } },
            ]
          );
        });

        it('resets the head node for this token and gauge', async () => {
          await distributionScheduler
            .connect(admin)
            .recoverInvalidPendingRewards(gauge.address, rewardToken.address, other.address);

          const headNode = await getRewardNode(0);
          expect(headNode.nextTimestamp).to.be.eq(0);
        });
      });
    });
  });
});
