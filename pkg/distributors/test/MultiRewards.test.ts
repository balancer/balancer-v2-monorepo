import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { signPermit, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';

import { setup, tokenInitialBalance, rewardTokenInitialBalance, rewardsDuration } from './MultiRewardsSharedSetup';

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

  describe('isAllowlistedRewarder', async () => {
    it('allows thet asset managers to allowlist themselves', async () => {
      await stakingContract.connect(rewarder).allowlistRewarder(pool.address, rewardToken.address, rewarder.address);
      expect(await stakingContract.isAllowlistedRewarder(pool.address, rewardToken.address, rewarder.address)).to.equal(
        true
      );
    });

    it('allows the owner to allowlist someone', async () => {
      await stakingContract.connect(admin).allowlistRewarder(pool.address, rewardToken.address, lp.address);

      expect(await stakingContract.isAllowlistedRewarder(pool.address, rewardToken.address, lp.address)).to.equal(true);
    });

    it('returns false for random users', async () => {
      expect(await stakingContract.isAllowlistedRewarder(pool.address, rewardToken.address, other.address)).to.equal(
        false
      );
    });

    it('reverts if a random user attempts to allowlist themselves', async () => {
      await expect(
        stakingContract.connect(other).allowlistRewarder(pool.address, rewardToken.address, other.address)
      ).to.be.revertedWith("Only accessible by governance, pool or it's asset managers");
    });
  });

  it('reverts if a rewarder attempts to notifyRewardAmount before adding a reward', async () => {
    await stakingContract.connect(rewarder).allowlistRewarder(pool.address, rewardToken.address, rewarder.address);

    await expect(
      stakingContract.connect(rewarder).notifyRewardAmount(pool.address, rewardToken.address, fp(100))
    ).to.be.revertedWith('Reward must be configured with addReward');
  });

  describe('addReward', () => {
    it('sets up a reward for an asset manager', async () => {
      await stakingContract.connect(rewarder).allowlistRewarder(pool.address, rewardToken.address, rewarder.address);
      await stakingContract.connect(rewarder).addReward(pool.address, rewardToken.address, rewardsDuration);
      expect(await stakingContract.isAllowlistedRewarder(pool.address, rewardToken.address, rewarder.address)).to.equal(
        true
      );
    });

    describe('when a maximum number of rewards is added', () => {
      sharedBeforeEach(async () => {
        const tokenSymbols = [...Array(64).keys()].map((k) => k.toString());
        const tokens = await TokenList.create(tokenSymbols, { sorted: true });

        for (let i = 0; i < 64; i++) {
          const rewardTokenAddress = tokens.get(i).address;
          await stakingContract.connect(rewarder).allowlistRewarder(pool.address, rewardTokenAddress, rewarder.address);
          await stakingContract.connect(rewarder).addReward(pool.address, rewardTokenAddress, rewardsDuration);
        }
      });

      it('reverts when maximum number of rewards are added', async () => {
        const tokens = await TokenList.create(['TEST'], { sorted: true });
        const rewardTokenAddress = tokens.get(0).address;
        await stakingContract.connect(rewarder).allowlistRewarder(pool.address, rewardTokenAddress, rewarder.address);
        await expect(
          stakingContract.connect(rewarder).addReward(pool.address, rewardTokenAddress, rewardsDuration)
        ).to.be.revertedWith('Exceeds maximum number of reward tokens per pool');
      });
    });
  });

  describe('stakeWithPermit', () => {
    sharedBeforeEach(async () => {
      await stakingContract.connect(rewarder).allowlistRewarder(pool.address, rewardToken.address, rewarder.address);
      await stakingContract.connect(rewarder).addReward(pool.address, rewardToken.address, rewardsDuration);
    });

    it('stakes with a permit signature', async () => {
      const bptBalance = await pool.balanceOf(lp.address);

      const { v, r, s } = await signPermit(pool, lp, stakingContract, bptBalance);
      await stakingContract.connect(lp).stakeWithPermit(pool.address, bptBalance, MAX_UINT256, lp.address, v, r, s);

      const stakedBalance = await stakingContract.balanceOf(pool.address, lp.address);
      expect(stakedBalance).to.be.eq(bptBalance);
    });

    it('stakes with a permit signature to a recipient', async () => {
      const bptBalance = await pool.balanceOf(lp.address);

      const { v, r, s } = await signPermit(pool, lp, stakingContract, bptBalance);
      await stakingContract.connect(lp).stakeWithPermit(pool.address, bptBalance, MAX_UINT256, other.address, v, r, s);

      const stakedBalance = await stakingContract.balanceOf(pool.address, other.address);
      expect(stakedBalance).to.be.eq(bptBalance);
    });
  });

  describe('with two stakes', () => {
    const rewardAmount = fp(1);
    sharedBeforeEach(async () => {
      await stakingContract.connect(rewarder).allowlistRewarder(pool.address, rewardToken.address, rewarder.address);
      await stakingContract.connect(rewarder).addReward(pool.address, rewardToken.address, rewardsDuration);

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
      const receipt = await (
        await stakingContract.connect(rewarder).notifyRewardAmount(pool.address, rewardToken.address, rewardAmount)
      ).wait();

      expectEvent.inReceipt(receipt, 'RewardAdded', {
        token: rewardToken.address,
        amount: rewardAmount,
      });
    });

    describe('when the rewarder has called notifyRewardAmount', () => {
      sharedBeforeEach(async () => {
        await stakingContract.connect(rewarder).notifyRewardAmount(pool.address, rewardToken.address, rewardAmount);
        await advanceTime(10);
      });

      it('distributes the reward according to the fraction of staked LP tokens', async () => {
        // 3/4 share
        const expectedReward = fp(0.75);
        const actualReward = await stakingContract.totalEarned(pool.address, lp.address, rewardToken.address);

        expect(expectedReward.sub(actualReward).abs()).to.be.lte(100);

        // 1/4 share
        const expectedRewardOther = fp(0.25);
        const actualRewardOther = await stakingContract.totalEarned(pool.address, other.address, rewardToken.address);

        expect(expectedRewardOther.sub(actualRewardOther).abs()).to.be.lte(100);
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
        const expectedReward = bn('749999999999999923');

        const receipt = await (await stakingContract.connect(lp).getReward([pool.address])).wait();

        expectEvent.inReceipt(receipt, 'RewardPaid', {
          user: lp.address,
          rewardToken: rewardToken.address,
          amount: expectedReward,
        });
      });
    });

    describe('with a second distribution from the same rewarder', () => {
      const secondRewardAmount = fp(2);

      sharedBeforeEach(async () => {
        await stakingContract.connect(rewarder).notifyRewardAmount(pool.address, rewardToken.address, rewardAmount);
        await stakingContract
          .connect(rewarder)
          .notifyRewardAmount(pool.address, rewardToken.address, secondRewardAmount);
        // total reward = fp(3)
      });

      it('calculates totalEarned from both distributions', async () => {
        const expectedReward = fp(0.75).mul(3);
        await advanceTime(10);

        const actualReward = await stakingContract.totalEarned(pool.address, lp.address, rewardToken.address);
        expect(expectedReward.sub(actualReward).abs()).to.be.lte(300);
      });
    });

    describe('when one user claims, and then a second distribution is added', () => {
      const secondRewardAmount = fp(2);

      sharedBeforeEach(async () => {
        await stakingContract.connect(other).getReward([pool.address]);

        await stakingContract.connect(rewarder).notifyRewardAmount(pool.address, rewardToken.address, rewardAmount);
        await stakingContract
          .connect(rewarder)
          .notifyRewardAmount(pool.address, rewardToken.address, secondRewardAmount);
      });

      it('calculates totalEarned from both distributions for the other user', async () => {
        const expectedReward = fp(0.75).mul(3);
        await advanceTime(10);

        const actualReward = await stakingContract.totalEarned(pool.address, lp.address, rewardToken.address);
        expect(expectedReward.sub(actualReward).abs()).to.be.lte(300);
      });
    });

    describe('with a second distributions from another rewarder', () => {
      const secondRewardAmount = fp(2);

      sharedBeforeEach(async () => {
        await stakingContract.connect(rewarder).notifyRewardAmount(pool.address, rewardToken.address, rewardAmount);

        await stakingContract.connect(admin).allowlistRewarder(pool.address, rewardToken.address, other.address);

        await rewardTokens.mint({ to: other, amount: rewardTokenInitialBalance });
        await rewardTokens.approve({ to: stakingContract.address, from: [other] });

        await stakingContract.connect(admin).allowlistRewarder(pool.address, rewardToken.address, other.address);
        await stakingContract.connect(other).addReward(pool.address, rewardToken.address, rewardsDuration);

        await stakingContract.connect(other).notifyRewardAmount(pool.address, rewardToken.address, secondRewardAmount);
      });

      it('calculates totalEarned from both distributions', async () => {
        const expectedReward = fp(0.75).mul(3);
        await advanceTime(10);

        const actualReward = await stakingContract.totalEarned(pool.address, lp.address, rewardToken.address);
        expect(expectedReward.sub(actualReward).abs()).to.be.lte(300);
      });

      it('calculates totalEarned from both distributions for the other user', async () => {
        const expectedReward = fp(0.75).mul(3);
        await advanceTime(10);

        const actualReward = await stakingContract.totalEarned(pool.address, lp.address, rewardToken.address);
        expect(expectedReward.sub(actualReward).abs()).to.be.lte(300);
      });
    });
  });

  describe('with two pools', async () => {
    let pool2: Contract;

    const rewardAmount = fp(1);

    sharedBeforeEach('deploy another pool', async () => {
      await stakingContract.connect(rewarder).allowlistRewarder(pool.address, rewardToken.address, rewarder.address);
      await stakingContract.connect(rewarder).addReward(pool.address, rewardToken.address, rewardsDuration);
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

      await stakingContract.connect(rewarder).allowlistRewarder(pool2.address, rewardToken.address, rewarder.address);
      await stakingContract.connect(rewarder).addReward(pool2.address, rewardToken.address, rewardsDuration);

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

      await advanceTime(10);

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
      await advanceTime(10);

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
