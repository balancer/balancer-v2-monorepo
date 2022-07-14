import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { ANY_ADDRESS, MAX_UINT256, MAX_UINT32 } from '@balancer-labs/v2-helpers/src/constants';
import { advanceToTimestamp, currentTimestamp, WEEK } from '@balancer-labs/v2-helpers/src/time';
import { BigNumberish, maxUint } from '@balancer-labs/v2-helpers/src/numbers';

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

describe('DistributionScheduler', () => {
  let rewardToken: Token;
  let rewardTokenDistributor: Contract;
  let distributionScheduler: Contract;

  let caller: SignerWithAddress;

  before('setup signers', async () => {
    [, caller] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy DistributionScheduler', async () => {
    rewardTokenDistributor = await deploy('MockRewardTokenDistributor');
    distributionScheduler = await deploy('DistributionScheduler');
  });

  sharedBeforeEach('deploy Token', async () => {
    rewardToken = await Token.create('REWARD');
    await rewardToken.mint(caller);
    await rewardToken.approve(distributionScheduler, MAX_UINT256, { from: caller });
  });

  async function getRewardNode(startTime: BigNumberish): Promise<RewardNode> {
    return distributionScheduler.getRewardNode(rewardTokenDistributor.address, rewardToken.address, startTime);
  }

  async function getNextNodeKey(nodeKey: BigNumberish): Promise<BigNumber> {
    return BigNumber.from((await getRewardNode(nodeKey)).nextTimestamp);
  }

  async function scheduleDistribution(amount: BigNumberish, timestamp: BigNumberish): Promise<ContractReceipt> {
    const tx = await distributionScheduler
      .connect(caller)
      .scheduleDistribution(rewardTokenDistributor.address, rewardToken.address, amount, timestamp);
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

    context('when DistributionScheduler is not the distributor for reward token', () => {
      sharedBeforeEach('set reward token distributor to another address', async () => {
        await rewardTokenDistributor.add_reward(rewardToken.address, ANY_ADDRESS);
      });

      it('reverts', async () => {
        await expect(scheduleDistribution(amount, 0)).to.be.revertedWith(
          "DistributionScheduler is not reward token's distributor"
        );
      });
    });

    context('when DistributionScheduler is the distributor for reward token', () => {
      sharedBeforeEach('set reward token distributor to DistributionScheduler', async () => {
        await rewardTokenDistributor.add_reward(rewardToken.address, distributionScheduler.address);
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
              distributionScheduler.scheduleDistribution(
                rewardTokenDistributor.address,
                rewardToken.address,
                amount,
                invalidTimestamp
              )
            ).to.be.revertedWith('Distribution must start at the beginning of the week');
          });
        });

        context('when distribution starts at the beginning of a week', () => {
          context('when distribution is scheduled too far in the future', () => {
            it('revert', async () => {
              await expect(scheduleDistribution(amount, startTime.add(53 * WEEK))).to.be.revertedWith(
                'Distribution too far into the future'
              );
            });
          });

          context('when no rewards currently exist for this gauge', () => {
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
                insertedTime = startTime.add(51 * WEEK);
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
      const tx = await distributionScheduler.startDistributionForToken(
        rewardTokenDistributor.address,
        rewardToken.address
      );
      return tx.wait();
    }

    sharedBeforeEach('set reward token distributor to DistributionScheduler', async () => {
      await rewardTokenDistributor.add_reward(rewardToken.address, distributionScheduler.address);
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
      const pendingRewards = await distributionScheduler.getPendingRewards(
        rewardTokenDistributor.address,
        rewardToken.address
      );

      const receipt = await startDistributionForToken();

      expectTransferEvent(
        receipt,
        {
          from: distributionScheduler.address,
          to: rewardTokenDistributor.address,
          value: pendingRewards,
        },
        rewardToken
      );
    });

    it('resets pending rewards to zero', async () => {
      await startDistributionForToken();

      const pendingRewards = await distributionScheduler.getPendingRewards(
        rewardTokenDistributor.address,
        rewardToken.address
      );

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
      await rewardTokenDistributor.add_reward(rewardToken.address, distributionScheduler.address);
      await rewardTokenDistributor.add_reward(rewardToken2.address, distributionScheduler.address);

      // Add another reward token which the scheduler isn't the distributor for.
      // We should skip over this token when starting distributions.
      await rewardTokenDistributor.add_reward(ANY_ADDRESS, ANY_ADDRESS);
    });

    sharedBeforeEach('schedule some existing distributions', async () => {
      startTime = roundUpTimestamp(await currentTimestamp());
      scheduledRewardsTimes = Array.from({ length: 10 }, (_, i) => startTime.add(i * 2 * WEEK));
      for (const timestamp of scheduledRewardsTimes) {
        await scheduleDistribution(100, timestamp);
        await distributionScheduler
          .connect(caller)
          .scheduleDistribution(rewardTokenDistributor.address, rewardToken2.address, 50, timestamp);
      }
      await advanceToTimestamp(startTime.add(1));
    });

    it('starts all distributions for gauge', async () => {
      // As we only call into `startDistributionForToken`, it's sufficient to test that multiple tokens are transferred.

      const pendingToken1 = await distributionScheduler.getPendingRewards(
        rewardTokenDistributor.address,
        rewardToken.address
      );
      const pendingToken2 = await distributionScheduler.getPendingRewards(
        rewardTokenDistributor.address,
        rewardToken2.address
      );

      const tx = await distributionScheduler.startDistributions(rewardTokenDistributor.address);
      const receipt = await tx.wait();

      expectTransferEvent(
        receipt,
        {
          from: distributionScheduler.address,
          to: rewardTokenDistributor.address,
          value: pendingToken1,
        },
        rewardToken
      );

      expectTransferEvent(
        receipt,
        {
          from: distributionScheduler.address,
          to: rewardTokenDistributor.address,
          value: pendingToken2,
        },
        rewardToken2
      );
    });
  });
});
