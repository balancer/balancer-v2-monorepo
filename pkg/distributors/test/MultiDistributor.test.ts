import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, ContractTransaction } from 'ethers';
import { WeiPerEther as ONE } from '@ethersproject/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { ANY_ADDRESS, ZERO_ADDRESS, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import { advanceTime, currentTimestamp, DAY } from '@balancer-labs/v2-helpers/src/time';

import { MultiDistributor } from '@balancer-labs/v2-helpers/src/models/distributor/MultiDistributor';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { Account, NAry } from '@balancer-labs/v2-helpers/src/models/types/types';

describe('MultiDistributor', () => {
  let vault: Vault;
  let distributor: MultiDistributor;
  let distribution: string, anotherDistribution: string;
  let stakingToken: Token, stakingTokens: TokenList;
  let distributionToken: Token, anotherDistributionToken: Token, distributionTokens: TokenList;
  let user1: SignerWithAddress, user2: SignerWithAddress, user3: SignerWithAddress;
  let other: SignerWithAddress, distributionOwner: SignerWithAddress;
  let relayer: SignerWithAddress;

  const DISTRIBUTION_SIZE = fp(90e3);
  const PERIOD_DURATION = 30 * DAY;

  before('setup signers', async () => {
    [, user1, user2, user3, other, distributionOwner, relayer] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy distributor', async () => {
    vault = await Vault.create();
    distributor = await MultiDistributor.create(vault);

    // Authorise distributor to use users' vault token approvals
    const manageUserRole = await actionId(vault.instance, 'manageUserBalance');
    await vault.grantPermissionsGlobally([manageUserRole], distributor);

    const stakeRole = await actionId(distributor.instance, 'stake');
    const stakeUsingVaultRole = await actionId(distributor.instance, 'stakeUsingVault');
    const unstakeRole = await actionId(distributor.instance, 'unstake');
    const fundRole = await actionId(distributor.instance, 'fundDistribution');
    const setDurationRole = await actionId(distributor.instance, 'setDistributionDuration');

    await vault.grantPermissionsGlobally([stakeRole], relayer);
    await vault.grantPermissionsGlobally([stakeUsingVaultRole], relayer);
    await vault.grantPermissionsGlobally([unstakeRole], relayer);
    await vault.grantPermissionsGlobally([fundRole], relayer);
    await vault.grantPermissionsGlobally([setDurationRole], relayer);
  });

  sharedBeforeEach('deploy tokens', async () => {
    stakingTokens = await TokenList.create(1);
    stakingToken = stakingTokens.first;

    distributionTokens = await TokenList.create(2);
    distributionToken = distributionTokens.first;
    anotherDistributionToken = distributionTokens.second;

    await distributionTokens.mint({ to: distributionOwner, amount: DISTRIBUTION_SIZE.mul(1000) });
    await distributionTokens.approve({ to: distributor, from: distributionOwner });
  });

  describe('authorizer', () => {
    it('uses the authorizer of the vault', async () => {
      expect(await distributor.getAuthorizer()).to.equal(distributor.authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      const { vault, authorizer, admin } = distributor;
      const action = await actionId(vault, 'setAuthorizer');
      await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);

      await vault.connect(admin).setAuthorizer(user1.address);

      expect(await distributor.getAuthorizer()).to.equal(user1.address);
    });
  });

  describe('create', () => {
    context('when the given distribution was not created yet', () => {
      context('when the given params are correct', () => {
        it('creates the distribution', async () => {
          await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, {
            from: distributionOwner,
          });

          const id = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
          const data = await distributor.getDistribution(id);
          expect(data.stakingToken).to.be.equal(stakingToken.address);
          expect(data.distributionToken).to.be.equal(distributionToken.address);
          expect(data.owner).to.be.equal(distributionOwner.address);
          expect(data.duration).to.be.equal(PERIOD_DURATION);
          expect(data.totalSupply).to.be.zero;
          expect(data.periodFinish).to.be.zero;
          expect(data.paymentRate).to.be.zero;
          expect(data.lastUpdateTime).to.be.zero;
          expect(data.globalTokensPerStake).to.be.zero;
        });

        it('emits a DistributionCreated event', async () => {
          const tx = await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, {
            from: distributionOwner,
          });

          const id = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
          expectEvent.inReceipt(await tx.wait(), 'DistributionCreated', {
            distribution: id,
            stakingToken: stakingToken.address,
            distributionToken: distributionToken.address,
            owner: distributionOwner.address,
          });
        });

        it('emits a DistributionDurationSet event', async () => {
          const tx = await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, {
            from: distributionOwner,
          });

          const id = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
          expectEvent.inReceipt(await tx.wait(), 'DistributionDurationSet', {
            distribution: id,
            duration: PERIOD_DURATION,
          });
        });
      });

      context('when the given params are not correct', () => {
        context('when the given staking token is the zero address', () => {
          const stakingTokenAddress = ZERO_ADDRESS;

          it('reverts', async () => {
            await expect(
              distributor.newDistribution(stakingTokenAddress, distributionToken, PERIOD_DURATION, {
                from: distributionOwner,
              })
            ).to.be.revertedWith('STAKING_TOKEN_ZERO_ADDRESS');
          });
        });

        context('when the given rewards token is the zero address', () => {
          const distributionTokenAddress = ZERO_ADDRESS;

          it('reverts', async () => {
            await expect(
              distributor.newDistribution(stakingToken, distributionTokenAddress, PERIOD_DURATION, {
                from: distributionOwner,
              })
            ).to.be.revertedWith('DISTRIBUTION_TOKEN_ZERO_ADDRESS');
          });
        });

        context('when the given duration is zero', () => {
          const duration = 0;

          it('reverts', async () => {
            await expect(
              distributor.newDistribution(stakingToken, distributionToken, duration, { from: distributionOwner })
            ).to.be.revertedWith('DISTRIBUTION_DURATION_ZERO');
          });
        });
      });
    });

    context('when the given distribution was already created', () => {
      sharedBeforeEach('create distribution', async () => {
        await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, {
          from: distributionOwner,
        });
      });

      it('reverts', async () => {
        await expect(
          distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, { from: distributionOwner })
        ).to.be.revertedWith('DISTRIBUTION_ALREADY_CREATED');
      });
    });
  });

  describe('fundDistribution', () => {
    const itHandlesFunding = (
      fundDistribution: (distribution: string, amount: BigNumberish) => Promise<ContractTransaction>
    ) => {
      context('when the given distribution exists', () => {
        sharedBeforeEach('create distribution', async () => {
          await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, {
            from: distributionOwner,
          });
          distribution = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
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
            await fundDistribution(distribution, DISTRIBUTION_SIZE);

            const { lastUpdateTime: currentLastUpdate } = await distributor.getDistribution(distribution);
            expect(currentLastUpdate).to.equal(await currentTimestamp());
          });

          it('sets the end date of the current period', async () => {
            await fundDistribution(distribution, DISTRIBUTION_SIZE);

            const { periodFinish: currentEndDate } = await distributor.getDistribution(distribution);
            expect(currentEndDate).to.equal((await currentTimestamp()).add(PERIOD_DURATION));
          });

          it('increases the reward rate', async () => {
            await fundDistribution(distribution, DISTRIBUTION_SIZE);

            const { paymentRate: currentPaymentRate } = await distributor.getDistribution(distribution);
            expect(currentPaymentRate).to.be.equal(fp(DISTRIBUTION_SIZE).div(PERIOD_DURATION));
          });

          it('emits a DistributionFunded event', async () => {
            const tx = await fundDistribution(distribution, DISTRIBUTION_SIZE);

            expectEvent.inReceipt(await tx.wait(), 'DistributionFunded', {
              distribution: distribution,
              amount: DISTRIBUTION_SIZE,
            });
          });
        };

        const itExtendsTheCurrentDistributionPeriod = () => {
          it('updates the last update time of the distribution', async () => {
            const { lastUpdateTime: previousLastUpdate } = await distributor.getDistribution(distribution);

            await fundDistribution(distribution, DISTRIBUTION_SIZE);

            const { lastUpdateTime: currentLastUpdate } = await distributor.getDistribution(distribution);
            expect(currentLastUpdate).to.be.gt(previousLastUpdate);
            expect(currentLastUpdate).to.equal(await currentTimestamp());
          });

          it('extends the end date of the current period', async () => {
            const { periodFinish: previousEndDate } = await distributor.getDistribution(distribution);

            await fundDistribution(distribution, DISTRIBUTION_SIZE);

            const { periodFinish: currentEndDate } = await distributor.getDistribution(distribution);
            expect(currentEndDate).to.be.gt(previousEndDate);
            expect(currentEndDate).to.be.at.least((await currentTimestamp()).add(PERIOD_DURATION));
          });

          it('increases the reward rate', async () => {
            const { paymentRate: previousPaymentRate, periodFinish } = await distributor.getDistribution(distribution);

            await fundDistribution(distribution, DISTRIBUTION_SIZE);
            const currentTime = await currentTimestamp();

            const { paymentRate: currentPaymentRate } = await distributor.getDistribution(distribution);
            expect(currentPaymentRate).to.be.gt(previousPaymentRate);

            const leftOverRewards = periodFinish.sub(currentTime).mul(previousPaymentRate).div(ONE);
            const expectedNewPaymentRate = fp(DISTRIBUTION_SIZE.add(leftOverRewards)).div(PERIOD_DURATION);
            expect(currentPaymentRate).to.be.almostEqual(expectedNewPaymentRate);
          });

          it('emits a DistributionFunded event', async () => {
            const tx = await fundDistribution(distribution, DISTRIBUTION_SIZE);

            expectEvent.inReceipt(await tx.wait(), 'DistributionFunded', {
              distribution: distribution,
              amount: DISTRIBUTION_SIZE,
            });
          });

          it('does not affect already earned rewards', async () => {
            const currentTime = await currentTimestamp();
            const { lastUpdateTime, periodFinish } = await distributor.getDistribution(distribution);
            const rewardedTime = currentTime.gt(periodFinish) ? PERIOD_DURATION : currentTime.sub(lastUpdateTime);

            const previousUser1Tokens = await distributor.getClaimableTokens(distribution, user1);
            expect(previousUser1Tokens).to.be.almostEqual(
              toUser1Share(DISTRIBUTION_SIZE).mul(rewardedTime).div(PERIOD_DURATION)
            );

            const previousUser2Tokens = await distributor.getClaimableTokens(distribution, user2);
            expect(previousUser2Tokens).to.be.almostEqual(
              toUser2Share(DISTRIBUTION_SIZE).mul(rewardedTime).div(PERIOD_DURATION)
            );

            // Add new funds, double the size of the original, and fully process them
            await fundDistribution(distribution, DISTRIBUTION_SIZE.mul(2));

            await advanceTime(PERIOD_DURATION);

            // Each user should now get their share out of the two batches of tokens (three times the original amount)
            const currentUser1Tokens = await distributor.getClaimableTokens(distribution, user1);
            expect(currentUser1Tokens).to.be.almostEqual(toUser1Share(DISTRIBUTION_SIZE.mul(3)));

            const currentUser2Tokens = await distributor.getClaimableTokens(distribution, user2);
            expect(currentUser2Tokens).to.be.almostEqual(toUser2Share(DISTRIBUTION_SIZE.mul(3)));
          });
        };

        context('when the given distribution was not rewarded yet', () => {
          itCreatesANewRewardDistributionPeriod();

          it('starts giving rewards to already subscribed users', async () => {
            const previousUser1Tokens = await distributor.getClaimableTokens(distribution, user1);
            expect(previousUser1Tokens).to.be.zero;

            const previousUser2Tokens = await distributor.getClaimableTokens(distribution, user2);
            expect(previousUser2Tokens).to.be.zero;

            await fundDistribution(distribution, DISTRIBUTION_SIZE);
            await advanceTime(PERIOD_DURATION);

            const currentUser1Tokens = await distributor.getClaimableTokens(distribution, user1);
            expect(currentUser1Tokens).to.be.almostEqual(toUser1Share(DISTRIBUTION_SIZE));

            const currentUser2Tokens = await distributor.getClaimableTokens(distribution, user2);
            expect(currentUser2Tokens).to.be.almostEqual(toUser2Share(DISTRIBUTION_SIZE));
          });
        });

        context('when the given distribution was already rewarded', () => {
          sharedBeforeEach('reward distribution', async () => {
            await fundDistribution(distribution, DISTRIBUTION_SIZE);
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
              const previousUser1Tokens = await distributor.getClaimableTokens(distribution, user1);
              expect(previousUser1Tokens).to.be.almostEqual(toUser1Share(DISTRIBUTION_SIZE));

              const previousUser2Tokens = await distributor.getClaimableTokens(distribution, user2);
              expect(previousUser2Tokens).to.be.almostEqual(toUser2Share(DISTRIBUTION_SIZE));

              // Add new funding, double the size of the original, and fully process them
              await fundDistribution(distribution, DISTRIBUTION_SIZE.mul(2));
              await advanceTime(PERIOD_DURATION);

              // Each user should now get their share out of the two batches of tokens (three times the original amount)
              const currentUser1Tokens = await distributor.getClaimableTokens(distribution, user1);
              expect(currentUser1Tokens).to.be.almostEqual(toUser1Share(DISTRIBUTION_SIZE.mul(3)));

              const currentUser2Tokens = await distributor.getClaimableTokens(distribution, user2);
              expect(currentUser2Tokens).to.be.almostEqual(toUser2Share(DISTRIBUTION_SIZE.mul(3)));
            });
          });

          context('after the reward period has ended', () => {
            sharedBeforeEach('move after the reward period', async () => {
              await advanceTime(PERIOD_DURATION + 1);
            });

            itCreatesANewRewardDistributionPeriod();

            it('accrues already given rewards', async () => {
              const previousUser1Tokens = await distributor.getClaimableTokens(distribution, user1);
              expect(previousUser1Tokens).to.be.almostEqual(toUser1Share(DISTRIBUTION_SIZE));

              const previousUser2Tokens = await distributor.getClaimableTokens(distribution, user2);
              expect(previousUser2Tokens).to.be.almostEqual(toUser2Share(DISTRIBUTION_SIZE));

              // Add new rewards, double the size of the original ones, and fully process them
              await fundDistribution(distribution, DISTRIBUTION_SIZE.mul(2));
              await advanceTime(PERIOD_DURATION);

              // Each user should now get their share out of the two batches of rewards (three times the original amount)
              const currentUser1Tokens = await distributor.getClaimableTokens(distribution, user1);
              expect(currentUser1Tokens).to.be.almostEqual(toUser1Share(DISTRIBUTION_SIZE.mul(3)));

              const currentUser2Tokens = await distributor.getClaimableTokens(distribution, user2);
              expect(currentUser2Tokens).to.be.almostEqual(toUser2Share(DISTRIBUTION_SIZE.mul(3)));
            });
          });
        });
      });

      context('when the given distribution does not exist', () => {
        it('reverts', async () => {
          await expect(
            distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner })
          ).to.be.revertedWith('DISTRIBUTION_DOES_NOT_EXIST');
        });
      });
    };

    context('when called by the distribution owner', () => {
      itHandlesFunding((distribution: string, amount: BigNumberish) =>
        distributor.fundDistribution(distribution, amount, { from: distributionOwner })
      );
    });

    context('when called by a relayer', () => {
      context('when relayer is authorised by distibution owner', () => {
        sharedBeforeEach('authorise relayer', async () => {
          await vault.setRelayerApproval(distributionOwner, relayer, true);
        });

        sharedBeforeEach('mint tokens to relayer', async () => {
          await distributionTokens.mint({ to: relayer, amount: fp(1e6) });
          await distributionTokens.approve({ to: distributor, from: relayer });
        });

        itHandlesFunding((distribution: string, amount: BigNumberish) =>
          distributor.fundDistribution(distribution, amount, { from: relayer })
        );
      });

      context('when relayer is not authorised by sender', () => {
        sharedBeforeEach('create distribution', async () => {
          await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, {
            from: distributionOwner,
          });
          distribution = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
        });

        it('reverts', async () => {
          await expect(distributor.fundDistribution(distribution, 0, { from: relayer })).to.be.revertedWith(
            'USER_DOESNT_ALLOW_RELAYER'
          );
        });
      });
    });
  });

  describe('setDuration', () => {
    const itHandlesDurationChange = (
      changeDuration: (distribution: string, duration: BigNumberish) => Promise<ContractTransaction>
    ) => {
      context('when the given distribution exists', () => {
        sharedBeforeEach('create distribution', async () => {
          await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, {
            from: distributionOwner,
          });
          distribution = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
        });

        context('when the new duration is not zero', () => {
          const newDuration = 1;

          const itCannotSetThePeriodDuration = () => {
            it('reverts', async () => {
              await expect(changeDuration(distribution, newDuration)).to.be.revertedWith('DISTRIBUTION_STILL_ACTIVE');
            });
          };

          const itSetsTheDistributionPeriodDuration = () => {
            it('sets the distribution period duration', async () => {
              await changeDuration(distribution, newDuration);

              const { duration } = await distributor.getDistribution(distribution);
              expect(duration).to.be.equal(newDuration);
            });

            it('emits a DistributionDurationSet event', async () => {
              const tx = await changeDuration(distribution, newDuration);

              expectEvent.inReceipt(await tx.wait(), 'DistributionDurationSet', {
                distribution: distribution,
                duration: newDuration,
              });
            });
          };

          context('when there is an on going distribution period', () => {
            sharedBeforeEach('reward distribution', async () => {
              await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
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
            await expect(changeDuration(distribution, newDuration)).to.be.revertedWith('DISTRIBUTION_DURATION_ZERO');
          });
        });
      });

      context('when the given distribution does not exist', () => {
        it('reverts', async () => {
          await expect(changeDuration(distribution, 1)).to.be.revertedWith('DISTRIBUTION_DOES_NOT_EXIST');
        });
      });
    };

    context('when called by the distribution owner', () => {
      itHandlesDurationChange((distribution: string, newDuration: BigNumberish) =>
        distributor.setDuration(distribution, newDuration, { from: distributionOwner })
      );
    });

    context('when called by a relayer', () => {
      context('when relayer is authorised by distibution owner', () => {
        sharedBeforeEach('authorise relayer', async () => {
          await vault.setRelayerApproval(distributionOwner, relayer, true);
        });

        itHandlesDurationChange((distribution: string, newDuration: BigNumberish) =>
          distributor.setDuration(distribution, newDuration, { from: relayer })
        );
      });

      context('when relayer is not authorised by sender', () => {
        sharedBeforeEach('create distribution', async () => {
          await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, {
            from: distributionOwner,
          });
          distribution = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
        });

        it('reverts', async () => {
          await expect(distributor.setDuration(distribution, 1, { from: relayer })).to.be.revertedWith(
            'USER_DOESNT_ALLOW_RELAYER'
          );
        });
      });
    });
  });

  describe('stake', () => {
    let from: SignerWithAddress, to: SignerWithAddress;

    sharedBeforeEach('create distributions', async () => {
      await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, { from: distributionOwner });
      distribution = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });

      await distributor.newDistribution(stakingToken, anotherDistributionToken, PERIOD_DURATION, {
        from: distributionOwner,
      });
      anotherDistribution = await distributor.getDistributionId(
        stakingToken,
        anotherDistributionToken,
        distributionOwner
      );
      await distributor.fundDistribution(anotherDistribution, DISTRIBUTION_SIZE, { from: distributionOwner });
    });

    const itHandlesStaking = (stake: (token: Token, amount: BigNumberish) => Promise<ContractTransaction>) => {
      context('when the user did specify some amount', () => {
        const amount = fp(1);

        context('when the user has the requested balance', () => {
          sharedBeforeEach('mint stake amount', async () => {
            await stakingToken.mint(from, amount);

            // Give direct approval for `stake`
            await stakingToken.approve(distributor, amount, { from });

            // Give relayer approval for `stakeUsingVault`
            await stakingToken.approve(vault, amount, { from });
            await vault.setRelayerApproval(from, distributor, true);
          });

          const itTransfersTheStakingTokensToTheDistributor = () => {
            it('transfers the staking tokens to the distributor', async () => {
              await expectBalanceChange(() => stake(stakingToken, amount), stakingTokens, [
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
              expect(previousData.globalTokensPerStake).to.be.zero;

              await stake(stakingToken, amount);

              const currentData = await distributor.getDistribution(distribution);
              expect(currentData.globalTokensPerStake).to.be.zero;
            });

            it('does not update the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, to);
              expect(previousData.unclaimedTokens).to.be.equal(0);
              expect(previousData.userTokensPerStake).to.be.equal(0);

              await stake(stakingToken, amount);

              const currentData = await distributor.getUserDistribution(distribution, to);
              expect(currentData.unclaimedTokens).to.be.equal(0);
              expect(currentData.userTokensPerStake).to.be.equal(0);
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
              expect(previousData.globalTokensPerStake).to.be.zero;

              const previousRewardPerToken = await distributor.globalTokensPerStake(anotherDistribution);
              expect(previousRewardPerToken).to.be.zero;

              await stake(stakingToken, amount);

              const currentData = await distributor.getDistribution(anotherDistribution);
              expect(currentData.lastUpdateTime).to.be.equal(previousData.lastUpdateTime);
              expect(currentData.globalTokensPerStake).to.be.zero;

              const currentRewardPerToken = await distributor.globalTokensPerStake(anotherDistribution);
              expect(currentRewardPerToken).to.be.zero;
            });

            it('does not affect the user rates of other distributions', async () => {
              const previousData = await distributor.getUserDistribution(anotherDistribution, user1);
              expect(previousData.unclaimedTokens).to.be.zero;
              expect(previousData.userTokensPerStake).to.be.zero;

              await stake(stakingToken, amount);

              const currentData = await distributor.getUserDistribution(anotherDistribution, user1);
              expect(currentData.unclaimedTokens).to.be.zero;
              expect(currentData.userTokensPerStake).to.be.zero;
            });
          };

          context('when there was no previous staked amount', () => {
            context('when the user was not subscribed to a distribution', () => {
              itTransfersTheStakingTokensToTheDistributor();
              itDoesNotAffectAnyDistribution();

              it('does not track it for future rewards', async () => {
                await stake(stakingToken, amount);

                const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(previousRewardPerToken).to.be.zero;

                await advanceTime(PERIOD_DURATION);

                const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
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
                expect(previousData.globalTokensPerStake).to.be.zero;

                await stake(stakingToken, amount);

                const currentData = await distributor.getDistribution(distribution);
                expect(currentData.globalTokensPerStake).to.be.zero;
              });

              it('does not update the user rates of the subscribed distribution', async () => {
                await stake(stakingToken, amount);

                const distributionData = await distributor.getUserDistribution(distribution, user1);
                expect(distributionData.unclaimedTokens).to.be.zero;
                expect(distributionData.userTokensPerStake).to.be.zero;
              });

              it('starts tracking it for future rewards', async () => {
                await stake(stakingToken, amount);

                const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(previousRewardPerToken).to.be.zero;

                await advanceTime(PERIOD_DURATION);

                const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(currentRewardPerToken).to.be.almostEqual(DISTRIBUTION_SIZE);
              });
            });
          });

          context('when there was some previous staked amount from another user', () => {
            sharedBeforeEach('subscribe and stake some amount from another user', async () => {
              await distributor.subscribeAndStake(distribution, stakingToken, fp(2), { from: user2 });
              // Half of the reward tokens will go to user 2: 45k, meaning 22.5k per token
              await advanceTime(PERIOD_DURATION / 2);
            });

            context('when the user was not subscribed to a distribution', () => {
              itTransfersTheStakingTokensToTheDistributor();
              itDoesNotAffectAnyDistribution();

              it('does not track it for future rewards', async () => {
                await stake(stakingToken, amount);

                // The token rate and tokens earned by user 2 are unchanged.

                const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(previousRewardPerToken).to.be.almostEqualFp(22500);
                expect(await distributor.getClaimableTokens(distribution, user2)).to.almostEqual(
                  DISTRIBUTION_SIZE.div(2)
                );

                await advanceTime(PERIOD_DURATION);

                const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(currentRewardPerToken).to.be.almostEqualFp(45000);
                expect(await distributor.getClaimableTokens(distribution, user2)).to.almostEqual(DISTRIBUTION_SIZE);
              });
            });

            context('when the user was subscribed to a distribution', () => {
              sharedBeforeEach('subscribe to distribution', async () => {
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
                expect(previousData.globalTokensPerStake).to.be.zero;

                await stake(stakingToken, amount);

                const currentData = await distributor.getDistribution(distribution);
                expect(currentData.globalTokensPerStake).to.be.almostEqualFp(22500);
              });

              it('does not update the user rates of the subscribed distribution', async () => {
                await stake(stakingToken, amount);

                const distributionData = await distributor.getUserDistribution(distribution, user1);
                expect(distributionData.unclaimedTokens).to.be.zero;
                expect(distributionData.userTokensPerStake).to.be.almostEqualFp(22500);
              });

              it('starts tracking it for future rewards', async () => {
                await stake(stakingToken, amount);

                const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(previousRewardPerToken).to.be.almostEqualFp(22500);

                expect(await distributor.getClaimableTokens(distribution, user1)).to.almostEqual(0);
                expect(await distributor.getClaimableTokens(distribution, user2)).to.almostEqual(
                  DISTRIBUTION_SIZE.div(2)
                );

                await advanceTime(PERIOD_DURATION);

                // The second half is split between both users, meaning 15k per token
                const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(currentRewardPerToken).to.be.almostEqualFp(37500);

                // The second half of the tokens is distributed between users 1 and 2, with one third of what remains going to user 1, and two thirds
                // going to user 2.
                expect(await distributor.getClaimableTokens(distribution, user1)).to.almostEqual(
                  DISTRIBUTION_SIZE.div(2).div(3)
                );
                expect(await distributor.getClaimableTokens(distribution, user2)).to.almostEqual(
                  DISTRIBUTION_SIZE.div(2).add(DISTRIBUTION_SIZE.div(2).mul(2).div(3))
                );
              });
            });
          });
        });

        context('when the user does not have the requested balance', () => {
          const amount = fp(1001);

          sharedBeforeEach('approve distributor as relayer', async () => {
            await vault.setRelayerApproval(from, distributor, true);
          });

          it('reverts', async () => {
            await expect(stake(stakingToken, amount)).to.be.revertedWith('ERC20_TRANSFER_EXCEEDS_BALANCE');
          });
        });
      });

      context('when the user did not specify any amount', () => {
        const amount = 0;

        it('reverts', async () => {
          await expect(stake(stakingToken, amount)).to.be.revertedWith('STAKE_AMOUNT_ZERO');
        });
      });
    };

    describe('stake', () => {
      context('when called by the sender', () => {
        context('when sender and recipient are the same', () => {
          sharedBeforeEach('define sender and recipient', async () => {
            from = user1;
            to = user1;
          });

          itHandlesStaking((token: Token, amount: BigNumberish) =>
            distributor.stake(token, amount, from, to, { from })
          );
        });

        context('when sender and recipient are different', () => {
          sharedBeforeEach('define sender and recipient', async () => {
            from = other;
            to = user1;
          });

          itHandlesStaking((token: Token, amount: BigNumberish) =>
            distributor.stake(token, amount, from, to, { from })
          );
        });
      });

      context('when called by a relayer', () => {
        context('when relayer is authorised by sender', () => {
          sharedBeforeEach('authoriser relayer', async () => {
            await vault.setRelayerApproval(user1, relayer, true);
          });

          sharedBeforeEach('define sender and recipient', async () => {
            from = user1;
            to = user1;
          });

          itHandlesStaking((token: Token, amount: BigNumberish) =>
            distributor.stake(token, amount, from, to, { from: relayer })
          );
        });

        context('when relayer is not authorised by sender', () => {
          it('reverts', async () => {
            await expect(distributor.stake(stakingToken, 0, user1, user1, { from: relayer })).to.be.revertedWith(
              'USER_DOESNT_ALLOW_RELAYER'
            );
          });
        });
      });
    });

    describe('stakeUsingVault', () => {
      context('when called by the sender', () => {
        context('when sender and recipient are the same', () => {
          sharedBeforeEach('define sender and recipient', async () => {
            from = user1;
            to = user1;
          });

          itHandlesStaking((token: Token, amount: BigNumberish) =>
            distributor.stakeUsingVault(token, amount, from, to, { from })
          );
        });

        context('when sender and recipient are different', () => {
          sharedBeforeEach('define sender and recipient', async () => {
            from = other;
            to = user1;
          });

          itHandlesStaking((token: Token, amount: BigNumberish) =>
            distributor.stakeUsingVault(token, amount, from, to, { from })
          );
        });
      });

      context('when called by a relayer', () => {
        context('when relayer is authorised by sender', () => {
          sharedBeforeEach('authoriser relayer', async () => {
            await vault.setRelayerApproval(user1, relayer, true);
          });

          sharedBeforeEach('define sender and recipient', async () => {
            from = user1;
            to = user1;
          });

          itHandlesStaking((token: Token, amount: BigNumberish) =>
            distributor.stakeUsingVault(token, amount, from, to, { from: relayer })
          );
        });

        context('when relayer is not authorised by sender', () => {
          it('reverts', async () => {
            await expect(
              distributor.stakeUsingVault(stakingToken, 0, user1, user1, { from: relayer })
            ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
          });
        });
      });
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

  describe('unstake', () => {
    let from: SignerWithAddress, to: SignerWithAddress;

    sharedBeforeEach('create distributions', async () => {
      await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, { from: distributionOwner });
      distribution = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });

      await distributor.newDistribution(stakingToken, anotherDistributionToken, PERIOD_DURATION, {
        from: distributionOwner,
      });
      anotherDistribution = await distributor.getDistributionId(
        stakingToken,
        anotherDistributionToken,
        distributionOwner
      );
      await distributor.fundDistribution(anotherDistribution, DISTRIBUTION_SIZE, { from: distributionOwner });
    });

    describe('unstake', () => {
      context('when called by the sender', () => {
        context('when sender and recipient are the same', () => {
          sharedBeforeEach('define sender and recipient', async () => {
            from = user1;
            to = user1;
          });

          itHandlesUnstaking((token: Token, amount: BigNumberish) =>
            distributor.unstake(token, amount, from, to, { from })
          );
        });

        context('when sender and recipient are different', () => {
          sharedBeforeEach('define sender and recipient', async () => {
            from = other;
            to = user1;
          });

          itHandlesUnstaking((token: Token, amount: BigNumberish) =>
            distributor.unstake(token, amount, from, to, { from })
          );
        });
      });

      context('when called by a relayer', () => {
        context('when relayer is authorised by sender', () => {
          sharedBeforeEach('authoriser relayer', async () => {
            await vault.setRelayerApproval(user1, relayer, true);
          });

          sharedBeforeEach('define sender and recipient', async () => {
            from = user1;
            to = user1;
          });

          itHandlesUnstaking((token: Token, amount: BigNumberish) =>
            distributor.unstake(token, amount, from, to, { from: relayer })
          );
        });

        context('when relayer is not authorised by sender', () => {
          it('reverts', async () => {
            await expect(distributor.unstake(stakingToken, 0, user1, user1, { from: relayer })).to.be.revertedWith(
              'USER_DOESNT_ALLOW_RELAYER'
            );
          });
        });
      });
    });

    function itHandlesUnstaking(unstake: (token: Token, amount: BigNumberish) => Promise<ContractTransaction>) {
      context('when the user did specify some amount', () => {
        const amount = fp(1);

        context('when the user has previously staked the requested balance', () => {
          sharedBeforeEach('stake amount', async () => {
            await stakingTokens.mint({ to: from, amount });
            await stakingTokens.approve({ to: distributor, amount, from });

            await distributor.stake(stakingToken, amount, from, from, { from });
          });

          const itTransfersTheStakingTokensToTheUser = () => {
            it('transfers the staking tokens to the user', async () => {
              await expectBalanceChange(() => unstake(stakingToken, amount), stakingTokens, [
                { account: to, changes: { [stakingToken.symbol]: amount } },
                { account: distributor.address, changes: { [stakingToken.symbol]: amount.mul(-1) } },
              ]);
            });

            it('decreases the staking balance of the user', async () => {
              const previousStakedBalance = await distributor.balanceOf(stakingToken, from);

              await unstake(stakingToken, amount);

              const currentStakedBalance = await distributor.balanceOf(stakingToken, from);
              expect(currentStakedBalance).be.equal(previousStakedBalance.sub(amount));
            });
          };

          const itDoesNotAffectAnyDistribution = () => {
            it('does not emit a Unstaked event', async () => {
              const tx = await unstake(stakingToken, amount);
              expectEvent.notEmitted(await tx.wait(), 'Unstaked');
            });

            it('does not decrease the supply of the distribution', async () => {
              const previousSupply = await distributor.totalSupply(distribution);

              await unstake(stakingToken, amount);

              const currentSupply = await distributor.totalSupply(distribution);
              expect(currentSupply).be.equal(previousSupply);
            });

            it('does not update the last update time of the distribution', async () => {
              const previousData = await distributor.getDistribution(distribution);
              expect(previousData.lastUpdateTime).not.to.be.equal(0);

              await unstake(stakingToken, amount);

              const currentData = await distributor.getDistribution(distribution);
              expect(currentData.lastUpdateTime).to.be.equal(previousData.lastUpdateTime);
            });

            it('does not update the reward rate stored of the distribution', async () => {
              const previousData = await distributor.getDistribution(distribution);
              expect(previousData.globalTokensPerStake).to.be.zero;

              await unstake(stakingToken, amount);

              const currentData = await distributor.getDistribution(distribution);
              expect(currentData.globalTokensPerStake).to.be.zero;
            });

            it('does not update the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, from);
              expect(previousData.unclaimedTokens).to.be.equal(0);
              expect(previousData.userTokensPerStake).to.be.equal(0);

              await unstake(stakingToken, amount);

              const currentData = await distributor.getUserDistribution(distribution, from);
              expect(currentData.unclaimedTokens).to.be.equal(0);
              expect(currentData.userTokensPerStake).to.be.equal(0);
            });

            itDoesNotAffectOtherDistributions();
          };

          const itDoesNotAffectOtherDistributions = () => {
            it('does not affect the supply of other distributions', async () => {
              const previousSupply = await distributor.totalSupply(anotherDistribution);
              expect(previousSupply).be.zero;

              await unstake(stakingToken, amount);

              const currentSupply = await distributor.totalSupply(anotherDistribution);
              expect(currentSupply).be.zero;
            });

            it('does not affect the rates of other distributions', async () => {
              const previousData = await distributor.getDistribution(anotherDistribution);
              expect(previousData.lastUpdateTime).not.to.be.equal(0);
              expect(previousData.globalTokensPerStake).to.be.zero;

              const previousRewardPerToken = await distributor.globalTokensPerStake(anotherDistribution);
              expect(previousRewardPerToken).to.be.zero;

              await unstake(stakingToken, amount);

              const currentData = await distributor.getDistribution(anotherDistribution);
              expect(currentData.lastUpdateTime).to.be.equal(previousData.lastUpdateTime);
              expect(currentData.globalTokensPerStake).to.be.zero;

              const currentRewardPerToken = await distributor.globalTokensPerStake(anotherDistribution);
              expect(currentRewardPerToken).to.be.zero;
            });

            it('does not affect the user rates of other distributions', async () => {
              const previousData = await distributor.getUserDistribution(anotherDistribution, from);
              expect(previousData.unclaimedTokens).to.be.zero;
              expect(previousData.userTokensPerStake).to.be.zero;

              await unstake(stakingToken, amount);

              const currentData = await distributor.getUserDistribution(anotherDistribution, from);
              expect(currentData.unclaimedTokens).to.be.zero;
              expect(currentData.userTokensPerStake).to.be.zero;
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
                await unstake(stakingToken, amount);

                const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(previousRewardPerToken).to.be.zero;
                expect(await distributor.getClaimableTokens(distribution, from)).to.equal(0);

                await advanceTime(PERIOD_DURATION);

                const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(currentRewardPerToken).to.be.zero;
                expect(await distributor.getClaimableTokens(distribution, from)).to.equal(0);
              });
            });

            context('when the user was subscribed to the distribution', () => {
              sharedBeforeEach('subscribe to the distribution', async () => {
                await distributor.subscribe(distribution, { from });

                // Half of the duration passes, earning the user half of the total reward
                await advanceTime(PERIOD_DURATION / 2);
              });

              itTransfersTheStakingTokensToTheUser();
              itDoesNotAffectOtherDistributions();

              it('emits a Unstaked event', async () => {
                const tx = await unstake(stakingToken, amount);

                expectEvent.inReceipt(await tx.wait(), 'Unstaked', {
                  distribution,
                  user: from.address,
                  amount,
                });
              });

              it('decreases the supply of the staking contract for the subscribed distribution', async () => {
                const previousSupply = await distributor.totalSupply(distribution);

                await unstake(stakingToken, amount);

                const currentSupply = await distributor.totalSupply(distribution);
                expect(currentSupply).be.equal(previousSupply.sub(amount));
              });

              it('updates the last update time of the subscribed distribution', async () => {
                const previousData = await distributor.getDistribution(distribution);

                await unstake(stakingToken, amount);

                const currentData = await distributor.getDistribution(distribution);
                expect(currentData.lastUpdateTime).to.be.gt(previousData.lastUpdateTime);
              });

              it('updates the reward rate stored of the subscribed distribution', async () => {
                const previousData = await distributor.getDistribution(distribution);
                expect(previousData.globalTokensPerStake).to.be.zero;

                await unstake(stakingToken, amount);

                const currentData = await distributor.getDistribution(distribution);
                expect(currentData.globalTokensPerStake).to.be.almostEqualFp(45000);
              });

              it('updates the user rates of the subscribed distribution', async () => {
                await unstake(stakingToken, amount);

                const distributionData = await distributor.getUserDistribution(distribution, from);
                expect(distributionData.userTokensPerStake).to.be.almostEqualFp(45000);
              });

              it('stops tracking it for future rewards', async () => {
                await unstake(stakingToken, amount);
                await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });

                const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(previousRewardPerToken).to.be.almostEqualFp(45000);
                const previousEarned = await distributor.getClaimableTokens(distribution, from);

                await advanceTime(PERIOD_DURATION);

                const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(currentRewardPerToken).to.be.almostEqualFp(45000);
                const currentEarned = await distributor.getClaimableTokens(distribution, from);
                expect(currentEarned).to.equal(previousEarned);
              });

              it('does not claim his rewards', async () => {
                await unstake(stakingToken, amount);

                const currentRewards = await distributor.getClaimableTokens(distribution, from);
                expect(currentRewards).to.be.almostEqual(DISTRIBUTION_SIZE.div(2));
              });
            });
          });

          context('when there was some other staked amount from another user', () => {
            sharedBeforeEach('subscribe and stake some amount from another user', async () => {
              await distributor.subscribeAndStake(distribution, stakingToken, fp(2), { from: user2 });
              // Half of the reward tokens will go to user 2: 45k, meaning 22.5k per token
              await advanceTime(PERIOD_DURATION / 2);
            });

            context('when the user was not subscribed to a distribution', () => {
              itTransfersTheStakingTokensToTheUser();
              itDoesNotAffectAnyDistribution();

              it('does not track it for future rewards', async () => {
                await unstake(stakingToken, amount);

                const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(previousRewardPerToken).to.be.almostEqualFp(22500);

                await advanceTime(PERIOD_DURATION);

                const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(currentRewardPerToken).to.be.almostEqualFp(45000);
              });
            });

            context('when the user was subscribed to a distribution', () => {
              sharedBeforeEach('subscribe distribution', async () => {
                await distributor.subscribe(distribution, { from });
                await advanceTime(PERIOD_DURATION / 2);
              });

              itTransfersTheStakingTokensToTheUser();

              it('emits a Unstaked event', async () => {
                const tx = await unstake(stakingToken, amount);

                expectEvent.inReceipt(await tx.wait(), 'Unstaked', {
                  distribution,
                  user: from.address,
                  amount,
                });
              });

              it('decreases the supply of the staking contract for the subscribed distribution', async () => {
                const previousSupply = await distributor.totalSupply(distribution);

                await unstake(stakingToken, amount);

                const currentSupply = await distributor.totalSupply(distribution);
                expect(currentSupply).be.equal(previousSupply.sub(amount));
              });

              it('updates the last update time of the subscribed distribution', async () => {
                const previousData = await distributor.getDistribution(distribution);

                await unstake(stakingToken, amount);

                const currentData = await distributor.getDistribution(distribution);
                expect(currentData.lastUpdateTime).to.be.gt(previousData.lastUpdateTime);
              });

              it('updates the reward rate stored of the subscribed distribution', async () => {
                const previousData = await distributor.getDistribution(distribution);
                expect(previousData.globalTokensPerStake).to.be.almostEqualFp(22500);

                await unstake(stakingToken, amount);

                const currentData = await distributor.getDistribution(distribution);
                expect(currentData.globalTokensPerStake).to.be.almostEqualFp(37500);
              });

              it('updates the user rates of the subscribed distribution', async () => {
                await unstake(stakingToken, amount);

                // The second half is split between both users, meaning 15k per token
                const distributionData = await distributor.getUserDistribution(distribution, from);
                expect(distributionData.unclaimedTokens).to.be.almostEqualFp(15000);
                expect(distributionData.userTokensPerStake).to.be.almostEqualFp(37500);
              });

              it('stops tracking it for future rewards', async () => {
                await unstake(stakingToken, amount);
                await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });

                const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(previousRewardPerToken).to.be.almostEqualFp(37500);
                const previousEarned = await distributor.getClaimableTokens(distribution, from);

                await advanceTime(PERIOD_DURATION);

                // All new rewards go to user 2, meaning 45k per token
                const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(currentRewardPerToken).to.be.almostEqualFp(82500);

                const currentEarned = await distributor.getClaimableTokens(distribution, from);
                expect(currentEarned).to.equal(previousEarned);
              });

              it('does not claim his rewards', async () => {
                await unstake(stakingToken, amount);

                // The user only got one third of the rewards for the duration they staked, which was
                // half the period.
                const currentRewards = await distributor.getClaimableTokens(distribution, from);
                expect(currentRewards).to.be.almostEqual(DISTRIBUTION_SIZE.div(2).div(3));
              });
            });
          });
        });

        context('when the user does not have the requested stake', () => {
          const amount = fp(1001);

          it('reverts', async () => {
            await expect(unstake(stakingToken, amount)).to.be.revertedWith('UNSTAKE_AMOUNT_UNAVAILABLE');
          });
        });
      });

      context('when the user did not specify any amount', () => {
        const amount = 0;

        it('reverts', async () => {
          await expect(unstake(stakingToken, amount)).to.be.revertedWith('UNSTAKE_AMOUNT_ZERO');
        });
      });
    }
  });

  describe('subscribe', () => {
    context('when the distribution exists', () => {
      sharedBeforeEach('create distributions', async () => {
        await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, {
          from: distributionOwner,
        });
        distribution = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
        await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });

        await distributor.newDistribution(stakingToken, anotherDistributionToken, PERIOD_DURATION, {
          from: distributionOwner,
        });

        anotherDistribution = await distributor.getDistributionId(
          stakingToken,
          anotherDistributionToken,
          distributionOwner
        );
        await distributor.fundDistribution(anotherDistribution, DISTRIBUTION_SIZE, { from: distributionOwner });
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
              const { globalTokensPerStake: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const { globalTokensPerStake: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.zero;
            });

            it('does not update the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(previousRewardPerToken).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(currentRewardPerToken).to.be.zero;
            });

            it('does not affect the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unclaimedTokens).to.be.zero;
              expect(previousData.userTokensPerStake).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unclaimedTokens).to.be.zero;
              expect(currentData.userTokensPerStake).to.be.zero;
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
              await distributor.stake(stakingToken, balance, user1, user1, { from: user1 });
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
              const { globalTokensPerStake: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const { globalTokensPerStake: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.zero;
            });

            it('does not update the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(previousRewardPerToken).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(currentRewardPerToken).to.be.zero;
            });

            it('does not affect the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unclaimedTokens).to.be.zero;
              expect(previousData.userTokensPerStake).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unclaimedTokens).to.be.zero;
              expect(currentData.userTokensPerStake).to.be.zero;
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
              const { globalTokensPerStake: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const { globalTokensPerStake: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.zero;
            });

            it('does not update the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(previousRewardPerToken).to.be.almostEqualFp(45e3);

              await distributor.subscribe(distribution, { from: user1 });

              const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(currentRewardPerToken).to.be.almostEqualFp(45e3);
            });

            it('does not affect the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unclaimedTokens).to.be.zero;
              expect(previousData.userTokensPerStake).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unclaimedTokens).to.be.zero;
              expect(currentData.userTokensPerStake).to.be.zero;
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
              await distributor.stake(stakingToken, balance, user1, user1, { from: user1 });
              await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
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
              const { globalTokensPerStake: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.almostEqualFp(45e3);

              await advanceTime(PERIOD_DURATION);
              await distributor.subscribe(distribution, { from: user1 });

              const { globalTokensPerStake: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.almostEqualFp(90e3);
            });

            it('affects the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(previousRewardPerToken).to.be.almostEqualFp(45e3);

              await distributor.subscribe(distribution, { from: user1 });
              await advanceTime(PERIOD_DURATION);

              const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(currentRewardPerToken).to.be.almostEqualFp(75e3);
            });

            it('does not affect the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unclaimedTokens).to.be.zero;
              expect(previousData.userTokensPerStake).to.be.zero;

              await distributor.subscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unclaimedTokens).to.be.zero;
              expect(currentData.userTokensPerStake).to.be.almostEqualFp(45e3);
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
        await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, {
          from: distributionOwner,
        });
        distribution = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
        await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });

        await distributor.newDistribution(stakingToken, anotherDistributionToken, PERIOD_DURATION, {
          from: distributionOwner,
        });
        anotherDistribution = await distributor.getDistributionId(
          stakingToken,
          anotherDistributionToken,
          distributionOwner
        );
        await distributor.fundDistribution(anotherDistribution, DISTRIBUTION_SIZE, { from: distributionOwner });
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
              const { globalTokensPerStake: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const { globalTokensPerStake: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.zero;
            });

            it('does not update the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(previousRewardPerToken).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(currentRewardPerToken).to.be.zero;
            });

            it('does not affect the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unclaimedTokens).to.be.zero;
              expect(previousData.userTokensPerStake).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unclaimedTokens).to.be.zero;
              expect(currentData.userTokensPerStake).to.be.zero;
            });

            it('calculates total earned correctly', async () => {
              await advanceTime(PERIOD_DURATION);
              await distributor.unsubscribe(distribution, { from: user1 });

              expect(await distributor.getClaimableTokens(distribution, user1)).to.be.zero;
            });

            it('does not emit a Unstaked event', async () => {
              const tx = await distributor.unsubscribe(distribution, { from: user1 });
              expectEvent.notEmitted(await tx.wait(), 'Unstaked');
            });
          });

          context('when the user has staked', () => {
            const balance = fp(1);

            sharedBeforeEach('stake tokens', async () => {
              await stakingToken.mint(user1, balance);
              await stakingToken.approve(distributor, balance, { from: user1 });
              await distributor.stake(stakingToken, balance, user1, user1, { from: user1 });
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
              const { globalTokensPerStake: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const { globalTokensPerStake: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.almostEqualFp(45e3);
            });

            it('does not update the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(previousRewardPerToken).to.be.almostEqualFp(45e3);

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(currentRewardPerToken).to.be.almostEqualFp(45e3);
            });

            it('updates the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unclaimedTokens).to.be.zero;
              expect(previousData.userTokensPerStake).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unclaimedTokens).to.be.almostEqualFp(45e3);
              expect(currentData.userTokensPerStake).to.be.almostEqualFp(45e3);
            });

            it('calculates total earned correctly', async () => {
              await distributor.unsubscribe(distribution, { from: user1 });

              expect(await distributor.getClaimableTokens(distribution, user1)).almostEqualFp(45e3);
            });

            it('emits a Unstaked event', async () => {
              const tx = await distributor.unsubscribe(distribution, { from: user1 });

              expectEvent.inReceipt(await tx.wait(), 'Unstaked', {
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
              const { globalTokensPerStake: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const { globalTokensPerStake: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.zero;
            });

            it('does not update the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(previousRewardPerToken).to.be.almostEqualFp(45e3);

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(currentRewardPerToken).to.be.almostEqualFp(45e3);
            });

            it('does not affect the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unclaimedTokens).to.be.zero;
              expect(previousData.userTokensPerStake).to.be.zero;

              await distributor.unsubscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unclaimedTokens).to.be.zero;
              expect(currentData.userTokensPerStake).to.be.zero;
            });

            it('calculates total earned correctly', async () => {
              await advanceTime(PERIOD_DURATION);
              await distributor.unsubscribe(distribution, { from: user1 });

              expect(await distributor.getClaimableTokens(distribution, user1)).to.be.zero;
            });

            it('does not emit a Unstaked event', async () => {
              const tx = await distributor.unsubscribe(distribution, { from: user1 });
              expectEvent.notEmitted(await tx.wait(), 'Unstaked');
            });
          });

          context('when the user has staked', () => {
            const balance = fp(1);

            sharedBeforeEach('stake tokens', async () => {
              await stakingToken.mint(user1, balance);
              await stakingToken.approve(distributor, balance, { from: user1 });
              await distributor.stake(stakingToken, balance, user1, user1, { from: user1 });
              await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
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
              const { globalTokensPerStake: previousRate } = await distributor.getDistribution(distribution);
              expect(previousRate).to.be.almostEqualFp(45e3);

              await advanceTime(PERIOD_DURATION);
              await distributor.unsubscribe(distribution, { from: user1 });

              const { globalTokensPerStake: currentRate } = await distributor.getDistribution(distribution);
              expect(currentRate).to.be.almostEqualFp(75e3);
            });

            it('affects the reward per token rate of the distribution', async () => {
              const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(previousRewardPerToken).to.be.almostEqualFp(45e3);

              await distributor.unsubscribe(distribution, { from: user1 });
              await advanceTime(PERIOD_DURATION);

              const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
              expect(currentRewardPerToken).to.be.almostEqualFp(90e3);
            });

            it('affects the user rates of the distribution', async () => {
              const previousData = await distributor.getUserDistribution(distribution, user1);
              expect(previousData.unclaimedTokens).to.be.zero;
              expect(previousData.userTokensPerStake).to.be.almostEqualFp(45e3);

              await advanceTime(PERIOD_DURATION);
              await distributor.unsubscribe(distribution, { from: user1 });

              const currentData = await distributor.getUserDistribution(distribution, user1);
              expect(currentData.unclaimedTokens).to.be.almostEqualFp(30e3);
              expect(currentData.userTokensPerStake).to.be.almostEqualFp(75e3);
            });

            it('calculates total earned correctly', async () => {
              await advanceTime(PERIOD_DURATION);
              await distributor.unsubscribe(distribution, { from: user1 });

              expect(await distributor.getClaimableTokens(distribution, user1)).to.be.almostEqualFp(30e3);
            });

            it('emits a Unstaked event', async () => {
              const tx = await distributor.unsubscribe(distribution, { from: user1 });

              expectEvent.inReceipt(await tx.wait(), 'Unstaked', {
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
    let from: SignerWithAddress, to: SignerWithAddress;

    sharedBeforeEach('create distribution', async () => {
      await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, { from: distributionOwner });
      distribution = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
    });

    const itReceivesTheRewards = (claim: (distribution: string) => Promise<ContractTransaction>) => {
      it('transfers the reward tokens to the user', async () => {
        const rewards = await distributor.getClaimableTokens(distribution, from);

        await claim(distribution);

        expect(await distributor.getClaimableTokens(distribution, from)).to.be.zero;
        expect(await distributionToken.balanceOf(user1.address)).to.be.almostEqual(rewards);
      });

      it('transfer the tokens from the vault', async () => {
        const previousVaultBalance = await distributionToken.balanceOf(distributor.vault.address);

        const rewards = await distributor.getClaimableTokens(distribution, from);
        await claim(distribution);

        const currentVaultBalance = await distributionToken.balanceOf(distributor.vault.address);
        expect(currentVaultBalance).to.be.equal(previousVaultBalance.sub(rewards));
      });

      it('does not update the reward per token', async () => {
        const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);

        await claim(distribution);

        const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
        expect(currentRewardPerToken).to.be.almostEqual(previousRewardPerToken);
      });

      it('updates the reward per token rates of the user', async () => {
        const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);

        await claim(distribution);

        const { unclaimedTokens, userTokensPerStake } = await distributor.getUserDistribution(distribution, from);
        expect(unclaimedTokens).to.be.almostEqual(0);
        expect(userTokensPerStake).to.be.almostEqual(previousRewardPerToken);
      });

      it('emits a DistributionClaimed event', async () => {
        const expectedAmount = await distributor.getClaimableTokens(distribution, from);

        const tx = await claim(distribution);

        expectEvent.inReceipt(await tx.wait(), 'DistributionClaimed', {
          distribution,
          user: from.address,
          amount: expectedAmount,
        });
      });
    };

    const itIgnoresTheRequest = (
      claim: (distribution: string) => Promise<ContractTransaction>,
      updatesUserPaidRate = false
    ) => {
      it('does not transfer any reward tokens to the user', async () => {
        await claim(distribution);

        expect(await distributor.getClaimableTokens(distribution, from)).to.be.almostEqualFp(0);
        expect(await distributionToken.balanceOf(from)).to.be.almostEqualFp(0);
      });

      it('does not update the reward per token', async () => {
        const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);

        await claim(distribution);

        const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
        expect(currentRewardPerToken).to.be.almostEqual(previousRewardPerToken);
      });

      it(`${updatesUserPaidRate ? 'updates' : 'does not update'} the reward per token rates of the user`, async () => {
        const rewardPerToken = await distributor.globalTokensPerStake(distribution);

        await claim(distribution);

        const { unclaimedTokens, userTokensPerStake } = await distributor.getUserDistribution(distribution, from);
        expect(unclaimedTokens).to.be.zero;
        expect(userTokensPerStake).to.be.equal(updatesUserPaidRate ? rewardPerToken : 0);
      });

      it('does not emit a DistributionClaimed event', async () => {
        const tx = await claim(distribution);

        expectEvent.notEmitted(await tx.wait(), 'DistributionClaimed');
      });
    };

    const itHandlesClaiming = (claim: (distributions: NAry<string>) => Promise<ContractTransaction>) => {
      context('when there was no other stake from other users', () => {
        context('when the user had some stake', () => {
          sharedBeforeEach('stake some amount', async () => {
            await stakingToken.mint(from, fp(1));
            await stakingToken.approve(distributor, fp(1), { from });
            await distributor.stake(stakingToken, fp(1), from, from, { from });
          });

          context('when the user was subscribed to a distribution', () => {
            sharedBeforeEach('subscribe distribution', async () => {
              await distributor.subscribe(distribution, { from });
              await advanceTime(PERIOD_DURATION);
            });

            itReceivesTheRewards(claim);

            context('when the user is subscribed to another distribution for the same token', () => {
              sharedBeforeEach('create another distribution', async () => {
                await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, {
                  from: other,
                });
                anotherDistribution = await distributor.getDistributionId(stakingToken, distributionToken, other);

                await distributionToken.mint(other, DISTRIBUTION_SIZE);
                await distributionToken.approve(distributor, DISTRIBUTION_SIZE, { from: other });
                await distributor.fundDistribution(anotherDistribution, DISTRIBUTION_SIZE, { from: other });

                await distributor.subscribe(anotherDistribution, { from });
                await advanceTime(PERIOD_DURATION);

                // Ensure that both distributions have some rewards to be claimed
                expect(await distributor.getClaimableTokens(distribution, from)).to.be.gt(0);
                expect(await distributor.getClaimableTokens(anotherDistribution, from)).to.be.gt(0);
              });

              const getAllDueRewards = async (user: Account) => {
                const claimableTokens = await distributor.getClaimableTokens(distribution, user);
                const anotherClaimableTokens = await distributor.getClaimableTokens(anotherDistribution, user);
                return claimableTokens.add(anotherClaimableTokens);
              };

              // Check that token transfer consolidation works as expected

              it('performs a single transfer of the distribution token', async () => {
                const rewards = await getAllDueRewards(from);
                const tx = await claim([distribution, anotherDistribution]);

                await expectEvent.inIndirectReceipt(await tx.wait(), distributionToken.instance.interface, 'Transfer', {
                  from: distributor.vault.address,
                  to: to.address,
                  value: rewards,
                });
              });

              it('emits a DistributionClaimed event for each distribution', async () => {
                const expectedClaimAmount = await distributor.getClaimableTokens(distribution, from);
                const expectedAnotherClaimAmount = await distributor.getClaimableTokens(anotherDistribution, from);

                const tx = await claim([distribution, anotherDistribution]);

                expectEvent.inReceipt(await tx.wait(), 'DistributionClaimed', {
                  distribution,
                  user: from.address,
                  amount: expectedClaimAmount,
                });
                expectEvent.inReceipt(await tx.wait(), 'DistributionClaimed', {
                  distribution: anotherDistribution,
                  user: from.address,
                  amount: expectedAnotherClaimAmount,
                });
              });

              // Ensure that distribution accounting is still properly handled

              it('does not update the reward per token', async () => {
                const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
                const anotherPreviousRewardPerToken = await distributor.globalTokensPerStake(anotherDistribution);

                await claim([distribution, anotherDistribution]);

                const currentRewardPerToken = await distributor.globalTokensPerStake(distribution);
                expect(currentRewardPerToken).to.be.almostEqual(previousRewardPerToken);
                const anotherCurrentRewardPerToken = await distributor.globalTokensPerStake(anotherDistribution);
                expect(anotherCurrentRewardPerToken).to.be.almostEqual(anotherPreviousRewardPerToken);
              });

              it('updates the reward per token rates of the user', async () => {
                const previousRewardPerToken = await distributor.globalTokensPerStake(distribution);
                const anotherPreviousRewardPerToken = await distributor.globalTokensPerStake(anotherDistribution);

                await claim([distribution, anotherDistribution]);

                const distributionInfo = await distributor.getUserDistribution(distribution, from);
                expect(distributionInfo.unclaimedTokens).to.be.eq(0);
                expect(distributionInfo.userTokensPerStake).to.be.almostEqual(previousRewardPerToken);
                const anotherDistributionInfo = await distributor.getUserDistribution(anotherDistribution, from);
                expect(anotherDistributionInfo.unclaimedTokens).to.be.eq(0);
                expect(anotherDistributionInfo.userTokensPerStake).to.be.almostEqual(anotherPreviousRewardPerToken);
              });
            });
          });

          context('when the user was not subscribed to a distribution', () => {
            sharedBeforeEach('advance some time', async () => {
              await advanceTime(PERIOD_DURATION);
            });

            itIgnoresTheRequest(claim);
          });
        });

        context('when the user did not stake', () => {
          context('when the user was subscribed to a distribution', () => {
            sharedBeforeEach('subscribe distribution', async () => {
              await distributor.subscribe(distribution, { from });
              await advanceTime(PERIOD_DURATION);
            });

            itIgnoresTheRequest(claim);
          });

          context('when the user was not subscribed to a distribution', () => {
            sharedBeforeEach('advance some time', async () => {
              await advanceTime(PERIOD_DURATION);
            });

            itIgnoresTheRequest(claim);
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
            await stakingToken.mint(from, fp(1));
            await stakingToken.approve(distributor, fp(1), { from });
            await distributor.stake(stakingToken, fp(1), from, from, { from });
            await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
          });

          context('when the user was subscribed to a distribution', () => {
            sharedBeforeEach('subscribe distribution', async () => {
              await distributor.subscribe(distribution, { from });
              await advanceTime(PERIOD_DURATION);
            });

            itReceivesTheRewards(claim);
          });

          context('when the user was not subscribed to a distribution', () => {
            sharedBeforeEach('advance some time', async () => {
              await advanceTime(PERIOD_DURATION);
            });

            itIgnoresTheRequest(claim);
          });
        });

        context('when the user did not have stake', () => {
          context('when the user was subscribed to a distribution', () => {
            sharedBeforeEach('subscribe distribution', async () => {
              await distributor.subscribe(distribution, { from });
              await advanceTime(PERIOD_DURATION);
            });

            itIgnoresTheRequest(claim, true);
          });

          context('when the user was not subscribed to a distribution', () => {
            sharedBeforeEach('advance some time', async () => {
              await advanceTime(PERIOD_DURATION);
            });

            itIgnoresTheRequest(claim);
          });
        });
      });
    };

    describe('claim', () => {
      context("when caller is not authorised to act on sender's behalf", () => {
        it('reverts', async () => {
          await expect(distributor.claim(distribution, false, user2, user2, { from: user1 })).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });
      });

      context("when caller is authorised to act on sender's behalf", () => {
        context('when sender and recipient are the same', () => {
          sharedBeforeEach('define sender and recipient', async () => {
            from = user1;
            to = user1;
          });

          itHandlesClaiming((distribution: NAry<string>) => distributor.claim(distribution, false, from, to, { from }));
        });

        context('when sender and recipient are different', () => {
          sharedBeforeEach('define sender and recipient', async () => {
            from = other;
            to = user1;
          });

          itHandlesClaiming((distribution: NAry<string>) => distributor.claim(distribution, false, from, to, { from }));
        });
      });
    });
  });

  describe('exit', () => {
    const balance = fp(1);

    sharedBeforeEach('create distributions', async () => {
      await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, { from: distributionOwner });
      distribution = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
    });

    const itUnstakesAndClaims = () => {
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
        const expectedClaimAmount = await distributor.getClaimableTokens(distribution, user1);

        await distributor.exit(stakingToken, distribution, { from: user1 });

        expect(await distributor.getClaimableTokens(distribution, user1)).to.be.zero;
        expect(await distributionToken.balanceOf(user1)).to.be.almostEqual(expectedClaimAmount);
      });

      it('emits a Unstaked event', async () => {
        const tx = await distributor.exit(stakingToken, distribution, { from: user1 });

        expectEvent.inReceipt(await tx.wait(), 'Unstaked', {
          distribution,
          user: user1.address,
          amount: balance,
        });
      });

      it('emits a DistributionClaimed event', async () => {
        const expectedClaimAmount = await distributor.getClaimableTokens(distribution, user1);

        const tx = await distributor.exit(stakingToken, distribution, { from: user1 });

        expectEvent.inReceipt(await tx.wait(), 'DistributionClaimed', {
          distribution,
          user: user1.address,
          amount: expectedClaimAmount,
        });
      });
    };

    const itUnstakes = () => {
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
        const previousBalance = await distributionToken.balanceOf(user1);

        await distributor.exit(stakingToken, distribution, { from: user1 });

        const currentBalance = await distributionToken.balanceOf(user1);
        expect(currentBalance).to.be.equal(previousBalance);
      });

      it('does not emit a Unstaked event', async () => {
        const tx = await distributor.exit(stakingToken, distribution, { from: user1 });
        expectEvent.notEmitted(await tx.wait(), 'Unstaked');
      });

      it('does not emit a DistributionClaimed event', async () => {
        const tx = await distributor.exit(stakingToken, distribution, { from: user1 });
        expectEvent.notEmitted(await tx.wait(), 'DistributionClaimed');
      });
    };

    context('when there was no other stake from other users', () => {
      context('when the user had some stake', () => {
        sharedBeforeEach('stake some amount', async () => {
          await stakingToken.mint(user1, balance);
          await stakingToken.approve(distributor, balance, { from: user1 });
          await distributor.stake(stakingToken, balance, user1, user1, { from: user1 });
        });

        context('when the user was subscribed to a distribution', () => {
          sharedBeforeEach('subscribe distribution', async () => {
            await distributor.subscribe(distribution, { from: user1 });
            await advanceTime(PERIOD_DURATION);
          });

          itUnstakesAndClaims();

          it('updates the reward rate stored of the distribution', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            // Only user with the entire period staked
            const currentData = await distributor.getDistribution(distribution);
            expect(currentData.globalTokensPerStake).to.be.almostEqualFp(90e3);
          });

          it('updates the reward per token rates of the user', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            const { unclaimedTokens, userTokensPerStake } = await distributor.getUserDistribution(distribution, user1);
            expect(unclaimedTokens).to.be.zero;

            // Only user with the entire period staked
            expect(userTokensPerStake).to.be.almostEqualFp(90e3);
          });

          it('stops tracking it for future rewards', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(90e3);

            await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
            await advanceTime(PERIOD_DURATION);

            expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(90e3);
          });
        });

        context('when the user was not subscribed to a distribution', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(PERIOD_DURATION);
          });

          itUnstakes();

          it('does not update the reward rate stored of the distribution', async () => {
            const previousData = await distributor.getDistribution(distribution);

            await distributor.exit(stakingToken, distribution, { from: user1 });

            const currentData = await distributor.getDistribution(distribution);
            expect(currentData.globalTokensPerStake).to.be.equal(previousData.globalTokensPerStake);
          });

          it('does not update the reward per token rates of the user', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            const { unclaimedTokens, userTokensPerStake } = await distributor.getUserDistribution(distribution, user1);
            expect(unclaimedTokens).to.be.zero;
            expect(userTokensPerStake).to.be.zero;
          });

          it('does not track it for future rewards', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            expect(await distributor.globalTokensPerStake(distribution)).to.be.zero;

            await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
            await advanceTime(PERIOD_DURATION);

            expect(await distributor.globalTokensPerStake(distribution)).to.be.zero;
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
              'UNSTAKE_AMOUNT_ZERO'
            );
          });
        });

        context('when the user was not subscribed to a distribution', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(PERIOD_DURATION);
          });

          it('reverts', async () => {
            await expect(distributor.exit(stakingToken, distribution, { from: user1 })).to.be.revertedWith(
              'UNSTAKE_AMOUNT_ZERO'
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
          await distributor.stake(stakingToken, balance, user1, user1, { from: user1 });
          await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
        });

        context('when the user was subscribed to a distribution', () => {
          sharedBeforeEach('subscribe distribution', async () => {
            await distributor.subscribe(distribution, { from: user1 });
            await advanceTime(PERIOD_DURATION);
          });

          itUnstakesAndClaims();

          it('updates the reward rate stored of the distribution', async () => {
            // User #2 has staked 2 tokens for 1 period
            const previousData = await distributor.getDistribution(distribution);
            expect(previousData.globalTokensPerStake).to.be.almostEqualFp(45e3);

            await distributor.exit(stakingToken, distribution, { from: user1 });

            // User #1 joins with 1 token for 1 period
            const currentData = await distributor.getDistribution(distribution);
            expect(currentData.globalTokensPerStake).to.be.almostEqualFp(75e3);
          });

          it('updates the reward per token rates of the user', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            const { unclaimedTokens, userTokensPerStake } = await distributor.getUserDistribution(distribution, user1);
            expect(unclaimedTokens).to.be.zero;

            // User #2 has staked 2 tokens for 2 periods, while user #1 staked 1 token for 1 period
            expect(userTokensPerStake).to.be.almostEqualFp(75e3);
          });

          it('stops tracking it for future rewards', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            // User #2 has staked 2 tokens for 2 periods, while user #1 staked 1 token for 1 period
            expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(75e3);

            await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
            await advanceTime(PERIOD_DURATION);

            // User #2 continues with 2 tokens for one more period
            expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(120e3);
          });
        });

        context('when the user was not subscribed to a distribution', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(PERIOD_DURATION);
          });

          itUnstakes();

          it('does not update the reward rate stored of the distribution', async () => {
            const previousData = await distributor.getDistribution(distribution);

            await distributor.exit(stakingToken, distribution, { from: user1 });

            const currentData = await distributor.getDistribution(distribution);
            expect(currentData.globalTokensPerStake).to.be.equal(previousData.globalTokensPerStake);
          });

          it('does not update the reward per token rates of the user', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            const { unclaimedTokens, userTokensPerStake } = await distributor.getUserDistribution(distribution, user1);
            expect(unclaimedTokens).to.be.zero;
            expect(userTokensPerStake).to.be.zero;
          });

          it('does not track it for future rewards', async () => {
            await distributor.exit(stakingToken, distribution, { from: user1 });

            // The other user has staked for 2 periods with 2 tokens
            expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(90e3);

            await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
            await advanceTime(PERIOD_DURATION);

            // The other user continues with his stake of 2 tokens
            expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(135e3);
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
              'UNSTAKE_AMOUNT_ZERO'
            );
          });
        });

        context('when the user was not subscribed to a distribution', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(PERIOD_DURATION);
          });

          it('reverts', async () => {
            await expect(distributor.exit(stakingToken, distribution, { from: user1 })).to.be.revertedWith(
              'UNSTAKE_AMOUNT_ZERO'
            );
          });
        });
      });
    });
  });

  describe('integration', () => {
    sharedBeforeEach('create distribution', async () => {
      await distributor.newDistribution(stakingToken, distributionToken, PERIOD_DURATION, { from: distributionOwner });
      distribution = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);
      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
    });

    const assertUserRewards = async (
      user: SignerWithAddress,
      rewards: { rate: BigNumberish; paid: BigNumberish; earned: BigNumberish }
    ) => {
      const earned = await distributor.getClaimableTokens(distribution, user);
      const rewardPerToken = await distributor.globalTokensPerStake(distribution);
      const { userTokensPerStake } = await distributor.getUserDistribution(distribution, user);

      expect(earned).to.be.almostEqualFp(rewards.earned);
      expect(userTokensPerStake).to.be.almostEqualFp(rewards.paid);
      expect(rewardPerToken.sub(userTokensPerStake)).to.be.almostEqualFp(rewards.rate);
    };

    it('starts with no reward per token', async () => {
      expect(await distributor.globalTokensPerStake(distribution)).to.be.zero;
      expect(await distributor.balanceOf(stakingToken, user1)).to.be.zero;

      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });
    });

    it('one user stakes solo', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION);
      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
      await advanceTime(PERIOD_DURATION);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(180000);
      await assertUserRewards(user1, { rate: 180000, paid: 0, earned: 180000 });

      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
      await advanceTime(PERIOD_DURATION);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(270000);
      await assertUserRewards(user1, { rate: 270000, paid: 0, earned: 270000 });
    });

    it('one user stakes late', async () => {
      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqual(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      // First third of the period with no staked balance
      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqual(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      // Second third of the period with 1 staked token: 30k rewards for the user
      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(30000);
      await assertUserRewards(user1, { rate: 30000, paid: 0, earned: 30000 });

      // Last third of the period with 1 staked token: 60k rewards for the user
      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(60000);
      await assertUserRewards(user1, { rate: 60000, paid: 0, earned: 60000 });

      // Another third of a period without new rewards: 60k rewards for the user
      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(60000);
      await assertUserRewards(user1, { rate: 60000, paid: 0, earned: 60000 });

      // Add new rewards to the distribution
      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(60000);

      // Advance half of the reward period: 60k + 45k = 105k rewards (the 15k of the previous period are lost)
      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(105000);
      await assertUserRewards(user1, { rate: 105000, paid: 0, earned: 105000 });
    });

    it('one user unstakes early', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqual(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 45000, paid: 0, earned: 45000 });

      await distributor.unstake(stakingToken, fp(1), user1, user1, { from: user1 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 0, paid: 45000, earned: 45000 });

      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 0, paid: 45000, earned: 45000 });
    });

    it('one user unsubscribes early', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqual(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 45000, paid: 0, earned: 45000 });

      await distributor.unsubscribe(distribution, { from: user1 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 0, paid: 45000, earned: 45000 });

      await stakingToken.mint(user1, fp(1));
      await stakingToken.approve(distributor, fp(1), { from: user1 });
      await distributor.stake(stakingToken, fp(1), user1, user1, { from: user1 });
      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 0, paid: 45000, earned: 45000 });
    });

    it('two users with the same stakes wait 1 period', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user2 });

      // It is not exactly zero because some time passed since the first user has staked
      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(0.13888);
      await assertUserRewards(user1, { rate: 0.13888, paid: 0, earned: 0.13888 });
      await assertUserRewards(user2, { rate: 0, paid: 0.13888, earned: 0 });

      await advanceTime(PERIOD_DURATION);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 45000, paid: 0, earned: 45000 });
      await assertUserRewards(user2, { rate: 45000, paid: 0.13888, earned: 45000 });
    });

    it('two users with different stakes (1:3) wait 1 period', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });
      await distributor.subscribeAndStake(distribution, stakingToken, fp(3), { from: user2 });

      // It is not exactly zero because some time passed since the first user has staked
      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(0.13888);
      await assertUserRewards(user1, { rate: 0.13888, paid: 0, earned: 0.13888 });
      await assertUserRewards(user2, { rate: 0, paid: 0.13888, earned: 0 });

      await advanceTime(PERIOD_DURATION);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(22500);
      await assertUserRewards(user1, { rate: 22500, paid: 0, earned: 22500 });
      await assertUserRewards(user2, { rate: 22500, paid: 0.13888, earned: 67500 });
    });

    it('two users with different stakes (1:3) wait 1.5 periods starting late', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });
      await assertUserRewards(user2, { rate: 0, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 45000, paid: 0, earned: 45000 });
      await assertUserRewards(user2, { rate: 45000, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(2), { from: user2 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 45000, paid: 0, earned: 45000 });
      await assertUserRewards(user2, { rate: 0, paid: 45000, earned: 0 });

      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(60000);
      await assertUserRewards(user1, { rate: 60000, paid: 0, earned: 60000 });
      await assertUserRewards(user2, { rate: 15000, paid: 45000, earned: 30000 });

      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
      await advanceTime(PERIOD_DURATION / 2);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(75000);
      await assertUserRewards(user1, { rate: 75000, paid: 0, earned: 75000 });
      await assertUserRewards(user2, { rate: 30000, paid: 45000, earned: 60000 });
    });

    it('two users with different stakes (1:3) wait 2 periods', async () => {
      //
      // 1x: +----------------+ = 90k for 30d + 22.5k for 60d
      // 3x:         +--------+ =  0k for 30d + 67.5k for 60d
      //

      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });
      await assertUserRewards(user2, { rate: 0, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION);
      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(90000);
      await assertUserRewards(user1, { rate: 90000, paid: 0, earned: 90000 });
      await assertUserRewards(user2, { rate: 90000, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(3), { from: user2 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(90000);
      await assertUserRewards(user1, { rate: 90000, paid: 0, earned: 90000 });
      await assertUserRewards(user2, { rate: 0, paid: 90000, earned: 0 });

      await advanceTime(PERIOD_DURATION);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(112500);
      await assertUserRewards(user1, { rate: 112500, paid: 0, earned: 112500 });
      await assertUserRewards(user2, { rate: 22500, paid: 90000, earned: 67500 });
    });

    it('two users with the different stakes (1:3) wait 3 periods with a reward rate change', async () => {
      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(0);
      await assertUserRewards(user1, { rate: 0, paid: 0, earned: 0 });
      await assertUserRewards(user2, { rate: 0, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });
      await distributor.subscribeAndStake(distribution, stakingToken, fp(3), { from: user2 });

      // It is not exactly zero because some time passed since the first user has staked
      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(0.13888);
      await assertUserRewards(user1, { rate: 0.13888, paid: 0, earned: 0.13888 });
      await assertUserRewards(user2, { rate: 0, paid: 0.13888, earned: 0 });

      await advanceTime(PERIOD_DURATION);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(22500);
      await assertUserRewards(user1, { rate: 22500, paid: 0, earned: 22500 });
      await assertUserRewards(user2, { rate: 22500, paid: 0.13888, earned: 67500 });

      // Reward but with 30k instead of 90k
      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE.div(3), { from: distributionOwner });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(22500);
      await assertUserRewards(user1, { rate: 22500, paid: 0, earned: 22500 });
      await assertUserRewards(user2, { rate: 22500, paid: 0.13888, earned: 67500 });

      await distributor.exit(stakingToken, distribution, { from: user2 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(22500);
      await assertUserRewards(user1, { rate: 22500, paid: 0, earned: 22500 });
      await assertUserRewards(user2, { rate: 0, paid: 22500, earned: 0 });

      await advanceTime(PERIOD_DURATION);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(52500);
      await assertUserRewards(user1, { rate: 52500, paid: 0, earned: 52500 });
      await assertUserRewards(user2, { rate: 30000, paid: 22500, earned: 0 });

      await stakingToken.approve(distributor, fp(2), { from: user2 });
      await distributor.stake(stakingToken, fp(2), user2, user2, { from: user2 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(52500);
      await assertUserRewards(user1, { rate: 52500, paid: 0, earned: 52500 });
      await assertUserRewards(user2, { rate: 0, paid: 52500, earned: 0 });

      // Reward but with 30k instead of 90k
      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE.div(3), { from: distributionOwner });
      await advanceTime(PERIOD_DURATION);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(62500);
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
      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(0.13888);
      await assertUserRewards(user1, { rate: 0.13888, paid: 0, earned: 0.13888 });
      await assertUserRewards(user2, { rate: 0, paid: 0.13888, earned: 0 });
      await assertUserRewards(user3, { rate: 0.13888, paid: 0, earned: 0 });
      await advanceTime(PERIOD_DURATION);
      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(22500);
      await assertUserRewards(user1, { rate: 22500, paid: 0, earned: 22500 });
      await assertUserRewards(user2, { rate: 22500, paid: 0.13888, earned: 67500 });
      await assertUserRewards(user3, { rate: 22500, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(5), { from: user3 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(22500);
      await assertUserRewards(user1, { rate: 22500, paid: 0, earned: 22500 });
      await assertUserRewards(user2, { rate: 22500, paid: 0.13888, earned: 67500 });
      await assertUserRewards(user3, { rate: 0, paid: 22500, earned: 0 });

      await advanceTime(PERIOD_DURATION);
      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(32500);
      await assertUserRewards(user1, { rate: 32500, paid: 0, earned: 32500 });
      await assertUserRewards(user2, { rate: 32500, paid: 0.13888, earned: 97500 });
      await assertUserRewards(user3, { rate: 10000, paid: 22500, earned: 50000 });

      await distributor.unsubscribe(distribution, { from: user2 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(32500);
      await assertUserRewards(user1, { rate: 32500, paid: 0, earned: 32500 });
      await assertUserRewards(user2, { rate: 0, paid: 32500, earned: 97500 });
      await assertUserRewards(user3, { rate: 10000, paid: 22500, earned: 50000 });

      await distributor.exit(stakingToken, distribution, { from: user2 });
      await advanceTime(PERIOD_DURATION);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(47500);
      await assertUserRewards(user1, { rate: 47500, paid: 0, earned: 47500 });
      await assertUserRewards(user2, { rate: 15000, paid: 32500, earned: 0 });
      await assertUserRewards(user3, { rate: 25000, paid: 22500, earned: 125000 });
    });

    it('three users with different stakes (1:3:5) wait 3 periods unstake early', async () => {
      await distributor.subscribeAndStake(distribution, stakingToken, fp(1), { from: user1 });
      await distributor.subscribeAndStake(distribution, stakingToken, fp(2), { from: user2 });

      // It is not exactly zero because some time passed since the first user has staked
      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(0.13888);
      await assertUserRewards(user1, { rate: 0.13888, paid: 0, earned: 0.13888 });
      await assertUserRewards(user2, { rate: 0, paid: 0.13888, earned: 0 });
      await assertUserRewards(user3, { rate: 0.13888, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(10000);
      await assertUserRewards(user1, { rate: 10000, paid: 0, earned: 10000 });
      await assertUserRewards(user2, { rate: 10000, paid: 0.13888, earned: 20000 });
      await assertUserRewards(user3, { rate: 10000, paid: 0, earned: 0 });

      await distributor.unstake(stakingToken, fp(2), user2, user2, { from: user2 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(10000);
      await assertUserRewards(user1, { rate: 10000, paid: 0, earned: 10000 });
      await assertUserRewards(user2, { rate: 0, paid: 10000, earned: 20000 });
      await assertUserRewards(user3, { rate: 10000, paid: 0, earned: 0 });

      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(40000);
      await assertUserRewards(user1, { rate: 40000, paid: 0, earned: 40000 });
      await assertUserRewards(user2, { rate: 30000, paid: 10000, earned: 20000 });
      await assertUserRewards(user3, { rate: 40000, paid: 0, earned: 0 });

      await distributor.subscribeAndStake(distribution, stakingToken, fp(5), { from: user3 });

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(40000);
      await assertUserRewards(user1, { rate: 40000, paid: 0, earned: 40000 });
      await assertUserRewards(user2, { rate: 30000, paid: 10000, earned: 20000 });
      await assertUserRewards(user3, { rate: 0, paid: 40000, earned: 0 });

      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(45000);
      await assertUserRewards(user1, { rate: 45000, paid: 0, earned: 45000 });
      await assertUserRewards(user2, { rate: 35000, paid: 10000, earned: 20000 });
      await assertUserRewards(user3, { rate: 5000, paid: 40000, earned: 25000 });

      await distributor.fundDistribution(distribution, DISTRIBUTION_SIZE, { from: distributionOwner });
      await advanceTime(PERIOD_DURATION / 3);

      expect(await distributor.globalTokensPerStake(distribution)).to.be.almostEqualFp(50000);
      await assertUserRewards(user1, { rate: 50000, paid: 0, earned: 50000 });
      await assertUserRewards(user2, { rate: 40000, paid: 10000, earned: 20000 });
      await assertUserRewards(user3, { rate: 10000, paid: 40000, earned: 50000 });
    });
  });
});
