import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { signPermit, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { advanceTime, currentTimestamp } from '@balancer-labs/v2-helpers/src/time';

import {
  rewardsDuration,
  rewardsVestingTime,
  rewardTokenInitialBalance,
  setup,
  tokenInitialBalance,
} from './MultiRewardsSharedSetup';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('Staking contract', () => {
  let admin: SignerWithAddress, lp: SignerWithAddress, other: SignerWithAddress, rewarder: SignerWithAddress;

  let rewardTokens: TokenList;
  let authorizer: Contract, vault: Contract, stakingContract: Contract, pool: Contract;
  let rewardToken: Token;

  before('deploy base contracts', async () => {
    [, admin, lp, rewarder, other] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager', async () => {
    const { contracts } = await setup();

    authorizer = contracts.authorizer;
    pool = contracts.pool;
    vault = contracts.vault;
    stakingContract = contracts.stakingContract;
    rewardToken = contracts.rewardTokens.DAI;
    rewardTokens = contracts.rewardTokens;
  });

  describe('authorizer', () => {
    it('uses the authorizer of the vault', async () => {
      expect(await stakingContract.getAuthorizer()).to.equal(authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      const action = await actionId(vault, 'setAuthorizer');
      await authorizer.connect(admin).grantRole(action, admin.address);

      await vault.connect(admin).setAuthorizer(other.address);

      expect(await stakingContract.getAuthorizer()).to.equal(other.address);
    });
  });

  it('reverts if a rewarder attempts to setRewardsDuration before adding a reward', async () => {
    await expect(
      stakingContract.connect(rewarder).setRewardsDuration(pool.address, rewardToken.address, fp(1000))
    ).to.be.revertedWith('Reward must be configured with addReward');
  });

  it('reverts if a rewarder attempts to notifyRewardAmount before adding a reward', async () => {
    await expect(
      stakingContract.connect(rewarder).notifyRewardAmount(pool.address, rewardToken.address, fp(100))
    ).to.be.revertedWith('Reward must be configured with addReward');
  });

  describe('addReward', () => {
    it('sets up a reward for an asset manager', async () => {
      // TODO: implement, this test wasn't checking the reward creation
      await stakingContract.connect(rewarder).addReward(pool.address, rewardToken.address, rewardsDuration);
    });
  });

  describe('subscribe', () => {
    context('when there are some distribution created', () => {
      let distributions: string[];

      sharedBeforeEach('add distributions', async () => {
        distributions = await rewardTokens.asyncMap(async (rewardToken) => {
          await stakingContract.connect(rewarder).addReward(pool.address, rewardToken.address, rewardsDuration);
          return stakingContract.getDistributionId(pool.address, rewardToken.address, rewarder.address);
        });
      });

      context('when the user was not subscribed to the given distributions', () => {
        let balance: BigNumber;

        sharedBeforeEach('approve staking token', async () => {
          balance = await pool.balanceOf(lp.address);
          await pool.connect(lp).approve(stakingContract.address, balance);
        });

        const itSubscribesTheUser = () => {
          it('subscribes the user to the distributions', async () => {
            await stakingContract.connect(lp).subscribe(distributions);

            await Promise.all(
              distributions.map(async (id) => expect(await stakingContract.isSubscribed(id, lp.address)).to.be.true)
            );
          });

          it('does not affect the user staked balance', async () => {
            const previousBalance = await stakingContract.balanceOf(pool.address, lp.address);

            await stakingContract.connect(lp).subscribe(distributions);

            const currentBalance = await stakingContract.balanceOf(pool.address, lp.address);
            expect(currentBalance).to.be.equal(previousBalance);
          });
        };

        const itStakesTheUserBalance = () => {
          it('updates the distribution supply', async () => {
            const previousSupplies = await Promise.all(distributions.map((id) => stakingContract.totalSupply(id)));

            await stakingContract.connect(lp).subscribe(distributions);

            await Promise.all(
              distributions.map(async (id, i) =>
                expect(await stakingContract.totalSupply(id)).to.be.equal(previousSupplies[i].add(balance))
              )
            );
          });

          it('emits staked events', async () => {
            const receipt = await (await stakingContract.connect(lp).subscribe(distributions)).wait();

            distributions.forEach((distribution) => {
              expectEvent.inReceipt(receipt, 'Staked', {
                distribution: distribution,
                amount: balance,
                user: lp.address,
              });
            });
          });
        };

        const itDoesNotStakeTheUserBalance = () => {
          it('does not update the distribution supply', async () => {
            const previousSupplies = await Promise.all(distributions.map((id) => stakingContract.totalSupply(id)));

            await stakingContract.connect(lp).subscribe(distributions);

            await Promise.all(
              distributions.map(async (id, i) =>
                expect(await stakingContract.totalSupply(id)).to.be.equal(previousSupplies[i])
              )
            );
          });

          it('does not emit staked events', async () => {
            const tx = await stakingContract.connect(lp).subscribe(distributions);
            expectEvent.notEmitted(await tx.wait(), 'Staked');
          });
        };

        context('when there were no rewards configured for the given distribution', () => {
          const itDoesNotUpdateTheDistributionRates = () => {
            it('does not update the distribution rates', async () => {
              await stakingContract.connect(lp).subscribe(distributions);

              for (const id of distributions) {
                const { rewardRate, lastUpdateTime, rewardPerTokenStored } = await stakingContract.getDistribution(id);
                expect(rewardRate).to.be.zero;
                expect(lastUpdateTime).to.be.zero;
                expect(rewardPerTokenStored).to.be.zero;
              }
            });
          };

          context('when the user had already staked', () => {
            let balance: BigNumber;

            sharedBeforeEach('stake', async () => {
              balance = await pool.balanceOf(lp.address);
              await pool.connect(lp).approve(stakingContract.address, balance);
              await stakingContract.connect(lp).stake(pool.address, balance);
            });

            itSubscribesTheUser();
            itStakesTheUserBalance();
            itDoesNotUpdateTheDistributionRates();
          });

          context('when the user did not stake yet', () => {
            itSubscribesTheUser();
            itDoesNotStakeTheUserBalance();
            itDoesNotUpdateTheDistributionRates();
          });
        });

        context('when there were some rewards already configured for the given distribution', () => {
          const rewards = fp(1000);

          sharedBeforeEach('add rewards', async () => {
            await rewardTokens.mint({ to: rewarder, amount: rewards });
            await rewardTokens.approve({ to: stakingContract.address, from: [rewarder] });
            await rewardTokens.asyncEach(async (rewardToken) => {
              await stakingContract.connect(rewarder).notifyRewardAmount(pool.address, rewardToken.address, rewards);
            });
          });

          const itUpdatesTheDistributionRates = () => {
            it('updates the distribution rates', async () => {
              const beforeSubscription = await currentTimestamp();

              for (const id of distributions) {
                const { rewardRate, lastUpdateTime, rewardPerTokenStored } = await stakingContract.getDistribution(id);
                expect(rewardRate).to.be.equal(rewards.div(rewardsDuration));
                expect(lastUpdateTime).to.be.at.most(beforeSubscription);
                expect(rewardPerTokenStored).to.be.zero;
              }

              await stakingContract.connect(lp).subscribe(distributions);

              for (const id of distributions) {
                const { rewardRate, lastUpdateTime, rewardPerTokenStored } = await stakingContract.getDistribution(id);
                expect(rewardRate).to.be.equal(rewards.div(rewardsDuration));
                expect(lastUpdateTime).to.be.at.least(beforeSubscription);
                expect(rewardPerTokenStored).to.be.zero;
              }
            });
          };

          context('when the user had already staked', () => {
            let balance: BigNumber;

            sharedBeforeEach('stake', async () => {
              balance = await pool.balanceOf(lp.address);
              await pool.connect(lp).approve(stakingContract.address, balance);
              await stakingContract.connect(lp).stake(pool.address, balance);
            });

            itSubscribesTheUser();
            itStakesTheUserBalance();
            itUpdatesTheDistributionRates();
          });

          context('when the user did not stake yet', () => {
            itSubscribesTheUser();
            itDoesNotStakeTheUserBalance();
            itUpdatesTheDistributionRates();
          });
        });
      });

      context('when the user was subscribed to one of the given distributions', () => {
        sharedBeforeEach('subscribe to all distributions', async () => {
          await stakingContract.connect(lp).subscribe([distributions[0]]);
        });

        it('reverts', async () => {
          await expect(stakingContract.connect(lp).subscribe(distributions)).to.be.revertedWith(
            'ALREADY_SUBSCRIBED_DISTRIBUTION'
          );
        });
      });

      context('when the user was subscribed to all the given distributions', () => {
        sharedBeforeEach('subscribe to all distributions', async () => {
          await stakingContract.connect(lp).subscribe(distributions);
        });

        it('reverts', async () => {
          await expect(stakingContract.connect(lp).subscribe(distributions)).to.be.revertedWith(
            'ALREADY_SUBSCRIBED_DISTRIBUTION'
          );
        });
      });
    });

    context('when there were no distributions created', () => {
      const distributions = [ZERO_BYTES32];

      it('reverts', async () => {
        await expect(stakingContract.connect(lp).subscribe(distributions)).to.be.revertedWith(
          'DISTRIBUTION_DOES_NOT_EXIST'
        );
      });
    });
  });

  describe('stakeWithPermit', () => {
    sharedBeforeEach(async () => {
      await stakingContract.connect(rewarder).addReward(pool.address, rewardToken.address, rewardsDuration);

      const id = await stakingContract.getDistributionId(pool.address, rewardToken.address, rewarder.address);
      await stakingContract.connect(lp).subscribe([id]);
    });

    it('stakes with a permit signature', async () => {
      const bptBalance = await pool.balanceOf(lp.address);

      const { v, r, s } = await signPermit(pool, lp, stakingContract, bptBalance);
      await stakingContract.connect(other).stakeWithPermit(pool.address, bptBalance, lp.address, MAX_UINT256, v, r, s);

      const stakedBalance = await stakingContract.balanceOf(pool.address, lp.address);
      expect(stakedBalance).to.be.eq(bptBalance);
    });
  });

  describe('with two stakes', () => {
    const rewardAmount = fp(1);

    sharedBeforeEach(async () => {
      await stakingContract.connect(rewarder).addReward(pool.address, rewardToken.address, rewardsDuration);

      const id = await stakingContract.getDistributionId(pool.address, rewardToken.address, rewarder.address);
      await stakingContract.connect(lp).subscribe([id]);
      await stakingContract.connect(other).subscribe([id]);

      const bptBalance = await pool.balanceOf(lp.address);
      await pool.connect(lp).approve(stakingContract.address, bptBalance);

      // Stake 3/4 of the bpt to the LP and 1/4 to another address
      await stakingContract.connect(lp).stake(pool.address, bptBalance.mul(3).div(4));
      const args = [pool.address, bptBalance.div(4), other.address];
      await stakingContract.connect(lp).stakeFor(...args);
    });

    it('sends expected amount of reward token to the rewards contract', async () => {
      await expectBalanceChange(
        () => stakingContract.connect(rewarder).notifyRewardAmount(pool.address, rewardToken.address, rewardAmount),
        rewardTokens,
        [{ account: stakingContract, changes: { DAI: rewardAmount } }],
        vault
      );
    });

    it('emits RewardAdded when an allocation is stored', async () => {
      const tx = await stakingContract
        .connect(rewarder)
        .notifyRewardAmount(pool.address, rewardToken.address, rewardAmount);

      const id = await stakingContract.getDistributionId(pool.address, rewardToken.address, rewarder.address);
      expectEvent.inReceipt(await tx.wait(), 'RewardAdded', { distribution: id, amount: rewardAmount });
    });

    describe('when the rewarder has called notifyRewardAmount', () => {
      sharedBeforeEach(async () => {
        await stakingContract.connect(rewarder).notifyRewardAmount(pool.address, rewardToken.address, rewardAmount);
      });

      describe('and enough time has passed for all the reward to vest', async () => {
        sharedBeforeEach(async () => {
          await advanceTime(rewardsVestingTime);
        });

        it('distributes the reward according to the fraction of staked LP tokens', async () => {
          // 3/4 share
          const expectedReward = fp(0.75);
          const actualReward = await stakingContract.totalEarned(
            pool.address,
            rewardToken.address,
            rewarder.address,
            lp.address
          );

          expect(actualReward).to.be.equalWithError(expectedReward, 0.0001);

          // 1/4 share
          const expectedRewardOther = fp(0.25);
          const actualRewardOther = await stakingContract.totalEarned(
            pool.address,
            rewardToken.address,
            rewarder.address,
            other.address
          );

          expect(actualRewardOther).to.be.equalWithError(expectedRewardOther, 0.0001);
        });

        it('allows a user to claim the reward to an EOA', async () => {
          const expectedReward = fp(0.75);

          await expectBalanceChange(() => stakingContract.connect(lp).getReward([pool.address]), rewardTokens, [
            { account: lp, changes: { DAI: ['very-near', expectedReward] } },
          ]);
        });

        it('allows a user to claim the reward to internal balance', async () => {
          const expectedReward = fp(0.75);

          await expectBalanceChange(
            () => stakingContract.connect(lp).getRewardAsInternalBalance([pool.address]),
            rewardTokens,
            [{ account: lp, changes: { DAI: ['very-near', expectedReward] } }],
            vault
          );
        });

        it('emits RewardPaid when an allocation is claimed', async () => {
          const expectedReward = bn('749999999999999623');

          const receipt = await (await stakingContract.connect(lp).getReward([pool.address])).wait();

          expectEvent.inReceipt(receipt, 'RewardPaid', {
            user: lp.address,
            rewardToken: rewardToken.address,
            amount: expectedReward,
          });
        });

        describe('with a second distribution from the same rewarder', () => {
          const secondRewardAmount = fp(2);

          sharedBeforeEach(async () => {
            await stakingContract
              .connect(rewarder)
              .notifyRewardAmount(pool.address, rewardToken.address, secondRewardAmount);
            // total reward = fp(3)
            await advanceTime(rewardsVestingTime);
          });

          it('calculates totalEarned from both distributions', async () => {
            const expectedReward = rewardAmount.add(secondRewardAmount).mul(3).div(4);

            const actualReward = await stakingContract.totalEarned(
              pool.address,
              rewardToken.address,
              rewarder.address,
              lp.address
            );
            expect(actualReward).to.be.equalWithError(expectedReward, 0.0001);
          });
        });

        describe('with a second distributions from another rewarder', () => {
          const secondRewardAmount = fp(2);

          sharedBeforeEach(async () => {
            await rewardTokens.mint({ to: other, amount: rewardTokenInitialBalance });
            await rewardTokens.approve({ to: stakingContract.address, from: [other] });

            await stakingContract.connect(other).addReward(pool.address, rewardToken.address, rewardsDuration);
            const id = await stakingContract.getDistributionId(pool.address, rewardToken.address, other.address);
            await stakingContract.connect(lp).subscribe([id]);
            await stakingContract.connect(other).subscribe([id]);

            await stakingContract
              .connect(other)
              .notifyRewardAmount(pool.address, rewardToken.address, secondRewardAmount);
            await advanceTime(rewardsVestingTime);
          });

          it('calculates totalEarned from both distributions', async () => {
            const expectedReward = fp(0.75).mul(3);

            const firstReward = await stakingContract.totalEarned(
              pool.address,
              rewardToken.address,
              rewarder.address,
              lp.address
            );

            const secondReward = await stakingContract.totalEarned(
              pool.address,
              rewardToken.address,
              other.address,
              lp.address
            );

            const totalReward = firstReward.add(secondReward);
            expect(totalReward).to.be.equalWithError(expectedReward, 0.0001);
          });

          it('calculates totalEarned from both distributions for the other user', async () => {
            const expectedReward = fp(0.25).mul(3);

            const firstReward = await stakingContract.totalEarned(
              pool.address,
              rewardToken.address,
              rewarder.address,
              other.address
            );

            const secondReward = await stakingContract.totalEarned(
              pool.address,
              rewardToken.address,
              other.address,
              other.address
            );

            const totalReward = firstReward.add(secondReward);
            expect(totalReward).to.be.equalWithError(expectedReward, 0.0001);
          });
        });
      });

      describe('with a second distribution from the same rewarder (before the first is finished vesting', () => {
        const secondRewardAmount = fp(2);
        let leftoverBalance: BigNumber;

        sharedBeforeEach(async () => {
          // advance half the time
          await advanceTime(rewardsDuration / 2);

          // claim rewards
          await stakingContract.connect(lp).getReward([pool.address]);
          const claimedBalance: BigNumber = await rewardToken.balanceOf(lp.address);
          leftoverBalance = rewardAmount.sub(claimedBalance);

          await stakingContract
            .connect(rewarder)
            .notifyRewardAmount(pool.address, rewardToken.address, secondRewardAmount);
          await advanceTime(rewardsVestingTime);
        });

        it('adds leftover correctly', async () => {
          const expectedReward = leftoverBalance.add(secondRewardAmount).mul(3).div(4);

          const actualReward = await stakingContract.totalEarned(
            pool.address,
            rewardToken.address,
            rewarder.address,
            lp.address
          );
          expect(actualReward).to.be.equalWithError(expectedReward, 0.05);
        });
      });
    });
  });

  describe('with two pools', async () => {
    let pool2: Contract;

    const rewardAmount = fp(1);

    sharedBeforeEach('deploy another pool', async () => {
      await stakingContract.connect(rewarder).addReward(pool.address, rewardToken.address, rewardsDuration);
      const distributionId = await stakingContract.getDistributionId(
        pool.address,
        rewardToken.address,
        rewarder.address
      );

      const poolTokens = await TokenList.create(['BAT', 'SNX'], { sorted: true });
      const assetManagers = Array(poolTokens.length).fill(rewarder.address);

      pool2 = await deploy('v2-pool-weighted/WeightedPool', {
        args: [
          vault.address,
          'Test Pool2',
          'TEST2',
          poolTokens.addresses,
          [fp(0.5), fp(0.5)],
          assetManagers,
          fp(0.0001),
          0,
          0,
          admin.address,
        ],
      });
      const poolId = await pool2.getPoolId();

      await stakingContract.connect(rewarder).addReward(pool2.address, rewardToken.address, rewardsDuration);
      const distributionId2 = await stakingContract.getDistributionId(
        pool2.address,
        rewardToken.address,
        rewarder.address
      );

      await poolTokens.mint({ to: lp, amount: tokenInitialBalance });
      await poolTokens.approve({ to: vault.address, from: [lp] });

      await rewardTokens.mint({ to: rewarder, amount: rewardTokenInitialBalance });
      await rewardTokens.approve({ to: stakingContract.address, from: [rewarder] });

      const assets = poolTokens.addresses;

      await vault.connect(lp).joinPool(poolId, lp.address, lp.address, {
        assets,
        maxAmountsIn: Array(assets.length).fill(MAX_UINT256),
        fromInternalBalance: false,
        userData: WeightedPoolEncoder.joinInit(Array(assets.length).fill(tokenInitialBalance)),
      });

      await stakingContract.connect(lp).subscribe([distributionId, distributionId2]);

      const bptBalance = await pool2.balanceOf(lp.address);
      await pool.connect(lp).approve(stakingContract.address, bptBalance);
      await stakingContract.connect(lp).stake(pool.address, bptBalance);

      const bptBalance2 = await pool2.balanceOf(lp.address);
      await pool2.connect(lp).approve(stakingContract.address, bptBalance2);
      await stakingContract.connect(lp).stake(pool2.address, bptBalance2);
    });

    it('allows you to claim across multiple pools', async () => {
      await stakingContract.connect(rewarder).notifyRewardAmount(pool.address, rewardToken.address, rewardAmount);
      const rewardAmount2 = fp(0.75);
      await stakingContract.connect(rewarder).notifyRewardAmount(pool2.address, rewardToken.address, rewardAmount2);

      await advanceTime(rewardsVestingTime);

      const expectedReward = fp(1.75);

      await expectBalanceChange(
        () => stakingContract.connect(lp).getReward([pool.address, pool2.address]),
        rewardTokens,
        [{ account: lp, changes: { DAI: ['very-near', expectedReward] } }]
      );
    });

    it.skip('emits RewardPaid for each pool', async () => {
      await stakingContract.connect(rewarder).notifyRewardAmount(pool.address, rewardToken.address, rewardAmount);
      const rewardAmount2 = fp(0.75);
      await stakingContract.connect(rewarder).notifyRewardAmount(pool2.address, rewardToken.address, rewardAmount2);
      await advanceTime(rewardsVestingTime);

      const receipt = await (await stakingContract.connect(lp).getReward([pool.address])).wait();

      const user = lp.address;

      // TODO detect duplicate event, or consolidate events
      const expectedReward = bn('999999999999999898');
      expectEvent.inReceipt(receipt, 'RewardPaid', {
        user,
        rewardToken: rewardToken.address,
        amount: expectedReward,
      });

      const expectedReward2 = bn('749999999999999923');
      expectEvent.inReceipt(receipt, 'RewardPaid', {
        user,
        rewardToken: rewardToken.address,
        amount: expectedReward2,
      });
    });
  });
});
