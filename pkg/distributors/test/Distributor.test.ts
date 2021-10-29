import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { ZERO_ADDRESS, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import { advanceTime, currentTimestamp, DAY } from '@balancer-labs/v2-helpers/src/time';

import { Distributor } from './helpers/Distributor';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';

describe('MultiRewards', () => {
  let distributor: Distributor;
  let distribution: string, anotherDistribution: string;
  let stakingToken: Token, stakingTokens: TokenList;
  let rewardsToken: Token, anotherRewardsToken: Token, rewardsTokens: TokenList;
  let user1: SignerWithAddress, user2: SignerWithAddress, user3: SignerWithAddress;
  let other: SignerWithAddress, rewarder: SignerWithAddress;

  const REWARDS = fp(90e3);
  const PERIOD_DURATION = 30 * DAY;

  before('setup signers', async () => {
    [, user1, user2, user3, other, rewarder] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy distributor', async () => {
    distributor = await Distributor.create();
  });

  sharedBeforeEach('deploy tokens', async () => {
    stakingTokens = await TokenList.create(1);
    stakingToken = stakingTokens.first;

    rewardsTokens = await TokenList.create(2);
    rewardsToken = rewardsTokens.first;
    anotherRewardsToken = rewardsTokens.second;

    await rewardsTokens.mint({ to: rewarder });
    await rewardsTokens.approve({ to: distributor, from: rewarder });
  });

  describe('authorizer', () => {
    it('uses the authorizer of the vault', async () => {
      expect(await distributor.getAuthorizer()).to.equal(distributor.authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      const { vault, authorizer, admin } = distributor;
      const action = await actionId(vault, 'setAuthorizer');
      await authorizer.connect(admin).grantRole(action, admin.address);

      await vault.connect(admin).setAuthorizer(user1.address);

      expect(await distributor.getAuthorizer()).to.equal(user1.address);
    });
  });

  describe('create', () => {
    context('when the given distribution was not created yet', () => {
      context('when the given params are correct', () => {
        it('creates the distribution', async () => {
          await distributor.newDistribution(stakingToken, rewardsToken, PERIOD_DURATION, { from: rewarder });

          const id = await distributor.getDistributionId(stakingToken, rewardsToken, rewarder);
          const data = await distributor.getDistribution(id);
          expect(data.stakingToken).to.be.equal(stakingToken.address);
          expect(data.rewardsToken).to.be.equal(rewardsToken.address);
          expect(data.rewarder).to.be.equal(rewarder.address);
          expect(data.duration).to.be.equal(PERIOD_DURATION);
          expect(data.totalSupply).to.be.zero;
          expect(data.periodFinish).to.be.zero;
          expect(data.rewardRate).to.be.zero;
          expect(data.lastUpdateTime).to.be.zero;
          expect(data.rewardPerTokenStored).to.be.zero;
        });

        it('emits a NewDistribution event', async () => {
          const tx = await distributor.newDistribution(stakingToken, rewardsToken, PERIOD_DURATION, { from: rewarder });

          const id = await distributor.getDistributionId(stakingToken, rewardsToken, rewarder);
          expectEvent.inReceipt(await tx.wait(), 'NewReward', {
            distribution: id,
            stakingToken: stakingToken.address,
            rewardsToken: rewardsToken.address,
            rewarder: rewarder.address,
          });
        });
      });

      context('when the given params are not correct', () => {
        context('when the given staking token is the zero address', () => {
          const stakingTokenAddress = ZERO_ADDRESS;

          it('reverts', async () => {
            await expect(
              distributor.newDistribution(stakingTokenAddress, rewardsToken, PERIOD_DURATION, { from: rewarder })
            ).to.be.revertedWith('STAKING_TOKEN_ZERO_ADDRESS');
          });
        });

        context('when the given rewards token is the zero address', () => {
          const rewardsTokenAddress = ZERO_ADDRESS;

          it('reverts', async () => {
            await expect(
              distributor.newDistribution(stakingToken, rewardsTokenAddress, PERIOD_DURATION, { from: rewarder })
            ).to.be.revertedWith('REWARDS_TOKEN_ZERO_ADDRESS');
          });
        });

        context('when the given duration is zero', () => {
          const duration = 0;

          it('reverts', async () => {
            await expect(
              distributor.newDistribution(stakingToken, rewardsToken, duration, { from: rewarder })
            ).to.be.revertedWith('reward rate must be nonzero');
          });
        });
      });
    });

    context('when the given distribution was already created', () => {
      sharedBeforeEach('create distribution', async () => {
        await distributor.newDistribution(stakingToken, rewardsToken, PERIOD_DURATION, { from: rewarder });
      });

      it('reverts', async () => {
        await expect(
          distributor.newDistribution(stakingToken, rewardsToken, PERIOD_DURATION, { from: rewarder })
        ).to.be.revertedWith('Duplicate rewards token');
      });
    });
  });

  describe('reward', () => {
    context('when the given distribution exists', () => {
      sharedBeforeEach('create distribution', async () => {
        await distributor.newDistribution(stakingToken, rewardsToken, PERIOD_DURATION, { from: rewarder });
        distribution = await distributor.getDistributionId(stakingToken, rewardsToken, rewarder);
      });

      sharedBeforeEach('stake tokens', async () => {
        await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });
        await distributor.subscribeAndStake(distribution, stakingToken, fp(2), { from: user2 });

        // There are 3 tokens staked, 1 belonging to user1 and 2 belonging to user2. So user1 will get 1/3rd of
        // the distributed tokens, and user2 will get the other 2/3rds.
      });

      function toUser1Share(amount: BigNumberish): BigNumber {
        return bn(amount).div(3);
      }

      function toUser2Share(amount: BigNumberish): BigNumber {
        return bn(amount).mul(2).div(3);
      }

      const itCreatesANewRewardDistributionPeriod = () => {
        it('updates the last update time of the distribution', async () => {
          await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });

          const { lastUpdateTime: currentLastUpdate } = await distributor.getDistribution(distribution);
          expect(currentLastUpdate).to.equal(await currentTimestamp());
        });

        it('sets the end date of the current period', async () => {
          await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });

          const { periodFinish: currentEndDate } = await distributor.getDistribution(distribution);
          expect(currentEndDate).to.equal((await currentTimestamp()).add(PERIOD_DURATION));
        });

        it('increases the reward rate', async () => {
          await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });

          const { rewardRate: currentRewardRate } = await distributor.getDistribution(distribution);
          expect(currentRewardRate).to.be.equal(REWARDS.div(PERIOD_DURATION));
        });

        it('emits a RewardAdded event', async () => {
          const tx = await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });

          expectEvent.inReceipt(await tx.wait(), 'RewardAdded', {
            distribution: distribution,
            amount: REWARDS,
          });
        });
      };

      const itExtendsTheCurrentDistributionPeriod = () => {
        it('updates the last update time of the distribution', async () => {
          const { lastUpdateTime: previousLastUpdate } = await distributor.getDistribution(distribution);

          await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });

          const { lastUpdateTime: currentLastUpdate } = await distributor.getDistribution(distribution);
          expect(currentLastUpdate).to.be.gt(previousLastUpdate);
          expect(currentLastUpdate).to.equal(await currentTimestamp());
        });

        it('extends the end date of the current period', async () => {
          const { periodFinish: previousEndDate } = await distributor.getDistribution(distribution);

          await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });

          const { periodFinish: currentEndDate } = await distributor.getDistribution(distribution);
          expect(currentEndDate).to.be.gt(previousEndDate);
          expect(currentEndDate).to.be.at.least((await currentTimestamp()).add(PERIOD_DURATION));
        });

        it('increases the reward rate', async () => {
          const { rewardRate: previousRewardRate, periodFinish } = await distributor.getDistribution(distribution);

          await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
          const currentTime = await currentTimestamp();

          const { rewardRate: currentRewardRate } = await distributor.getDistribution(distribution);
          expect(currentRewardRate).to.be.gt(previousRewardRate);

          const leftOverRewards = periodFinish.sub(currentTime).mul(previousRewardRate);
          const expectedNewRewardRate = REWARDS.add(leftOverRewards).div(PERIOD_DURATION);
          expect(currentRewardRate).to.be.almostEqual(expectedNewRewardRate);
        });

        it('emits a RewardAdded event', async () => {
          const tx = await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });

          expectEvent.inReceipt(await tx.wait(), 'RewardAdded', {
            distribution: distribution,
            amount: REWARDS,
          });
        });

        it('does not affect already earned rewards', async () => {
          const currentTime = await currentTimestamp();
          const { lastUpdateTime, periodFinish } = await distributor.getDistribution(distribution);
          const rewardedTime = currentTime.gt(periodFinish) ? PERIOD_DURATION : currentTime.sub(lastUpdateTime);

          const previousUser1Rewards = await distributor.totalEarned(distribution, user1);
          expect(previousUser1Rewards).to.be.almostEqual(toUser1Share(REWARDS).mul(rewardedTime).div(PERIOD_DURATION));

          const previousUser2Rewards = await distributor.totalEarned(distribution, user2);
          expect(previousUser2Rewards).to.be.almostEqual(toUser2Share(REWARDS).mul(rewardedTime).div(PERIOD_DURATION));

          // Add new rewards, double the size of the original ones, and fully process them
          await distributor.reward(stakingToken, rewardsToken, REWARDS.mul(2), { from: rewarder });
          await advanceTime(PERIOD_DURATION);

          // Each user should now get their share out of the two batches of rewards (three times the original amount)
          const currentUser1Rewards = await distributor.totalEarned(distribution, user1);
          expect(currentUser1Rewards).to.be.almostEqual(toUser1Share(REWARDS.mul(3)));

          const currentUser2Rewards = await distributor.totalEarned(distribution, user2);
          expect(currentUser2Rewards).to.be.almostEqual(toUser2Share(REWARDS.mul(3)));
        });
      };

      context('when the given distribution was not rewarded yet', () => {
        itCreatesANewRewardDistributionPeriod();

        it('starts giving rewards to already subscribed users', async () => {
          const previousUser1Rewards = await distributor.totalEarned(distribution, user1);
          expect(previousUser1Rewards).to.be.zero;

          const previousUser2Rewards = await distributor.totalEarned(distribution, user2);
          expect(previousUser2Rewards).to.be.zero;

          await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
          await advanceTime(PERIOD_DURATION);

          const currentUser1Rewards = await distributor.totalEarned(distribution, user1);
          expect(currentUser1Rewards).to.be.almostEqual(toUser1Share(REWARDS));

          const currentUser2Rewards = await distributor.totalEarned(distribution, user2);
          expect(currentUser2Rewards).to.be.almostEqual(toUser2Share(REWARDS));
        });
      });

      context('when the given distribution was already rewarded', () => {
        sharedBeforeEach('reward distribution', async () => {
          await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
        });

        context('at the beginning of the reward period', () => {
          itExtendsTheCurrentDistributionPeriod();
        });

        context('at the middle of the reward period', () => {
          sharedBeforeEach('move at the middle of the reward period', async () => {
            await advanceTime(PERIOD_DURATION / 2);
          });

          itExtendsTheCurrentDistributionPeriod();
        });

        context('at the end of the reward period', () => {
          sharedBeforeEach('move at the end of the reward period', async () => {
            await advanceTime(PERIOD_DURATION);
          });

          itCreatesANewRewardDistributionPeriod();

          it('accrues already given rewards', async () => {
            const previousUser1Rewards = await distributor.totalEarned(distribution, user1);
            expect(previousUser1Rewards).to.be.almostEqual(toUser1Share(REWARDS));

            const previousUser2Rewards = await distributor.totalEarned(distribution, user2);
            expect(previousUser2Rewards).to.be.almostEqual(toUser2Share(REWARDS));

            // Add new rewards, double the size of the original ones, and fully process them
            await distributor.reward(stakingToken, rewardsToken, REWARDS.mul(2), { from: rewarder });
            await advanceTime(PERIOD_DURATION);

            // Each user should now get their share out of the two batches of rewards (three times the original amount)
            const currentUser1Rewards = await distributor.totalEarned(distribution, user1);
            expect(currentUser1Rewards).to.be.almostEqual(toUser1Share(REWARDS.mul(3)));

            const currentUser2Rewards = await distributor.totalEarned(distribution, user2);
            expect(currentUser2Rewards).to.be.almostEqual(toUser2Share(REWARDS.mul(3)));
          });
        });

        context('after the reward period has ended', () => {
          sharedBeforeEach('move after the reward period', async () => {
            await advanceTime(PERIOD_DURATION + 1);
          });

          itCreatesANewRewardDistributionPeriod();

          it('accrues already given rewards', async () => {
            const previousUser1Rewards = await distributor.totalEarned(distribution, user1);
            expect(previousUser1Rewards).to.be.almostEqual(toUser1Share(REWARDS));

            const previousUser2Rewards = await distributor.totalEarned(distribution, user2);
            expect(previousUser2Rewards).to.be.almostEqual(toUser2Share(REWARDS));

            // Add new rewards, double the size of the original ones, and fully process them
            await distributor.reward(stakingToken, rewardsToken, REWARDS.mul(2), { from: rewarder });
            await advanceTime(PERIOD_DURATION);

            // Each user should now get their share out of the two batches of rewards (three times the original amount)
            const currentUser1Rewards = await distributor.totalEarned(distribution, user1);
            expect(currentUser1Rewards).to.be.almostEqual(toUser1Share(REWARDS.mul(3)));

            const currentUser2Rewards = await distributor.totalEarned(distribution, user2);
            expect(currentUser2Rewards).to.be.almostEqual(toUser2Share(REWARDS.mul(3)));
          });
        });
      });
    });

    context('when the given distribution does not exist', () => {
      it('reverts', async () => {
        await expect(distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder })).to.be.revertedWith(
          'Reward must be configured with addReward'
        );
      });
    });
  });

  describe('setDuration', () => {
    context('when the given distribution exists', () => {
      sharedBeforeEach('create distribution', async () => {
        await distributor.newDistribution(stakingToken, rewardsToken, PERIOD_DURATION, { from: rewarder });
        distribution = await distributor.getDistributionId(stakingToken, rewardsToken, rewarder);
      });

      context('when the new duration is not zero', () => {
        const newDuration = 1;

        const itCannotSetThePeriodDuration = () => {
          it('reverts', async () => {
            await expect(
              distributor.setDuration(stakingToken, rewardsToken, newDuration, { from: rewarder })
            ).to.be.revertedWith('Reward period still active');
          });
        };

        const itSetsTheDistributionPeriodDuration = () => {
          it('sets the distribution period duration', async () => {
            await distributor.setDuration(stakingToken, rewardsToken, newDuration, { from: rewarder });

            const { duration } = await distributor.getDistribution(distribution);
            expect(duration).to.be.equal(newDuration);
          });

          it('emits a RewardDurationSet event', async () => {
            const tx = await distributor.setDuration(stakingToken, rewardsToken, newDuration, { from: rewarder });

            expectEvent.inReceipt(await tx.wait(), 'RewardDurationSet', {
              distribution: distribution,
              duration: newDuration,
            });
          });
        };

        context('when there is an on going distribution period', () => {
          sharedBeforeEach('reward distribution', async () => {
            await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
          });

          context('at the beginning of the reward period', () => {
            itCannotSetThePeriodDuration();
          });

          context('at the middle of the reward period', () => {
            sharedBeforeEach('move at the middle of the reward period', async () => {
              await advanceTime(PERIOD_DURATION / 2);
            });

            itCannotSetThePeriodDuration();
          });

          context('at the end of the reward period', () => {
            sharedBeforeEach('move at the end of the reward period', async () => {
              await advanceTime(PERIOD_DURATION);
            });

            itSetsTheDistributionPeriodDuration();
          });

          context('after the reward period has ended', () => {
            sharedBeforeEach('move after the reward period', async () => {
              await advanceTime(PERIOD_DURATION + 1);
            });

            itSetsTheDistributionPeriodDuration();
          });
        });

        context('when there is no on going distribution period', () => {
          itSetsTheDistributionPeriodDuration();
        });
      });

      context('when the new duration is not zero', () => {
        const newDuration = 0;

        it('reverts', async () => {
          await expect(
            distributor.setDuration(stakingToken, rewardsToken, newDuration, { from: rewarder })
          ).to.be.revertedWith('Reward duration must be non-zero');
        });
      });
    });

    context('when the given distribution does not exist', () => {
      it('reverts', async () => {
        await expect(distributor.setDuration(stakingToken, rewardsToken, 1, { from: rewarder })).to.be.revertedWith(
          'Reward must be configured with addReward'
        );
      });
    });
  });

  describe('stake', () => {
    let from: SignerWithAddress, to: SignerWithAddress;

    sharedBeforeEach('create distributions', async () => {
      await distributor.newDistribution(stakingToken, rewardsToken, PERIOD_DURATION, { from: rewarder });
      await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
      distribution = await distributor.getDistributionId(stakingToken, rewardsToken, rewarder);

      await distributor.newDistribution(stakingToken, anotherRewardsToken, PERIOD_DURATION, { from: rewarder });
      await distributor.reward(stakingToken, anotherRewardsToken, REWARDS, { from: rewarder });
      anotherDistribution = await distributor.getDistributionId(stakingToken, anotherRewardsToken, rewarder);
    });

    const itHandlesStaking = (stake: (token: Token, amount: BigNumberish) => Promise<ContractTransaction>) => {
      context('when the user did specify some amount', () => {
        const amount = fp(1);

        context('when the user has the requested balance', () => {
          sharedBeforeEach('mint stake amount', async () => {
            await stakingToken.mint(from, amount);
            await stakingToken.approve(distributor, amount, { from });
          });

          const itTransfersTheStakingTokensToTheDistributor = () => {
            it('transfers the staking tokens to the distributor', async () => {
              await expectBalanceChange(() => stake(stakingToken, amount), new TokenList([stakingToken]), [
                { account: from, changes: { [stakingToken.symbol]: amount.mul(-1) } },
                { account: distributor.address, changes: { [stakingToken.symbol]: amount } },
              ]);
            });

            it('increases the staking balance of the user', async () => {
              const previousStakedBalance = await distributor.balanceOf(stakingToken, to);

              await stake(stakingToken, amount);

              const currentStakedBalance = await distributor.balanceOf(stakingToken, to);
              expect(currentStakedBalance).be.equal(previousStakedBalance.add(amount));
            });
          };

          const itDoesNotAffectAnyDistribution = () => {
            it('does not emit a Staked event', async () => {
              const tx = await stake(stakingToken, amount);
              expectEvent.notEmitted(await tx.wait(), 'Staked');
            });

            it('does not increase the supply of the distribution', async () => {
              const previousSupply = await distributor.totalSupply(distribution);

              await stake(stakingToken, amount);

              const currentSupply = await distributor.totalSupply(distribution);
              expect(currentSupply).be.equal(previousSupply);
            });

            it('does not update the last update time of the distribution', async () => {
              const previousData = await distributor.getDistribution(distribution);
              expect(previousData.lastUpdateTime).not.to.be.equal(0);

              await stake(stakingToken, amount);

              const currentData = await distributor.getDistribution(distribution);
              expect(currentData.lastUpdateTime).to.be.equal(previousData.lastUpdateTime);
            });

            it('does not update the reward rate stored of the distribution', async () => {
              const previousData = await distributor.getDistribution(distribution);
              expect(previousData.rewardPerTokenStored).to.be.zero;

              await stake(stakingToken, amount);

              const currentData = await distributor.getDistribution(distribution);
              expect(currentData.rewardPerTokenStored).to.be.zero;
            });

            it('does not update the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, to);
              expect(previousData.unpaidRewards).to.be.equal(0);
              expect(previousData.paidRatePerToken).to.be.equal(0);

              await stake(stakingToken, amount);

              const currentData = await distributor.getUserDistribution(distribution, to);
              expect(currentData.unpaidRewards).to.be.equal(0);
              expect(currentData.paidRatePerToken).to.be.equal(0);
            });

            itDoesNotAffectOtherDistributions();
          };

          const itDoesNotAffectOtherDistributions = () => {
            it('does not affect the supply of other distributions', async () => {
              const previousSupply = await distributor.totalSupply(anotherDistribution);
              expect(previousSupply).be.zero;

              await stake(stakingToken, amount);

              const currentSupply = await distributor.totalSupply(anotherDistribution);
              expect(currentSupply).be.zero;
            });

            it('does not affect the rates of other distributions', async () => {
              const previousData = await distributor.getDistribution(anotherDistribution);
              expect(previousData.lastUpdateTime).not.to.be.equal(0);
              expect(previousData.rewardPerTokenStored).to.be.zero;

              const previousRewardPerToken = await distributor.rewardPerToken(anotherDistribution);
              expect(previousRewardPerToken).to.be.zero;

              await stake(stakingToken, amount);

              const currentData = await distributor.getDistribution(anotherDistribution);
              expect(currentData.lastUpdateTime).to.be.equal(previousData.lastUpdateTime);
              expect(currentData.rewardPerTokenStored).to.be.zero;

              const currentRewardPerToken = await distributor.rewardPerToken(anotherDistribution);
              expect(currentRewardPerToken).to.be.zero;
            });

            it('does not affect the user rates of other distributions', async () => {
              const previousData = await distributor.getUserDistribution(anotherDistribution, user1);
              expect(previousData.unpaidRewards).to.be.zero;
              expect(previousData.paidRatePerToken).to.be.zero;

              await stake(stakingToken, amount);

              const currentData = await distributor.getUserDistribution(anotherDistribution, user1);
              expect(currentData.unpaidRewards).to.be.zero;
              expect(currentData.paidRatePerToken).to.be.zero;
            });
          };

          context('when there was no previous staked amount', () => {
            context('when the user was not subscribed to a distribution', () => {
              itTransfersTheStakingTokensToTheDistributor();
              itDoesNotAffectAnyDistribution();

              it('does not track it for future rewards', async () => {
                await stake(stakingToken, amount);

                const previousRewardPerToken = await distributor.rewardPerToken(distribution);
                expect(previousRewardPerToken).to.be.zero;

                await advanceTime(PERIOD_DURATION);

                const currentRewardPerToken = await distributor.rewardPerToken(distribution);
                expect(currentRewardPerToken).to.be.zero;
              });
            });

            context('when the user was subscribed to a distribution', () => {
              sharedBeforeEach('subscribe distribution', async () => {
                await distributor.subscribe(distribution, { from: to });
              });

              itTransfersTheStakingTokensToTheDistributor();
              itDoesNotAffectOtherDistributions();

              it('emits a Staked event', async () => {
                const tx = await stake(stakingToken, amount);

                expectEvent.inReceipt(await tx.wait(), 'Staked', {
                  distribution,
                  user: user1.address,
                  amount,
                });
              });

              it('increases the supply of the staking contract for the subscribed distribution', async () => {
                const previousSupply = await distributor.totalSupply(distribution);

                await stake(stakingToken, amount);

                const currentSupply = await distributor.totalSupply(distribution);
                expect(currentSupply).be.equal(previousSupply.add(amount));
              });

              it('updates the last update time of the subscribed distribution', async () => {
                const previousData = await distributor.getDistribution(distribution);

                await stake(stakingToken, amount);

                const currentData = await distributor.getDistribution(distribution);
                expect(currentData.lastUpdateTime).to.be.gt(previousData.lastUpdateTime);
              });

              it('does not update the reward rate stored of the subscribed distribution', async () => {
                const previousData = await distributor.getDistribution(distribution);
                expect(previousData.rewardPerTokenStored).to.be.zero;

                await stake(stakingToken, amount);

                const currentData = await distributor.getDistribution(distribution);
                expect(currentData.rewardPerTokenStored).to.be.zero;
              });

              it('does not update the user rates of the subscribed distribution', async () => {
                await stake(stakingToken, amount);

                const distributionData = await distributor.getUserDistribution(distribution, user1);
                expect(distributionData.unpaidRewards).to.be.zero;
                expect(distributionData.paidRatePerToken).to.be.zero;
              });

              it('starts tracking it for future rewards', async () => {
                await stake(stakingToken, amount);

                const previousRewardPerToken = await distributor.rewardPerToken(distribution);
                expect(previousRewardPerToken).to.be.zero;

                await advanceTime(PERIOD_DURATION);

                const currentRewardPerToken = await distributor.rewardPerToken(distribution);
                expect(currentRewardPerToken).to.be.almostEqualFp(90000);
              });
            });
          });

          context('when there was some previous staked amount', () => {
            sharedBeforeEach('subscribe and stake some amount', async () => {
              await distributor.subscribeAndStake(distribution, stakingToken, fp(2), { from: user2 });
              // Half of the reward tokens will go to user 2: 45k, meaning 22.5k per token
              await advanceTime(PERIOD_DURATION / 2);
            });

            context('when the user was not subscribed to a distribution', () => {
              itTransfersTheStakingTokensToTheDistributor();
              itDoesNotAffectAnyDistribution();

              it('does not track it for future rewards', async () => {
                await stake(stakingToken, amount);

                const previousRewardPerToken = await distributor.rewardPerToken(distribution);
                expect(previousRewardPerToken).to.be.almostEqualFp(22500);

                await advanceTime(PERIOD_DURATION);

                const currentRewardPerToken = await distributor.rewardPerToken(distribution);
                expect(currentRewardPerToken).to.be.almostEqualFp(45000);
              });
            });

            context('when the user was subscribed to a distribution', () => {
              sharedBeforeEach('subscribe distribution', async () => {
                await distributor.subscribe(distribution, { from: to });
              });

              itTransfersTheStakingTokensToTheDistributor();
              itDoesNotAffectOtherDistributions();

              it('emits a Staked event', async () => {
                const tx = await stake(stakingToken, amount);

                expectEvent.inReceipt(await tx.wait(), 'Staked', {
                  distribution,
                  user: to.address,
                  amount,
                });
              });

              it('increases the supply of the staking contract for the subscribed distribution', async () => {
                const previousSupply = await distributor.totalSupply(distribution);

                await stake(stakingToken, amount);

                const currentSupply = await distributor.totalSupply(distribution);
                expect(currentSupply).be.equal(previousSupply.add(amount));
              });

              it('updates the last update time of the subscribed distribution', async () => {
                const previousData = await distributor.getDistribution(distribution);

                await stake(stakingToken, amount);

                const currentData = await distributor.getDistribution(distribution);
                expect(currentData.lastUpdateTime).to.be.gt(previousData.lastUpdateTime);
              });

              it('updates the reward rate stored of the subscribed distribution', async () => {
                const previousData = await distributor.getDistribution(distribution);
                expect(previousData.rewardPerTokenStored).to.be.zero;

                await stake(stakingToken, amount);

                const currentData = await distributor.getDistribution(distribution);
                expect(currentData.rewardPerTokenStored).to.be.almostEqualFp(22500);
              });

              it('does not update the user rates of the subscribed distribution', async () => {
                await stake(stakingToken, amount);

                const distributionData = await distributor.getUserDistribution(distribution, user1);
                expect(distributionData.unpaidRewards).to.be.zero;
                expect(distributionData.paidRatePerToken).to.be.almostEqualFp(22500);
              });

              it('starts tracking it for future rewards', async () => {
                await stake(stakingToken, amount);

                const previousRewardPerToken = await distributor.rewardPerToken(distribution);
                expect(previousRewardPerToken).to.be.almostEqualFp(22500);

                await advanceTime(PERIOD_DURATION);

                // The second half is split between both users, meaning 15k per token
                const currentRewardPerToken = await distributor.rewardPerToken(distribution);
                expect(currentRewardPerToken).to.be.almostEqualFp(37500);
              });
            });
          });
        });

        context('when the user does not have the requested balance', () => {
          const amount = fp(1001);

          it('reverts', async () => {
            await expect(stake(stakingToken, amount)).to.be.revertedWith('ERC20_TRANSFER_EXCEEDS_BALANCE');
          });
        });
      });

      context('when the user did not specify any amount', () => {
        const amount = 0;

        it('reverts', async () => {
          await expect(stake(stakingToken, amount)).to.be.revertedWith('Cannot stake 0');
        });
      });
    };

    describe('stake', () => {
      sharedBeforeEach('define sender and recipient', async () => {
        from = user1;
        to = user1;
      });

      itHandlesStaking((token: Token, amount: BigNumberish) => distributor.stake(token, amount, { from }));
    });

    describe('stakeFor', () => {
      sharedBeforeEach('define sender and recipient', async () => {
        from = other;
        to = user1;
      });

      itHandlesStaking((token: Token, amount: BigNumberish) => distributor.stakeFor(token, amount, to, { from }));
    });

    describe('stakeWithPermit', () => {
      sharedBeforeEach('define sender and recipient', async () => {
        from = user1;
        to = user1;
      });

      itHandlesStaking((token: Token, amount: BigNumberish) =>
        distributor.stakeWithPermit(token, amount, to, { from: other })
      );
    });
  });

  describe('withdraw', () => {
    sharedBeforeEach('create distributions', async () => {
      await distributor.newDistribution(stakingToken, rewardsToken, PERIOD_DURATION, { from: rewarder });
      await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
      distribution = await distributor.getDistributionId(stakingToken, rewardsToken, rewarder);

      await distributor.newDistribution(stakingToken, anotherRewardsToken, PERIOD_DURATION, { from: rewarder });
      await distributor.reward(stakingToken, anotherRewardsToken, REWARDS, { from: rewarder });
      anotherDistribution = await distributor.getDistributionId(stakingToken, anotherRewardsToken, rewarder);
    });

    context('when the user did specify some amount', () => {
      const amount = fp(1);

      context('when the user has previously staked the requested balance', () => {
        sharedBeforeEach('stake amount', async () => {
          await stakingTokens.mint({ to: user1, amount });
          await stakingTokens.approve({ to: distributor, amount, from: user1 });

          await distributor.stake(stakingToken, amount, { from: user1 });
        });

        const itTransfersTheStakingTokensToTheUser = () => {
          it('transfers the staking tokens to the user', async () => {
            const previousUserBalance = await stakingToken.balanceOf(user1);
            const previousDistributorBalance = await stakingToken.balanceOf(distributor);

            await distributor.withdraw(stakingToken, amount, { from: user1 });

            const currentUserBalance = await stakingToken.balanceOf(user1);
            expect(currentUserBalance).be.equal(previousUserBalance.add(amount));

            const currentDistributorBalance = await stakingToken.balanceOf(distributor);
            expect(currentDistributorBalance).be.equal(previousDistributorBalance.sub(amount));
          });

          it('decreases the staking balance of the user', async () => {
            const previousStakedBalance = await distributor.balanceOf(stakingToken, user1);

            await distributor.withdraw(stakingToken, amount, { from: user1 });

            const currentStakedBalance = await distributor.balanceOf(stakingToken, user1);
            expect(currentStakedBalance).be.equal(previousStakedBalance.sub(amount));
          });
        };

        const itDoesNotAffectAnyDistribution = () => {
          it('does not emit a Withdrawn event', async () => {
            const tx = await distributor.withdraw(stakingToken, amount, { from: user1 });
            expectEvent.notEmitted(await tx.wait(), 'Withdrawn');
          });

          it('does not decrease the supply of the distribution', async () => {
            const previousSupply = await distributor.totalSupply(distribution);

            await distributor.withdraw(stakingToken, amount, { from: user1 });

            const currentSupply = await distributor.totalSupply(distribution);
            expect(currentSupply).be.equal(previousSupply);
          });

          it('does not update the last update time of the distribution', async () => {
            const previousData = await distributor.getDistribution(distribution);
            expect(previousData.lastUpdateTime).not.to.be.equal(0);

            await distributor.withdraw(stakingToken, amount, { from: user1 });

            const currentData = await distributor.getDistribution(distribution);
            expect(currentData.lastUpdateTime).to.be.equal(previousData.lastUpdateTime);
          });

          it('does not update the reward rate stored of the distribution', async () => {
            const previousData = await distributor.getDistribution(distribution);
            expect(previousData.rewardPerTokenStored).to.be.zero;

            await distributor.withdraw(stakingToken, amount, { from: user1 });

            const currentData = await distributor.getDistribution(distribution);
            expect(currentData.rewardPerTokenStored).to.be.zero;
          });

          it('does not update the user rates of the distribution', async () => {
            const previousData = await distributor.getUserDistribution(distribution, user1);
            expect(previousData.unpaidRewards).to.be.equal(0);
            expect(previousData.paidRatePerToken).to.be.equal(0);

            await distributor.withdraw(stakingToken, amount, { from: user1 });

            const currentData = await distributor.getUserDistribution(distribution, user1);
            expect(currentData.unpaidRewards).to.be.equal(0);
            expect(currentData.paidRatePerToken).to.be.equal(0);
          });

          itDoesNotAffectOtherDistributions();
        };

        const itDoesNotAffectOtherDistributions = () => {
          it('does not affect the supply of other distributions', async () => {
            const previousSupply = await distributor.totalSupply(anotherDistribution);
            expect(previousSupply).be.zero;

            await distributor.withdraw(stakingToken, amount, { from: user1 });

            const currentSupply = await distributor.totalSupply(anotherDistribution);
            expect(currentSupply).be.zero;
          });

          it('does not affect the rates of other distributions', async () => {
            const previousData = await distributor.getDistribution(anotherDistribution);
            expect(previousData.lastUpdateTime).not.to.be.equal(0);
            expect(previousData.rewardPerTokenStored).to.be.zero;

            const previousRewardPerToken = await distributor.rewardPerToken(anotherDistribution);
            expect(previousRewardPerToken).to.be.zero;

            await distributor.withdraw(stakingToken, amount, { from: user1 });

            const currentData = await distributor.getDistribution(anotherDistribution);
            expect(currentData.lastUpdateTime).to.be.equal(previousData.lastUpdateTime);
            expect(currentData.rewardPerTokenStored).to.be.zero;

            const currentRewardPerToken = await distributor.rewardPerToken(anotherDistribution);
            expect(currentRewardPerToken).to.be.zero;
          });

          it('does not affect the user rates of other distributions', async () => {
            const previousData = await distributor.getUserDistribution(anotherDistribution, user1);
            expect(previousData.unpaidRewards).to.be.zero;
            expect(previousData.paidRatePerToken).to.be.zero;

            await distributor.withdraw(stakingToken, amount, { from: user1 });

            const currentData = await distributor.getUserDistribution(anotherDistribution, user1);
            expect(currentData.unpaidRewards).to.be.zero;
            expect(currentData.paidRatePerToken).to.be.zero;
          });
        };

        context('when there was no other staked amount', () => {
          context('when the user was not subscribed to a distribution', () => {
            sharedBeforeEach('accrue some rewards', async () => {
              await advanceTime(30 * DAY);
            });

            itTransfersTheStakingTokensToTheUser();
            itDoesNotAffectAnyDistribution();

            it('does not track it for future rewards', async () => {
              await distributor.withdraw(stakingToken, amount, { from: user1 });

              const previousRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(previousRewardPerToken).to.be.zero;

              await advanceTime(PERIOD_DURATION);

              const currentRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(currentRewardPerToken).to.be.zero;
            });
          });

          context('when the user was subscribed to the distribution', () => {
            sharedBeforeEach('subscribe to one distribution', async () => {
              await distributor.subscribe([distribution], { from: user1 });
              await advanceTime(PERIOD_DURATION / 2);
            });

            itTransfersTheStakingTokensToTheUser();
            itDoesNotAffectOtherDistributions();

            it('emits a Withdrawn event', async () => {
              const tx = await distributor.withdraw(stakingToken, amount, { from: user1 });

              expectEvent.inReceipt(await tx.wait(), 'Withdrawn', {
                distribution,
                user: user1.address,
                amount,
              });
            });

            it('decreases the supply of the staking contract for the subscribed distribution', async () => {
              const previousSupply = await distributor.totalSupply(distribution);

              await distributor.withdraw(stakingToken, amount, { from: user1 });

              const currentSupply = await distributor.totalSupply(distribution);
              expect(currentSupply).be.equal(previousSupply.sub(amount));
            });

            it('updates the last update time of the subscribed distribution', async () => {
              const previousData = await distributor.getDistribution(distribution);

              await distributor.withdraw(stakingToken, amount, { from: user1 });

              const currentData = await distributor.getDistribution(distribution);
              expect(currentData.lastUpdateTime).to.be.gt(previousData.lastUpdateTime);
            });

            it('updates the reward rate stored of the subscribed distribution', async () => {
              const previousData = await distributor.getDistribution(distribution);
              expect(previousData.rewardPerTokenStored).to.be.zero;

              await distributor.withdraw(stakingToken, amount, { from: user1 });

              const currentData = await distributor.getDistribution(distribution);
              expect(currentData.rewardPerTokenStored).to.be.almostEqualFp(45000);
            });

            it('updates the user rates of the subscribed distribution', async () => {
              await distributor.withdraw(stakingToken, amount, { from: user1 });

              const distributionData = await distributor.getUserDistribution(distribution, user1);
              expect(distributionData.unpaidRewards).to.be.almostEqualFp(45000);
              expect(distributionData.paidRatePerToken).to.be.almostEqualFp(45000);
            });

            it('stops tracking it for future rewards', async () => {
              await distributor.withdraw(stakingToken, amount, { from: user1 });
              await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });

              const previousRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(previousRewardPerToken).to.be.almostEqualFp(45000);

              await advanceTime(PERIOD_DURATION);

              const currentRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(currentRewardPerToken).to.be.almostEqualFp(45000);
            });

            it('does not claim his rewards', async () => {
              await distributor.withdraw(stakingToken, amount, { from: user1 });

              const currentRewards = await distributor.totalEarned(distribution, user1);
              expect(currentRewards).to.be.almostEqualFp(45000);
            });
          });
        });

        context('when there was some other staked amount', () => {
          sharedBeforeEach('subscribe and stake some amount', async () => {
            await distributor.subscribeAndStake(distribution, stakingToken, fp(2), { from: user2 });
            // Half of the reward tokens will go to user 2: 45k, meaning 22.5k per token
            await advanceTime(PERIOD_DURATION / 2);
          });

          context('when the user was not subscribed to a distribution', () => {
            itTransfersTheStakingTokensToTheUser();
            itDoesNotAffectAnyDistribution();

            it('does not track it for future rewards', async () => {
              await distributor.withdraw(stakingToken, amount, { from: user1 });

              const previousRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(previousRewardPerToken).to.be.almostEqualFp(22500);

              await advanceTime(PERIOD_DURATION);

              const currentRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(currentRewardPerToken).to.be.almostEqualFp(45000);
            });
          });

          context('when the user was subscribed to a distribution', () => {
            sharedBeforeEach('subscribe distribution', async () => {
              await distributor.subscribe(distribution, { from: user1 });
              await advanceTime(PERIOD_DURATION / 2);
            });

            itTransfersTheStakingTokensToTheUser();

            it('emits a Withdrawn event', async () => {
              const tx = await distributor.withdraw(stakingToken, amount, { from: user1 });

              expectEvent.inReceipt(await tx.wait(), 'Withdrawn', {
                distribution,
                user: user1.address,
                amount,
              });
            });

            it('decreases the supply of the staking contract for the subscribed distribution', async () => {
              const previousSupply = await distributor.totalSupply(distribution);

              await distributor.withdraw(stakingToken, amount, { from: user1 });

              const currentSupply = await distributor.totalSupply(distribution);
              expect(currentSupply).be.equal(previousSupply.sub(amount));
            });

            it('updates the last update time of the subscribed distribution', async () => {
              const previousData = await distributor.getDistribution(distribution);

              await distributor.withdraw(stakingToken, amount, { from: user1 });

              const currentData = await distributor.getDistribution(distribution);
              expect(currentData.lastUpdateTime).to.be.gt(previousData.lastUpdateTime);
            });

            it('updates the reward rate stored of the subscribed distribution', async () => {
              const previousData = await distributor.getDistribution(distribution);
              expect(previousData.rewardPerTokenStored).to.be.almostEqualFp(22500);

              await distributor.withdraw(stakingToken, amount, { from: user1 });

              const currentData = await distributor.getDistribution(distribution);
              expect(currentData.rewardPerTokenStored).to.be.almostEqualFp(37500);
            });

            it('updates the user rates of the subscribed distribution', async () => {
              await distributor.withdraw(stakingToken, amount, { from: user1 });

              // The second half is split between both users, meaning 15k per token
              const distributionData = await distributor.getUserDistribution(distribution, user1);
              expect(distributionData.unpaidRewards).to.be.almostEqualFp(15000);
              expect(distributionData.paidRatePerToken).to.be.almostEqualFp(37500);
            });

            it('stops tracking it for future rewards', async () => {
              await distributor.withdraw(stakingToken, amount, { from: user1 });
              await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });

              const previousRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(previousRewardPerToken).to.be.almostEqualFp(37500);

              await advanceTime(PERIOD_DURATION);

              // All new rewards go to user 2, meaning 45k per token
              const currentRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(currentRewardPerToken).to.be.almostEqualFp(82500);
            });

            it('does not claim his rewards', async () => {
              await distributor.withdraw(stakingToken, amount, { from: user1 });

              const currentRewards = await distributor.totalEarned(distribution, user1);
              expect(currentRewards).to.be.almostEqualFp(15000);
            });
          });
        });
      });

      context('when the user does not have the requested stake', () => {
        const amount = fp(1001);

        it('reverts', async () => {
          await expect(distributor.withdraw(stakingToken, amount, { from: user1 })).to.be.revertedWith(
            'UNSTAKE_AMOUNT_UNAVAILABLE'
          );
        });
      });
    });

    context('when the user did not specify any amount', () => {
      const amount = 0;

      it('reverts', async () => {
        await expect(distributor.withdraw(stakingToken, amount, { from: user1 })).to.be.revertedWith(
          'Cannot withdraw 0'
        );
      });
    });
  });

  describe('subscribe', () => {
    context('when the distribution exists', () => {
      sharedBeforeEach('create distributions', async () => {
        await distributor.newDistribution(stakingToken, rewardsToken, PERIOD_DURATION, { from: rewarder });
        await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
        distribution = await distributor.getDistributionId(stakingToken, rewardsToken, rewarder);

        await distributor.newDistribution(stakingToken, anotherRewardsToken, PERIOD_DURATION, {
          from: rewarder,
        });
        await distributor.reward(stakingToken, anotherRewardsToken, REWARDS, { from: rewarder });
        anotherDistribution = await distributor.getDistributionId(stakingToken, anotherRewardsToken, rewarder);
      });

      context('when the user was not subscribed yet', () => {
        context('when there was no stake yet', () => {
          context('when the user has no stake', () => {
            it('subscribes the user to the distribution', async () => {
              await distributor.subscribe(distribution, { from: user1 });

              expect(await distributor.isSubscribed(distribution, user1)).to.be.true;
              expect(await distributor.isSubscribed(anotherDistribution, user1)).to.be.false;
            });

            it('does not affect the staking balance of the user', async () => {
              const previousBalance = await distributor.balanceOf(stakingToken, user1);

              await distributor.subscribe(distribution, { from: user1 });

              const currentBalance = await distributor.balanceOf(stakingToken, user1);
              expect(currentBalance).to.be.equal(previousBalance);
            });

            it('does not affect the supply of the distribution', async () => {
              const previousSupply = await distributor.totalSupply(distribution);

              await distributor.subscribe(distribution, { from: user1 });

              const currentSupply = await distributor.totalSupply(distribution);
              expect(currentSupply).to.be.equal(previousSupply);
            });

            it('does not update the last update time of the distribution', async () => {
              const { lastUpdateTime: previousUpdateTime } = await distributor.getDistribution(distribution);

              await distributor.subscribe(distribution, { from: user1 });

              const { lastUpdateTime: currentUpdateTime } = await distributor.getDistribution(distribution);
              expect(currentUpdateTime).to.be.equal(previousUpdateTime);
            });

            it('does not update the reward rate stored of the distribution', async () => {
              const { rewardPerTokenStored: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const { rewardPerTokenStored: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.zero;
            });

            it('does not update the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(previousRewardPerToken).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const currentRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(currentRewardPerToken).to.be.zero;
            });

            it('does not affect the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unpaidRewards).to.be.zero;
              expect(previousData.paidRatePerToken).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unpaidRewards).to.be.zero;
              expect(currentData.paidRatePerToken).to.be.zero;
            });

            it('does not emit a Staked event', async () => {
              const tx = await distributor.subscribe(distribution, { from: user1 });
              expectEvent.notEmitted(await tx.wait(), 'Staked');
            });
          });

          context('when the user has staked', () => {
            const balance = fp(1);

            sharedBeforeEach('stake tokens', async () => {
              await stakingToken.mint(user1, balance);
              await stakingToken.approve(distributor, balance, { from: user1 });
              await distributor.stake(stakingToken, balance, { from: user1 });
              await advanceTime(PERIOD_DURATION / 2);
            });

            it('subscribes the user to the distribution', async () => {
              await distributor.subscribe(distribution, { from: user1 });

              expect(await distributor.isSubscribed(distribution, user1)).to.be.true;
              expect(await distributor.isSubscribed(anotherDistribution, user1)).to.be.false;
            });

            it('does not affect the staking balance of the user', async () => {
              const previousBalance = await distributor.balanceOf(stakingToken, user1);

              await distributor.subscribe(distribution, { from: user1 });

              const currentBalance = await distributor.balanceOf(stakingToken, user1);
              expect(currentBalance).to.be.equal(previousBalance);
            });

            it('increases the supply of the distribution', async () => {
              const previousSupply = await distributor.totalSupply(distribution);

              await distributor.subscribe(distribution, { from: user1 });

              const currentSupply = await distributor.totalSupply(distribution);
              expect(currentSupply).to.be.equal(previousSupply.add(balance));
            });

            it('updates the last update time of the distribution', async () => {
              const { lastUpdateTime: previousUpdateTime } = await distributor.getDistribution(distribution);

              const currentTime = await currentTimestamp();
              await distributor.subscribe(distribution, { from: user1 });

              const { lastUpdateTime: currentUpdateTime } = await distributor.getDistribution(distribution);
              expect(currentUpdateTime).to.be.gt(previousUpdateTime);
              expect(currentUpdateTime).to.be.at.least(currentTime);
            });

            it('does not update the reward rate stored of the distribution', async () => {
              const { rewardPerTokenStored: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const { rewardPerTokenStored: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.zero;
            });

            it('does not update the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(previousRewardPerToken).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const currentRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(currentRewardPerToken).to.be.zero;
            });

            it('does not affect the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unpaidRewards).to.be.zero;
              expect(previousData.paidRatePerToken).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unpaidRewards).to.be.zero;
              expect(currentData.paidRatePerToken).to.be.zero;
            });

            it('emits a Staked event', async () => {
              const tx = await distributor.subscribe(distribution, { from: user1 });

              expectEvent.inReceipt(await tx.wait(), 'Staked', {
                distribution,
                amount: balance,
                user: user1.address,
              });
            });
          });
        });

        context('when there some previous stake', () => {
          sharedBeforeEach('stake from other user', async () => {
            await distributor.subscribeAndStake(distribution, stakingToken, fp(2), { from: user2 });
            await advanceTime(PERIOD_DURATION);
          });

          context('when the user has no stake', () => {
            it('subscribes the user to the distribution', async () => {
              await distributor.subscribe(distribution, { from: user1 });

              expect(await distributor.isSubscribed(distribution, user1)).to.be.true;
              expect(await distributor.isSubscribed(anotherDistribution, user1)).to.be.false;
            });

            it('does not affect the staking balance of the user', async () => {
              const previousBalance = await distributor.balanceOf(stakingToken, user1);

              await distributor.subscribe(distribution, { from: user1 });

              const currentBalance = await distributor.balanceOf(stakingToken, user1);
              expect(currentBalance).to.be.equal(previousBalance);
            });

            it('does not affect the supply of the distribution', async () => {
              const previousSupply = await distributor.totalSupply(distribution);

              await distributor.subscribe(distribution, { from: user1 });

              const currentSupply = await distributor.totalSupply(distribution);
              expect(currentSupply).to.be.equal(previousSupply);
            });

            it('does not update the last update time of the distribution', async () => {
              const { lastUpdateTime: previousUpdateTime } = await distributor.getDistribution(distribution);

              await distributor.subscribe(distribution, { from: user1 });

              const { lastUpdateTime: currentUpdateTime } = await distributor.getDistribution(distribution);
              expect(currentUpdateTime).to.be.equal(previousUpdateTime);
            });

            it('does not update the reward rate stored of the distribution', async () => {
              const { rewardPerTokenStored: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const { rewardPerTokenStored: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.zero;
            });

            it('does not update the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(previousRewardPerToken).to.be.almostEqualFp(45e3);

              await distributor.subscribe(distribution, { from: user1 });

              const currentRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(currentRewardPerToken).to.be.almostEqualFp(45e3);
            });

            it('does not affect the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unpaidRewards).to.be.zero;
              expect(previousData.paidRatePerToken).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unpaidRewards).to.be.zero;
              expect(currentData.paidRatePerToken).to.be.zero;
            });

            it('does not emit a Staked event', async () => {
              const tx = await distributor.subscribe(distribution, { from: user1 });
              expectEvent.notEmitted(await tx.wait(), 'Staked');
            });
          });

          context('when the user has staked', () => {
            const balance = fp(1);

            sharedBeforeEach('stake tokens', async () => {
              await stakingToken.mint(user1, balance);
              await stakingToken.approve(distributor, balance, { from: user1 });
              await distributor.stake(stakingToken, balance, { from: user1 });
              await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
            });

            it('subscribes the user to the distribution', async () => {
              await distributor.subscribe(distribution, { from: user1 });

              expect(await distributor.isSubscribed(distribution, user1)).to.be.true;
              expect(await distributor.isSubscribed(anotherDistribution, user1)).to.be.false;
            });

            it('does not affect the staking balance of the user', async () => {
              const previousBalance = await distributor.balanceOf(stakingToken, user1);

              await distributor.subscribe(distribution, { from: user1 });

              const currentBalance = await distributor.balanceOf(stakingToken, user1);
              expect(currentBalance).to.be.equal(previousBalance);
            });

            it('increases the supply of the distribution', async () => {
              const previousSupply = await distributor.totalSupply(distribution);

              await distributor.subscribe(distribution, { from: user1 });

              const currentSupply = await distributor.totalSupply(distribution);
              expect(currentSupply).to.be.equal(previousSupply.add(balance));
            });

            it('updates the last update time of the distribution', async () => {
              const { lastUpdateTime: previousUpdateTime } = await distributor.getDistribution(distribution);

              const currentTime = await currentTimestamp();
              await distributor.subscribe(distribution, { from: user1 });

              const { lastUpdateTime: currentUpdateTime } = await distributor.getDistribution(distribution);
              expect(currentUpdateTime).to.be.gt(previousUpdateTime);
              expect(currentUpdateTime).to.be.at.least(currentTime);
            });

            it('updates the reward rate stored of the distribution', async () => {
              const { rewardPerTokenStored: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.almostEqualFp(45e3);

              await advanceTime(PERIOD_DURATION);
              await distributor.subscribe(distribution, { from: user1 });

              const { rewardPerTokenStored: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.almostEqualFp(90e3);
            });

            it('affects the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(previousRewardPerToken).to.be.almostEqualFp(45e3);

              await distributor.subscribe(distribution, { from: user1 });
              await advanceTime(PERIOD_DURATION);

              const currentRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(currentRewardPerToken).to.be.almostEqualFp(75e3);
            });

            it('does not affect the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unpaidRewards).to.be.zero;
              expect(previousData.paidRatePerToken).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unpaidRewards).to.be.zero;
              expect(currentData.paidRatePerToken).to.be.almostEqualFp(45e3);
            });

            it('emits a Staked event', async () => {
              const tx = await distributor.subscribe(distribution, { from: user1 });

              expectEvent.inReceipt(await tx.wait(), 'Staked', {
                distribution,
                amount: balance,
                user: user1.address,
              });
            });
          });
        });
      });

      context('when the user was already subscribed', () => {
        sharedBeforeEach('subscribe', async () => {
          await distributor.subscribe(distribution, { from: user1 });
        });

        it('reverts', async () => {
          await expect(distributor.subscribe(distribution, { from: user1 })).to.be.revertedWith(
            'ALREADY_SUBSCRIBED_DISTRIBUTION'
          );
        });
      });
    });

    context('when the distribution does not exist', () => {
      it('reverts', async () => {
        await expect(distributor.subscribe(ZERO_BYTES32, { from: user1 })).to.be.revertedWith(
          'DISTRIBUTION_DOES_NOT_EXIST'
        );
      });
    });
  });

  describe('unsubscribe', () => {
    context('when the distribution exists', () => {
      sharedBeforeEach('create distributions', async () => {
        await distributor.newDistribution(stakingToken, rewardsToken, PERIOD_DURATION, { from: rewarder });
        await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
        distribution = await distributor.getDistributionId(stakingToken, rewardsToken, rewarder);

        await distributor.newDistribution(stakingToken, anotherRewardsToken, PERIOD_DURATION, {
          from: rewarder,
        });
        await distributor.reward(stakingToken, anotherRewardsToken, REWARDS, { from: rewarder });
        anotherDistribution = await distributor.getDistributionId(stakingToken, anotherRewardsToken, rewarder);
      });

      context('when the user was already subscribed', () => {
        sharedBeforeEach('subscribe', async () => {
          await distributor.subscribe(distribution, { from: user1 });
        });

        context('when there was no stake yet', () => {
          context('when the user has no stake', () => {
            it('subscribes the user to the distribution', async () => {
              await distributor.unsubscribe(distribution, { from: user1 });

              expect(await distributor.isSubscribed(distribution, user1)).to.be.false;
              expect(await distributor.isSubscribed(anotherDistribution, user1)).to.be.false;
            });

            it('does not affect the staking balance of the user', async () => {
              const previousBalance = await distributor.balanceOf(stakingToken, user1);

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentBalance = await distributor.balanceOf(stakingToken, user1);
              expect(currentBalance).to.be.equal(previousBalance);
            });

            it('does not affect the supply of the distribution', async () => {
              const previousSupply = await distributor.totalSupply(distribution);

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentSupply = await distributor.totalSupply(distribution);
              expect(currentSupply).to.be.equal(previousSupply);
            });

            it('does not update the last update time of the distribution', async () => {
              const { lastUpdateTime: previousUpdateTime } = await distributor.getDistribution(distribution);

              await distributor.unsubscribe(distribution, { from: user1 });

              const { lastUpdateTime: currentUpdateTime } = await distributor.getDistribution(distribution);
              expect(currentUpdateTime).to.be.equal(previousUpdateTime);
            });

            it('does not update the reward rate stored of the distribution', async () => {
              const { rewardPerTokenStored: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const { rewardPerTokenStored: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.zero;
            });

            it('does not update the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(previousRewardPerToken).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(currentRewardPerToken).to.be.zero;
            });

            it('does not affect the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unpaidRewards).to.be.zero;
              expect(previousData.paidRatePerToken).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unpaidRewards).to.be.zero;
              expect(currentData.paidRatePerToken).to.be.zero;
            });

            it('calculates total earned correctly', async () => {
              await advanceTime(PERIOD_DURATION);
              await distributor.unsubscribe(distribution, { from: user1 });

              expect(await distributor.totalEarned(distribution, user1)).to.be.zero;
            });

            it('does not emit a Withdrawn event', async () => {
              const tx = await distributor.unsubscribe(distribution, { from: user1 });
              expectEvent.notEmitted(await tx.wait(), 'Withdrawn');
            });
          });

          context('when the user has staked', () => {
            const balance = fp(1);

            sharedBeforeEach('stake tokens', async () => {
              await stakingToken.mint(user1, balance);
              await stakingToken.approve(distributor, balance, { from: user1 });
              await distributor.stake(stakingToken, balance, { from: user1 });
              await advanceTime(PERIOD_DURATION / 2);
            });

            it('subscribes the user to the distribution', async () => {
              await distributor.unsubscribe(distribution, { from: user1 });

              expect(await distributor.isSubscribed(distribution, user1)).to.be.false;
              expect(await distributor.isSubscribed(anotherDistribution, user1)).to.be.false;
            });

            it('does not affect the staking balance of the user', async () => {
              const previousBalance = await distributor.balanceOf(stakingToken, user1);

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentBalance = await distributor.balanceOf(stakingToken, user1);
              expect(currentBalance).to.be.equal(previousBalance);
            });

            it('decreases the supply of the distribution', async () => {
              const previousSupply = await distributor.totalSupply(distribution);

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentSupply = await distributor.totalSupply(distribution);
              expect(currentSupply).to.be.equal(previousSupply.sub(balance));
            });

            it('updates the last update time of the distribution', async () => {
              const { lastUpdateTime: previousUpdateTime } = await distributor.getDistribution(distribution);

              const currentTime = await currentTimestamp();
              await distributor.unsubscribe(distribution, { from: user1 });

              const { lastUpdateTime: currentUpdateTime } = await distributor.getDistribution(distribution);
              expect(currentUpdateTime).to.be.gt(previousUpdateTime);
              expect(currentUpdateTime).to.be.at.least(currentTime);
            });

            it('updates the reward rate stored of the distribution', async () => {
              const { rewardPerTokenStored: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const { rewardPerTokenStored: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.almostEqualFp(45e3);
            });

            it('does not update the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(previousRewardPerToken).to.be.almostEqualFp(45e3);

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(currentRewardPerToken).to.be.almostEqualFp(45e3);
            });

            it('updates the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unpaidRewards).to.be.zero;
              expect(previousData.paidRatePerToken).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unpaidRewards).to.be.almostEqualFp(45e3);
              expect(currentData.paidRatePerToken).to.be.almostEqualFp(45e3);
            });

            it('calculates total earned correctly', async () => {
              await distributor.unsubscribe(distribution, { from: user1 });

              expect(await distributor.totalEarned(distribution, user1)).almostEqualFp(45e3);
            });

            it('emits a Withdrawn event', async () => {
              const tx = await distributor.unsubscribe(distribution, { from: user1 });

              expectEvent.inReceipt(await tx.wait(), 'Withdrawn', {
                distribution,
                amount: balance,
                user: user1.address,
              });
            });
          });
        });

        context('when there some previous stake', () => {
          sharedBeforeEach('stake from other user', async () => {
            await distributor.subscribeAndStake(distribution, stakingToken, fp(2), { from: user2 });
            await advanceTime(PERIOD_DURATION);
          });

          context('when the user has no stake', () => {
            it('subscribes the user to the distribution', async () => {
              await distributor.unsubscribe(distribution, { from: user1 });

              expect(await distributor.isSubscribed(distribution, user1)).to.be.false;
              expect(await distributor.isSubscribed(anotherDistribution, user1)).to.be.false;
            });

            it('does not affect the staking balance of the user', async () => {
              const previousBalance = await distributor.balanceOf(stakingToken, user1);

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentBalance = await distributor.balanceOf(stakingToken, user1);
              expect(currentBalance).to.be.equal(previousBalance);
            });

            it('does not affect the supply of the distribution', async () => {
              const previousSupply = await distributor.totalSupply(distribution);

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentSupply = await distributor.totalSupply(distribution);
              expect(currentSupply).to.be.equal(previousSupply);
            });

            it('does not update the last update time of the distribution', async () => {
              const { lastUpdateTime: previousUpdateTime } = await distributor.getDistribution(distribution);

              await distributor.unsubscribe(distribution, { from: user1 });

              const { lastUpdateTime: currentUpdateTime } = await distributor.getDistribution(distribution);
              expect(currentUpdateTime).to.be.equal(previousUpdateTime);
            });

            it('does not update the reward rate stored of the distribution', async () => {
              const { rewardPerTokenStored: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const { rewardPerTokenStored: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.zero;
            });

            it('does not update the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(previousRewardPerToken).to.be.almostEqualFp(45e3);

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(currentRewardPerToken).to.be.almostEqualFp(45e3);
            });

            it('does not affect the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unpaidRewards).to.be.zero;
              expect(previousData.paidRatePerToken).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unpaidRewards).to.be.zero;
              expect(currentData.paidRatePerToken).to.be.zero;
            });

            it('calculates total earned correctly', async () => {
              await advanceTime(PERIOD_DURATION);
              await distributor.unsubscribe(distribution, { from: user1 });

              expect(await distributor.totalEarned(distribution, user1)).to.be.zero;
            });

            it('does not emit a Withdrawn event', async () => {
              const tx = await distributor.unsubscribe(distribution, { from: user1 });
              expectEvent.notEmitted(await tx.wait(), 'Withdrawn');
            });
          });

          context('when the user has staked', () => {
            const balance = fp(1);

            sharedBeforeEach('stake tokens', async () => {
              await stakingToken.mint(user1, balance);
              await stakingToken.approve(distributor, balance, { from: user1 });
              await distributor.stake(stakingToken, balance, { from: user1 });
              await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
            });

            it('subscribes the user to the distribution', async () => {
              await distributor.unsubscribe(distribution, { from: user1 });

              expect(await distributor.isSubscribed(distribution, user1)).to.be.false;
              expect(await distributor.isSubscribed(anotherDistribution, user1)).to.be.false;
            });

            it('does not affect the staking balance of the user', async () => {
              const previousBalance = await distributor.balanceOf(stakingToken, user1);

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentBalance = await distributor.balanceOf(stakingToken, user1);
              expect(currentBalance).to.be.equal(previousBalance);
            });

            it('decreases the supply of the distribution', async () => {
              const previousSupply = await distributor.totalSupply(distribution);

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentSupply = await distributor.totalSupply(distribution);
              expect(currentSupply).to.be.equal(previousSupply.sub(balance));
            });

            it('updates the last update time of the distribution', async () => {
              const { lastUpdateTime: previousUpdateTime } = await distributor.getDistribution(distribution);

              const currentTime = await currentTimestamp();
              await distributor.unsubscribe(distribution, { from: user1 });

              const { lastUpdateTime: currentUpdateTime } = await distributor.getDistribution(distribution);
              expect(currentUpdateTime).to.be.gt(previousUpdateTime);
              expect(currentUpdateTime).to.be.at.least(currentTime);
            });

            it('updates the reward rate stored of the distribution', async () => {
              const { rewardPerTokenStored: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.almostEqualFp(45e3);

              await advanceTime(PERIOD_DURATION);
              await distributor.unsubscribe(distribution, { from: user1 });

              const { rewardPerTokenStored: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.almostEqualFp(75e3);
            });

            it('affects the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(previousRewardPerToken).to.be.almostEqualFp(45e3);

              await distributor.unsubscribe(distribution, { from: user1 });
              await advanceTime(PERIOD_DURATION);

              const currentRewardPerToken = await distributor.rewardPerToken(distribution);
              expect(currentRewardPerToken).to.be.almostEqualFp(90e3);
            });

            it('affects the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unpaidRewards).to.be.zero;
              expect(previousData.paidRatePerToken).to.be.almostEqualFp(45e3);

              await advanceTime(PERIOD_DURATION);
              await distributor.unsubscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unpaidRewards).to.be.almostEqualFp(30e3);
              expect(currentData.paidRatePerToken).to.be.almostEqualFp(75e3);
            });

            it('calculates total earned correctly', async () => {
              await advanceTime(PERIOD_DURATION);
              await distributor.unsubscribe(distribution, { from: user1 });

              expect(await distributor.totalEarned(distribution, user1)).to.be.almostEqualFp(30e3);
            });

            it('emits a Withdrawn event', async () => {
              const tx = await distributor.unsubscribe(distribution, { from: user1 });

              expectEvent.inReceipt(await tx.wait(), 'Withdrawn', {
                distribution,
                amount: balance,
                user: user1.address,
              });
            });
          });
        });
      });

      context('when the user was not subscribed yet', () => {
        it('reverts', async () => {
          await expect(distributor.unsubscribe(distribution, { from: user1 })).to.be.revertedWith(
            'DISTRIBUTION_NOT_SUBSCRIBED'
          );
        });
      });
    });

    context('when the distribution does not exist', () => {
      it('reverts', async () => {
        await expect(distributor.unsubscribe(ZERO_BYTES32, { from: user1 })).to.be.revertedWith(
          'DISTRIBUTION_DOES_NOT_EXIST'
        );
      });
    });
  });

  describe('claim', () => {
    sharedBeforeEach('create distributions', async () => {
      await distributor.newDistribution(stakingToken, rewardsToken, PERIOD_DURATION, { from: rewarder });
      await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
      distribution = await distributor.getDistributionId(stakingToken, rewardsToken, rewarder);
    });

    const itReceivesTheRewards = () => {
      it('transfers the reward tokens to the user', async () => {
        const rewards = await distributor.totalEarned(distribution, user1);

        await distributor.claim(distribution, { from: user1 });

        expect(await distributor.totalEarned(distribution, user1)).to.be.zero;
        expect(await rewardsToken.balanceOf(user1.address)).to.be.almostEqual(rewards);
      });

      it('transfer the tokens from the vault', async () => {
        const previousVaultBalance = await rewardsToken.balanceOf(distributor.vault.address);

        const rewards = await distributor.totalEarned(distribution, user1);
        await distributor.claim(distribution, { from: user1 });

        const currentVaultBalance = await rewardsToken.balanceOf(distributor.vault.address);
        expect(currentVaultBalance).to.be.equal(previousVaultBalance.sub(rewards));
      });

      it('does not update the reward per token', async () => {
        const previousRewardPerToken = await distributor.rewardPerToken(distribution);

        await distributor.claim(distribution, { from: user1 });

        const currentRewardPerToken = await distributor.rewardPerToken(distribution);
        expect(currentRewardPerToken).to.be.almostEqual(previousRewardPerToken);
      });

      it('updates the reward per token rates of the user', async () => {
        const previousRewardPerToken = await distributor.rewardPerToken(distribution);

        await distributor.claim(distribution, { from: user1 });

        const { unpaidRewards, paidRatePerToken } = await distributor.getUserDistribution(distribution, user1);
        expect(unpaidRewards).to.be.almostEqual(0);
        expect(paidRatePerToken).to.be.almostEqual(previousRewardPerToken);
      });

      it('emits a RewardPaid', async () => {
        const expectedAmount = await distributor.totalEarned(distribution, user1);

        const tx = await distributor.claim(distribution, { from: user1 });

        expectEvent.inReceipt(await tx.wait(), 'RewardPaid', {
          user: user1.address,
          rewardToken: rewardsToken.address,
          amount: expectedAmount,
        });
      });
    };

    const itIgnoresTheRequest = (updatesUserPaidRate = false) => {
      it('does not transfer any reward tokens to the user', async () => {
        await distributor.claim(distribution, { from: user1 });

        expect(await distributor.totalEarned(distribution, user1)).to.be.almostEqualFp(0);
        expect(await rewardsToken.balanceOf(user1)).to.be.almostEqualFp(0);
      });

      it('does not update the reward per token', async () => {
        const previousRewardPerToken = await distributor.rewardPerToken(distribution);

        await distributor.claim(distribution, { from: user1 });

        const currentRewardPerToken = await distributor.rewardPerToken(distribution);
        expect(currentRewardPerToken).to.be.almostEqual(previousRewardPerToken);
      });

      it(`${updatesUserPaidRate ? 'updates' : 'does not update'} the reward per token rates of the user`, async () => {
        const rewardPerToken = await distributor.rewardPerToken(distribution);

        await distributor.claim(distribution, { from: user1 });

        const { unpaidRewards, paidRatePerToken } = await distributor.getUserDistribution(distribution, user1);
        expect(unpaidRewards).to.be.zero;
        expect(paidRatePerToken).to.be.equal(updatesUserPaidRate ? rewardPerToken : 0);
      });

      it('does not emit a RewardPaid event', async () => {
        const tx = await distributor.claim(distribution, { from: user1 });

        expectEvent.notEmitted(await tx.wait(), 'RewardPaid');
      });
    };

    context('when there was no other stake from other users', () => {
      context('when the user had some stake', () => {
        sharedBeforeEach('stake some amount', async () => {
          await stakingToken.mint(user1, fp(1));
          await stakingToken.approve(distributor, fp(1), { from: user1 });
          await distributor.stake(stakingToken, fp(1), { from: user1 });
        });

        context('when the user was subscribed to a distribution', () => {
          sharedBeforeEach('subscribe distribution', async () => {
            await distributor.subscribe(distribution, { from: user1 });
            await advanceTime(PERIOD_DURATION);
          });

          itReceivesTheRewards();
        });

        context('when the user was not subscribed to a distribution', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(PERIOD_DURATION);
          });

          itIgnoresTheRequest();
        });
      });

      context('when the user did not stake', () => {
        context('when the user was subscribed to a distribution', () => {
          sharedBeforeEach('subscribe distribution', async () => {
            await distributor.subscribe(distribution, { from: user1 });
            await advanceTime(PERIOD_DURATION);
          });

          itIgnoresTheRequest();
        });

        context('when the user was not subscribed to a distribution', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(PERIOD_DURATION);
          });

          itIgnoresTheRequest();
        });
      });
    });

    context('when there were some other staking users', () => {
      sharedBeforeEach('stake some amount', async () => {
        await distributor.subscribeAndStake(distribution, stakingToken, fp(2), { from: user2 });
        await advanceTime(PERIOD_DURATION);
      });

      context('when the user had some stake', () => {
        sharedBeforeEach('stake some amount', async () => {
          await stakingToken.mint(user1, fp(1));
          await stakingToken.approve(distributor, fp(1), { from: user1 });
          await distributor.stake(stakingToken, fp(1), { from: user1 });
          await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
        });

        context('when the user was subscribed to a distribution', () => {
          sharedBeforeEach('subscribe distribution', async () => {
            await distributor.subscribe(distribution, { from: user1 });
            await advanceTime(PERIOD_DURATION);
          });

          itReceivesTheRewards();
        });

        context('when the user was not subscribed to a distribution', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(PERIOD_DURATION);
          });

          itIgnoresTheRequest();
        });
      });

      context('when the user did not have stake', () => {
        context('when the user was subscribed to a distribution', () => {
          sharedBeforeEach('subscribe distribution', async () => {
            await distributor.subscribe(distribution, { from: user1 });
            await advanceTime(PERIOD_DURATION);
          });

          itIgnoresTheRequest(true);
        });

        context('when the user was not subscribed to a distribution', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(PERIOD_DURATION);
          });

          itIgnoresTheRequest();
        });
      });
    });
  });

  describe('exit', () => {
    const balance = fp(1);

    sharedBeforeEach('create distributions', async () => {
      await distributor.newDistribution(stakingToken, rewardsToken, PERIOD_DURATION, { from: rewarder });
      await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
      distribution = await distributor.getDistributionId(stakingToken, rewardsToken, rewarder);
    });

    const itWithdrawsAndClaims = () => {
      it('transfers all the staking tokens to the user', async () => {
        const previousUserBalance = await stakingToken.balanceOf(user1.address);
        const previousDistributorBalance = await stakingToken.balanceOf(distributor.address);

        await distributor.exit(stakingToken, distribution, { from: user1 });

        const currentUserBalance = await stakingToken.balanceOf(user1.address);
        expect(currentUserBalance).be.equal(previousUserBalance.add(balance));

        const currentStakingBalance = await stakingToken.balanceOf(distributor.address);
        expect(currentStakingBalance).be.equal(previousDistributorBalance.sub(balance));
      });

      it('decreases the staking balance of the user to zero', async () => {
        await distributor.exit(stakingToken, distribution, { from: user1 });

        const currentBalance = await distributor.balanceOf(stakingToken, user1);
        expect(currentBalance).be.equal(0);
      });

      it('decreases the supply of the distribution', async () => {
        const previousSupply = await distributor.totalSupply(distribution);

        await distributor.exit(stakingToken, distribution, { from: user1 });

        const currentSupply = await distributor.totalSupply(distribution);
        expect(currentSupply).be.equal(previousSupply.sub(balance));
      });

      it('updates the last update time of the distribution', async () => {
        const { periodFinish } = await distributor.getDistribution(distribution);
        await distributor.exit(stakingToken, distribution, { from: user1 });

        // Since we accrued rewards for the entire period, it is cap to the period end date time
        const currentData = await distributor.getDistribution(distribution);
        expect(currentData.lastUpdateTime).to.be.at.equal(periodFinish);
      });

      it('claims the user rewards', async () => {
        const expectedRewards = await distributor.totalEarned(distribution, user1);

        await distributor.exit(stakingToken, distribution, { from: user1 });

        expect(await distributor.totalEarned(distribution, user1)).to.be.zero;
        expect(await rewardsToken.balanceOf(user1)).to.be.almostEqual(expectedRewards);
      });

      it('emits a Withdrawn event', async () => {
        const tx = await distributor.exit(stakingToken, distribution, { from: user1 });

        expectEvent.inReceipt(await tx.wait(), 'Withdrawn', {
          distribution,
          user: user1.address,
          amount: balance,
        });
      });

      it('emits a RewardPaid', async () => {
        const expectedAmount = await distributor.totalEarned(distribution, user1);

        const tx = await distributor.exit(stakingToken, distribution, { from: user1 });

        expectEvent.inReceipt(await tx.wait(), 'RewardPaid', {
          user: user1.address,
          rewardToken: rewardsToken.address,
          amount: expectedAmount,
        });
      });
    };

    const itWithdraws = () => {
      it('transfers all the staking tokens to the user', async () => {
        const previousUserBalance = await stakingToken.balanceOf(user1.address);
        const previousDistributorBalance = await stakingToken.balanceOf(distributor.address);

        await distributor.exit(stakingToken, distribution, { from: user1 });

        const currentUserBalance = await stakingToken.balanceOf(user1.address);
        expect(currentUserBalance).be.equal(previousUserBalance.add(balance));

        const currentStakingBalance = await stakingToken.balanceOf(distributor.address);
        expect(currentStakingBalance).be.equal(previousDistributorBalance.sub(balance));
      });

      it('decreases the staking balance of the user to zero', async () => {
        await distributor.exit(stakingToken, distribution, { from: user1 });

        const currentBalance = await distributor.balanceOf(stakingToken, user1);
        expect(currentBalance).be.equal(0);
      });

      it('does not decrease the supply of the distribution', async () => {
        const previousSupply = await distributor.totalSupply(distribution);

        await distributor.exit(stakingToken, distribution, { from: user1 });

        const currentSupply = await distributor.totalSupply(distribution);
        expect(currentSupply).be.equal(previousSupply);
      });

      it('does not update the last update time of the distribution', async () => {
        const { lastUpdateTime: previousUpdateTime } = await distributor.getDistribution(distribution);

        await distributor.exit(stakingToken, distribution, { from: user1 });

        const { lastUpdateTime: currentUpdateTime } = await distributor.getDistribution(distribution);
        expect(currentUpdateTime).to.be.at.equal(previousUpdateTime);
      });

      it('does not claim the user rewards', async () => {
        const previousBalance = await rewardsToken.balanceOf(user1);

        await distributor.exit(stakingToken, distribution, { from: user1 });

        const currentBalance = await rewardsToken.balanceOf(user1);
        expect(currentBalance).to.be.equal(previousBalance);
      });

      it('does not emit a Withdrawn event', async () => {
        const tx = await distributor.exit(stakingToken, distribution, { from: user1 });
        expectEvent.notEmitted(await tx.wait(), 'Withdrawn');
      });

      it('does not emit a RewardPaid', async () => {
        const tx = await distributor.exit(stakingToken, distribution, { from: user1 });
        expectEvent.notEmitted(await tx.wait(), 'RewardPaid');
      });
    };

    context('when there was no other stake from other users', () => {
      context('when the user had some stake', () => {
        sharedBeforeEach('stake some amount', async () => {
          await stakingToken.mint(user1, balance);
          await stakingToken.approve(distributor, balance, { from: user1 });
          await distributor.stake(stakingToken, balance, { from: user1 });
        });

        context('when the user was subscribed to a distribution', () => {
          sharedBeforeEach('subscribe distribution', async () => {
            await distributor.subscribe(distribution, { from: user1 });
            await advanceTime(PERIOD_DURATION);
          });

          itWithdrawsAndClaims();

          it('updates the reward rate stored of the distribution', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            // Only user with the entire period staked
            const currentData = await distributor.getDistribution(distribution);
            expect(currentData.rewardPerTokenStored).to.be.almostEqualFp(90e3);
          });

          it('updates the reward per token rates of the user', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            const { unpaidRewards, paidRatePerToken } = await distributor.getUserDistribution(distribution, user1);
            expect(unpaidRewards).to.be.zero;

            // Only user with the entire period staked
            expect(paidRatePerToken).to.be.almostEqualFp(90e3);
          });

          it('stops tracking it for future rewards', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(90e3);

            await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
            await advanceTime(PERIOD_DURATION);

            expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(90e3);
          });
        });

        context('when the user was not subscribed to a distribution', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(PERIOD_DURATION);
          });

          itWithdraws();

          it('does not update the reward rate stored of the distribution', async () => {
            const previousData = await distributor.getDistribution(distribution);

            await distributor.exit(stakingToken, distribution, { from: user1 });

            const currentData = await distributor.getDistribution(distribution);
            expect(currentData.rewardPerTokenStored).to.be.equal(previousData.rewardPerTokenStored);
          });

          it('does not update the reward per token rates of the user', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            const { unpaidRewards, paidRatePerToken } = await distributor.getUserDistribution(distribution, user1);
            expect(unpaidRewards).to.be.zero;
            expect(paidRatePerToken).to.be.zero;
          });

          it('does not track it for future rewards', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            expect(await distributor.rewardPerToken(distribution)).to.be.zero;

            await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
            await advanceTime(PERIOD_DURATION);

            expect(await distributor.rewardPerToken(distribution)).to.be.zero;
          });
        });
      });

      context('when the user did not stake', () => {
        context('when the user was subscribed to a distribution', () => {
          sharedBeforeEach('subscribe distribution', async () => {
            await distributor.subscribe(distribution, { from: user1 });
            await advanceTime(PERIOD_DURATION);
          });

          it('reverts', async () => {
            await expect(distributor.exit(stakingToken, distribution, { from: user1 })).to.be.revertedWith(
              'Cannot withdraw 0'
            );
          });
        });

        context('when the user was not subscribed to a distribution', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(PERIOD_DURATION);
          });

          it('reverts', async () => {
            await expect(distributor.exit(stakingToken, distribution, { from: user1 })).to.be.revertedWith(
              'Cannot withdraw 0'
            );
          });
        });
      });
    });

    context('when there was stake from other users', () => {
      sharedBeforeEach('stake some amount', async () => {
        await distributor.subscribeAndStake(distribution, stakingToken, fp(2), { from: user2 });
        await advanceTime(PERIOD_DURATION);
      });

      context('when the user had some stake', () => {
        sharedBeforeEach('stake some amount', async () => {
          await stakingToken.mint(user1, balance);
          await stakingToken.approve(distributor, balance, { from: user1 });
          await distributor.stake(stakingToken, balance, { from: user1 });
          await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
        });

        context('when the user was subscribed to a distribution', () => {
          sharedBeforeEach('subscribe distribution', async () => {
            await distributor.subscribe(distribution, { from: user1 });
            await advanceTime(PERIOD_DURATION);
          });

          itWithdrawsAndClaims();

          it('updates the reward rate stored of the distribution', async () => {
            // User #2 has staked 2 tokens for 1 period
            const previousData = await distributor.getDistribution(distribution);
            expect(previousData.rewardPerTokenStored).to.be.almostEqualFp(45e3);

            await distributor.exit(stakingToken, distribution, { from: user1 });

            // User #1 joins with 1 token for 1 period
            const currentData = await distributor.getDistribution(distribution);
            expect(currentData.rewardPerTokenStored).to.be.almostEqualFp(75e3);
          });

          it('updates the reward per token rates of the user', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            const { unpaidRewards, paidRatePerToken } = await distributor.getUserDistribution(distribution, user1);
            expect(unpaidRewards).to.be.zero;

            // User #2 has staked 2 tokens for 2 periods, while user #1 staked 1 token for 1 period
            expect(paidRatePerToken).to.be.almostEqualFp(75e3);
          });

          it('stops tracking it for future rewards', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            // User #2 has staked 2 tokens for 2 periods, while user #1 staked 1 token for 1 period
            expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(75e3);

            await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
            await advanceTime(PERIOD_DURATION);

            // User #2 continues with 2 tokens for one more period
            expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(120e3);
          });
        });

        context('when the user was not subscribed to a distribution', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(PERIOD_DURATION);
          });

          itWithdraws();

          it('does not update the reward rate stored of the distribution', async () => {
            const previousData = await distributor.getDistribution(distribution);

            await distributor.exit(stakingToken, distribution, { from: user1 });

            const currentData = await distributor.getDistribution(distribution);
            expect(currentData.rewardPerTokenStored).to.be.equal(previousData.rewardPerTokenStored);
          });

          it('does not update the reward per token rates of the user', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            const { unpaidRewards, paidRatePerToken } = await distributor.getUserDistribution(distribution, user1);
            expect(unpaidRewards).to.be.zero;
            expect(paidRatePerToken).to.be.zero;
          });

          it('does not track it for future rewards', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            // The other user has staked for 2 periods with 2 tokens
            expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(90e3);

            await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
            await advanceTime(PERIOD_DURATION);

            // The other user continues with his stake of 2 tokens
            expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(135e3);
          });
        });
      });

      context('when the user did not stake', () => {
        context('when the user was subscribed to a distribution', () => {
          sharedBeforeEach('subscribe distribution', async () => {
            await distributor.subscribe(distribution, { from: user1 });
            await advanceTime(PERIOD_DURATION);
          });

          it('reverts', async () => {
            await expect(distributor.exit(stakingToken, distribution, { from: user1 })).to.be.revertedWith(
              'Cannot withdraw 0'
            );
          });
        });

        context('when the user was not subscribed to a distribution', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(PERIOD_DURATION);
          });

          it('reverts', async () => {
            await expect(distributor.exit(stakingToken, distribution, { from: user1 })).to.be.revertedWith(
              'Cannot withdraw 0'
            );
          });
        });
      });
    });
  });

  describe('integration', () => {
    sharedBeforeEach('create distribution', async () => {
      await distributor.newDistribution(stakingToken, rewardsToken, PERIOD_DURATION, { from: rewarder });
      await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
      distribution = await distributor.getDistributionId(stakingToken, rewardsToken, rewarder);
    });

    const assertUserRewards = async (
      user: SignerWithAddress,
      rewards: { rate: BigNumberish; paid: BigNumberish; earned: BigNumberish }
    ) => {
      const earned = await distributor.totalEarned(distribution, user);
      const rewardPerToken = await distributor.rewardPerToken(distribution);
      const { paidRatePerToken } = await distributor.getUserDistribution(distribution, user);

      expect(earned).to.be.almostEqualFp(rewards.earned);
      expect(paidRatePerToken).to.be.almostEqualFp(rewards.paid);
      expect(rewardPerToken.sub(paidRatePerToken)).to.be.almostEqualFp(rewards.rate);
    };

    it('starts with no reward per token', async () => {
      expect(await distributor.rewardPerToken(distribution)).to.be.zero;
      expect(await distributor.balanceOf(stakingToken, user1)).to.be.zero;

      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });
    });

    it('one user stakes solo', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION);
      await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
      await advanceTime(PERIOD_DURATION);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(180000);
      await assertUserRewards(user1, { rate: 180000, paid: 0, earned: 180000 });

      await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
      await advanceTime(PERIOD_DURATION);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(270000);
      await assertUserRewards(user1, { rate: 270000, paid: 0, earned: 270000 });
    });

    it('one user stakes late', async () => {
      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqual(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      // First third of the period with no staked balance
      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqual(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      // Second third of the period with 1 staked token: 30k rewards for the user
      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(30000);
      await assertUserRewards(user1, { rate: 30000, paid: 0, earned: 30000 });

      // Last third of the period with 1 staked token: 60k rewards for the user
      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(60000);
      await assertUserRewards(user1, { rate: 60000, paid: 0, earned: 60000 });

      // Another third of a period without new rewards: 60k rewards for the user
      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(60000);
      await assertUserRewards(user1, { rate: 60000, paid: 0, earned: 60000 });

      // Add new rewards to the distribution
      await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(60000);

      // Advance half of the reward period: 60k + 45k = 105k rewards (the 15k of the previous period are lost)
      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(105000);
      await assertUserRewards(user1, { rate: 105000, paid: 0, earned: 105000 });
    });

    it('one user withdraws early', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqual(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 45000, paid: 0, earned: 45000 });

      await distributor.withdraw(stakingToken, fp(1), { from: user1 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 0, paid: 45000, earned: 45000 });

      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 0, paid: 45000, earned: 45000 });
    });

    it('one user unsubscribes early', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqual(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 45000, paid: 0, earned: 45000 });

      await distributor.unsubscribe(distribution, { from: user1 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 0, paid: 45000, earned: 45000 });

      await stakingToken.mint(user1, fp(1));
      await stakingToken.approve(distributor, fp(1), { from: user1 });
      await distributor.stake(stakingToken, fp(1), { from: user1 });
      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 0, paid: 45000, earned: 45000 });
    });

    it('two users with the same stakes wait 1 period', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user2 });

      // It is not exactly zero because some time passed since the first user has staked
      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(0.13888);
      await assertUserRewards(user1, { rate: 0.13888, paid: 0, earned: 0.13888 });
      await assertUserRewards(user2, { rate: 0, paid: 0.13888, earned: 0 });

      await advanceTime(PERIOD_DURATION);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 45000, paid: 0, earned: 45000 });
      await assertUserRewards(user2, { rate: 45000, paid: 0.13888, earned: 45000 });
    });

    it('two users with different stakes (1:3) wait 1 period', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });
      await distributor.subscribeAndStake(distribution, stakingToken, fp(3), { from: user2 });

      // It is not exactly zero because some time passed since the first user has staked
      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(0.13888);
      await assertUserRewards(user1, { rate: 0.13888, paid: 0, earned: 0.13888 });
      await assertUserRewards(user2, { rate: 0, paid: 0.13888, earned: 0 });

      await advanceTime(PERIOD_DURATION);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(22500);
      await assertUserRewards(user1, { rate: 22500, paid: 0, earned: 22500 });
      await assertUserRewards(user2, { rate: 22500, paid: 0.13888, earned: 67500 });
    });

    it('two users with different stakes (1:3) wait 1.5 periods starting late', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });
      await assertUserRewards(user2, { rate: 0, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 45000, paid: 0, earned: 45000 });
      await assertUserRewards(user2, { rate: 45000, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(2), { from: user2 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 45000, paid: 0, earned: 45000 });
      await assertUserRewards(user2, { rate: 0, paid: 45000, earned: 0 });

      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(60000);
      await assertUserRewards(user1, { rate: 60000, paid: 0, earned: 60000 });
      await assertUserRewards(user2, { rate: 15000, paid: 45000, earned: 30000 });

      await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(75000);
      await assertUserRewards(user1, { rate: 75000, paid: 0, earned: 75000 });
      await assertUserRewards(user2, { rate: 30000, paid: 45000, earned: 60000 });
    });

    it('two users with different stakes (1:3) wait 2 periods', async () => {
      //
      // 1x: +----------------+ = 90k for 30d + 22.5k for 60d
      // 3x:         +--------+ =  0k for 30d + 67.5k for 60d
      //

      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });
      await assertUserRewards(user2, { rate: 0, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION);
      await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(90000);
      await assertUserRewards(user1, { rate: 90000, paid: 0, earned: 90000 });
      await assertUserRewards(user2, { rate: 90000, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(3), { from: user2 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(90000);
      await assertUserRewards(user1, { rate: 90000, paid: 0, earned: 90000 });
      await assertUserRewards(user2, { rate: 0, paid: 90000, earned: 0 });

      await advanceTime(PERIOD_DURATION);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(112500);
      await assertUserRewards(user1, { rate: 112500, paid: 0, earned: 112500 });
      await assertUserRewards(user2, { rate: 22500, paid: 90000, earned: 67500 });
    });

    it('two users with the different stakes (1:3) wait 3 periods with a reward rate change', async () => {
      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });
      await assertUserRewards(user2, { rate: 0, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });
      await distributor.subscribeAndStake(distribution, stakingToken, fp(3), { from: user2 });

      // It is not exactly zero because some time passed since the first user has staked
      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(0.13888);
      await assertUserRewards(user1, { rate: 0.13888, paid: 0, earned: 0.13888 });
      await assertUserRewards(user2, { rate: 0, paid: 0.13888, earned: 0 });

      await advanceTime(PERIOD_DURATION);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(22500);
      await assertUserRewards(user1, { rate: 22500, paid: 0, earned: 22500 });
      await assertUserRewards(user2, { rate: 22500, paid: 0.13888, earned: 67500 });

      // Reward but with 30k instead of 90k
      await distributor.reward(stakingToken, rewardsToken, REWARDS.div(3), { from: rewarder });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(22500);
      await assertUserRewards(user1, { rate: 22500, paid: 0, earned: 22500 });
      await assertUserRewards(user2, { rate: 22500, paid: 0.13888, earned: 67500 });

      await distributor.exit(stakingToken, distribution, { from: user2 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(22500);
      await assertUserRewards(user1, { rate: 22500, paid: 0, earned: 22500 });
      await assertUserRewards(user2, { rate: 0, paid: 22500, earned: 0 });

      await advanceTime(PERIOD_DURATION);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(52500);
      await assertUserRewards(user1, { rate: 52500, paid: 0, earned: 52500 });
      await assertUserRewards(user2, { rate: 30000, paid: 22500, earned: 0 });

      await stakingToken.approve(distributor, fp(2), { from: user2 });
      await distributor.stake(stakingToken, fp(2), { from: user2 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(52500);
      await assertUserRewards(user1, { rate: 52500, paid: 0, earned: 52500 });
      await assertUserRewards(user2, { rate: 0, paid: 52500, earned: 0 });

      // Reward but with 30k instead of 90k
      await distributor.reward(stakingToken, rewardsToken, REWARDS.div(3), { from: rewarder });
      await advanceTime(PERIOD_DURATION);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(62500);
      await assertUserRewards(user1, { rate: 62500, paid: 0, earned: 62500 });
      await assertUserRewards(user2, { rate: 10000, paid: 52500, earned: 20000 });
    });

    it('three users with different stakes (1:3:5) wait 3 periods', async () => {
      //
      // 1x: +-------+---------+-------+ = 22,5k for 30d + 10k for 60d + 15k for 90d
      // 3x: +-------+---------+         = 67,5k for 30d + 30k for 60d +  0k for 90d
      // 5x:         +---------+-------+ =    0k for 30d + 50k for 60d + 75k for 90d
      //

      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });
      await distributor.subscribeAndStake(distribution, stakingToken, fp(3), { from: user2 });

      // It is not exactly zero because some time passed since the first user has staked
      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(0.13888);
      await assertUserRewards(user1, { rate: 0.13888, paid: 0, earned: 0.13888 });
      await assertUserRewards(user2, { rate: 0, paid: 0.13888, earned: 0 });
      await assertUserRewards(user3, { rate: 0.13888, paid: 0, earned: 0 });
      await advanceTime(PERIOD_DURATION);
      await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(22500);
      await assertUserRewards(user1, { rate: 22500, paid: 0, earned: 22500 });
      await assertUserRewards(user2, { rate: 22500, paid: 0.13888, earned: 67500 });
      await assertUserRewards(user3, { rate: 22500, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(5), { from: user3 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(22500);
      await assertUserRewards(user1, { rate: 22500, paid: 0, earned: 22500 });
      await assertUserRewards(user2, { rate: 22500, paid: 0.13888, earned: 67500 });
      await assertUserRewards(user3, { rate: 0, paid: 22500, earned: 0 });

      await advanceTime(PERIOD_DURATION);
      await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(32500);
      await assertUserRewards(user1, { rate: 32500, paid: 0, earned: 32500 });
      await assertUserRewards(user2, { rate: 32500, paid: 0.13888, earned: 97500 });
      await assertUserRewards(user3, { rate: 10000, paid: 22500, earned: 50000 });

      await distributor.unsubscribe(distribution, { from: user2 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(32500);
      await assertUserRewards(user1, { rate: 32500, paid: 0, earned: 32500 });
      await assertUserRewards(user2, { rate: 0, paid: 32500, earned: 97500 });
      await assertUserRewards(user3, { rate: 10000, paid: 22500, earned: 50000 });

      await distributor.exit(stakingToken, distribution, { from: user2 });
      await advanceTime(PERIOD_DURATION);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(47500);
      await assertUserRewards(user1, { rate: 47500, paid: 0, earned: 47500 });
      await assertUserRewards(user2, { rate: 15000, paid: 32500, earned: 0 });
      await assertUserRewards(user3, { rate: 25000, paid: 22500, earned: 125000 });
    });

    it('three users with different stakes (1:3:5) wait 3 periods withdraw early', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });
      await distributor.subscribeAndStake(distribution, stakingToken, fp(2), { from: user2 });

      // It is not exactly zero because some time passed since the first user has staked
      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(0.13888);
      await assertUserRewards(user1, { rate: 0.13888, paid: 0, earned: 0.13888 });
      await assertUserRewards(user2, { rate: 0, paid: 0.13888, earned: 0 });
      await assertUserRewards(user3, { rate: 0.13888, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(10000);
      await assertUserRewards(user1, { rate: 10000, paid: 0, earned: 10000 });
      await assertUserRewards(user2, { rate: 10000, paid: 0.13888, earned: 20000 });
      await assertUserRewards(user3, { rate: 10000, paid: 0, earned: 0 });

      await distributor.withdraw(stakingToken, fp(2), { from: user2 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(10000);
      await assertUserRewards(user1, { rate: 10000, paid: 0, earned: 10000 });
      await assertUserRewards(user2, { rate: 0, paid: 10000, earned: 20000 });
      await assertUserRewards(user3, { rate: 10000, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(40000);
      await assertUserRewards(user1, { rate: 40000, paid: 0, earned: 40000 });
      await assertUserRewards(user2, { rate: 30000, paid: 10000, earned: 20000 });
      await assertUserRewards(user3, { rate: 40000, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(5), { from: user3 });

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(40000);
      await assertUserRewards(user1, { rate: 40000, paid: 0, earned: 40000 });
      await assertUserRewards(user2, { rate: 30000, paid: 10000, earned: 20000 });
      await assertUserRewards(user3, { rate: 0, paid: 40000, earned: 0 });

      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 45000, paid: 0, earned: 45000 });
      await assertUserRewards(user2, { rate: 35000, paid: 10000, earned: 20000 });
      await assertUserRewards(user3, { rate: 5000, paid: 40000, earned: 25000 });

      await distributor.reward(stakingToken, rewardsToken, REWARDS, { from: rewarder });
      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.rewardPerToken(distribution)).to.be.almostEqualFp(50000);
      await assertUserRewards(user1, { rate: 50000, paid: 0, earned: 50000 });
      await assertUserRewards(user2, { rate: 40000, paid: 10000, earned: 20000 });
      await assertUserRewards(user3, { rate: 10000, paid: 40000, earned: 50000 });
    });
  });
});
