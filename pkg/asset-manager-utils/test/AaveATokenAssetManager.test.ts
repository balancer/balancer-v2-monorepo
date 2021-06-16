import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { encodeJoinWeightedPool } from '@balancer-labs/v2-helpers/src/models/pools/weighted/encoding';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';
import { calcRebalanceAmount, encodeInvestmentConfig } from './helpers/rebalance';

const OVER_INVESTMENT_REVERT_REASON = 'investment amount exceeds target';
const UNDER_INVESTMENT_REVERT_REASON = 'withdrawal leaves insufficient balance invested';

const tokenInitialBalance = bn(200e18);
const amount = bn(100e18);

const setup = async () => {
  const [, admin, lp, other] = await ethers.getSigners();

  const tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });

  // Deploy Balancer Vault
  const authorizer = await deploy('v2-vault/Authorizer', { args: [admin.address] });
  const vault = await deploy('v2-vault/Vault', { args: [authorizer.address, tokens.DAI.address, 0, 0] });

  // Deploy mocked Aave
  const lendingPool = await deploy('MockAaveLendingPool', { args: [] });
  const aaveRewardsController = await deploy('MockAaveRewards');
  const stkAave = aaveRewardsController;

  const daiAToken = await deploy('MockAToken', { args: [lendingPool.address, 'aDai', 'aDai', 18] });
  await lendingPool.registerAToken(tokens.DAI.address, daiAToken.address);

  // Deploy Asset manager
  const assetManager = await deploy('AaveATokenAssetManager', {
    args: [
      vault.address,
      tokens.DAI.address,
      lendingPool.address,
      daiAToken.address,
      aaveRewardsController.address,
      stkAave.address,
    ],
  });

  // Assign assetManager to the DAI token, and other to the other token
  const assetManagers = [assetManager.address, other.address];

  // Deploy Pool
  const args = [
    vault.address,
    'Test Pool',
    'TEST',
    tokens.addresses,
    [fp(0.5), fp(0.5)],
    assetManagers,
    fp(0.0001),
    0,
    0,
    admin.address,
  ];

  const pool = await deploy('v2-pool-weighted/WeightedPool', {
    args,
  });
  const poolId = await pool.getPoolId();

  // Deploy staking contract for pool
  const distributor = await deploy('v2-distributors/MultiRewards', {
    args: [vault.address],
  });

  await assetManager.initialise(poolId, distributor.address);

  const rewardsDuration = 1; // Have a neglibile duration so that rewards are distributed instantaneously
  await distributor.addReward(pool.address, stkAave.address, assetManager.address, rewardsDuration);

  await tokens.mint({ to: lp, amount: tokenInitialBalance });
  await tokens.approve({ to: vault.address, from: [lp] });

  const assets = tokens.addresses;
  await vault.connect(lp).joinPool(poolId, lp.address, lp.address, {
    assets: tokens.addresses,
    maxAmountsIn: Array(assets.length).fill(MAX_UINT256),
    fromInternalBalance: false,
    userData: encodeJoinWeightedPool({
      kind: 'Init',
      amountsIn: Array(assets.length).fill(tokenInitialBalance),
    }),
  });

  return {
    data: {
      poolId,
    },
    contracts: {
      assetManager,
      distributor,
      lendingPool,
      tokens,
      stkAave,
      pool,
      vault,
    },
  };
};

describe('Aave Asset manager', function () {
  let tokens: TokenList,
    vault: Contract,
    assetManager: Contract,
    lendingPool: Contract,
    distributor: Contract,
    pool: Contract,
    stkAave: Contract;

  let lp: SignerWithAddress, other: SignerWithAddress;
  let poolId: string;

  before('deploy base contracts', async () => {
    [, , lp, other] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager', async () => {
    const { data, contracts } = await setup();
    poolId = data.poolId;

    assetManager = contracts.assetManager;
    tokens = contracts.tokens;
    vault = contracts.vault;
    pool = contracts.pool;
    lendingPool = contracts.lendingPool;
    distributor = contracts.distributor;
    stkAave = contracts.stkAave;
  });

  describe('deployment', () => {
    it('different managers can be set for different tokens', async () => {
      expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(assetManager.address);
      expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).assetManager).to.equal(other.address);
    });
  });

  describe('when a token is below its investment target', () => {
    let poolController: SignerWithAddress; // TODO
    const targetPercentage = fp(0.9);

    beforeEach(async () => {
      poolController = lp; // TODO
      await assetManager.connect(poolController).setConfig(
        poolId,
        encodeInvestmentConfig({
          targetPercentage,
          upperCriticalPercentage: fp(1),
          lowerCriticalPercentage: 0,
        })
      );
    });

    describe('capitalIn', () => {
      it('transfers only the requested token from the vault to the lending pool via the manager', async () => {
        await expectBalanceChange(() => assetManager.connect(lp).capitalIn(poolId, amount), tokens, [
          { account: lendingPool.address, changes: { DAI: amount } },
          { account: vault.address, changes: { DAI: amount.mul(-1) } },
        ]);
      });

      it('allows anyone to deposit pool assets to an investment manager to get to the target investable %', async () => {
        const amountToDeposit = tokenInitialBalance.mul(bn(79)).div(bn(100));

        await expectBalanceChange(() => assetManager.connect(lp).capitalIn(poolId, amountToDeposit), tokens, [
          { account: lendingPool.address, changes: { DAI: amountToDeposit } },
          { account: vault.address, changes: { DAI: amountToDeposit.mul(-1) } },
        ]);
      });

      it('prevents depositing pool assets to an investment manager over the target investable %', async () => {
        const amountToDeposit = tokenInitialBalance.mul(bn(99)).div(bn(100));

        expect(assetManager.connect(lp).capitalIn(poolId, amountToDeposit)).to.be.revertedWith(
          OVER_INVESTMENT_REVERT_REASON
        );
      });

      it("updates the pool's managed balance", async () => {
        const amountToDeposit = tokenInitialBalance.mul(bn(79)).div(bn(100));

        await assetManager.connect(lp).capitalIn(poolId, amountToDeposit);

        const { managed } = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
        const actualManagedBalance = await assetManager.getAUM();

        expect(managed).to.be.eq(actualManagedBalance);
      });
    });

    describe('capitalOut', () => {
      beforeEach(async () => {
        const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);

        await assetManager.connect(poolController).capitalIn(poolId, maxInvestableBalance.div(2));

        // should be under invested
        expect(maxInvestableBalance).to.gt(bn(0));
      });

      it('reverts', async () => {
        const minimalWithdrawal = 100;
        await expect(assetManager.connect(lp).capitalOut(poolId, minimalWithdrawal)).revertedWith(
          UNDER_INVESTMENT_REVERT_REASON
        );
      });
    });
  });

  describe('when a token is above its investment target', () => {
    let poolController: SignerWithAddress; // TODO
    const amountToDeposit = tokenInitialBalance.mul(bn(9)).div(bn(10));

    beforeEach(async () => {
      const investablePercent = fp(0.9);
      poolController = lp; // TODO
      await assetManager.connect(poolController).setConfig(
        poolId,
        encodeInvestmentConfig({
          targetPercentage: investablePercent,
          upperCriticalPercentage: fp(1),
          lowerCriticalPercentage: 0,
        })
      );

      await assetManager.connect(poolController).capitalIn(poolId, amountToDeposit);

      // should be perfectly balanced
      const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);
      expect(maxInvestableBalance).to.equal(bn(0));

      // Simulate a return on asset manager's investment
      const amountReturned = amountToDeposit.div(10);
      await lendingPool.connect(lp).simulateATokenIncrease(tokens.DAI.address, amountReturned, assetManager.address);

      await assetManager.connect(lp).updateBalanceOfPool(poolId);
    });

    describe('capitalIn', () => {
      it('reverts', async () => {
        const minimalInvestment = 1;
        await expect(assetManager.connect(lp).capitalIn(poolId, minimalInvestment)).revertedWith(
          OVER_INVESTMENT_REVERT_REASON
        );
      });
    });

    describe('capitalOut', () => {
      it('allows anyone to withdraw assets to a pool to get to the target investable %', async () => {
        const amountToWithdraw = (await assetManager.maxInvestableBalance(poolId)).mul(-1);
        // await assetManager.connect(poolController).setInvestablePercent(poolId, fp(0));

        await expectBalanceChange(() => assetManager.connect(lp).capitalOut(poolId, amountToWithdraw), tokens, [
          { account: lendingPool.address, changes: { DAI: ['near', amountToWithdraw.mul(-1)] } },
          { account: vault.address, changes: { DAI: ['near', amountToWithdraw] } },
        ]);
      });

      it("updates the pool's managed balance", async () => {
        const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);

        // return a portion of the return to the vault to serve as a buffer
        const amountToWithdraw = maxInvestableBalance.abs();

        await assetManager.connect(lp).capitalOut(poolId, amountToWithdraw);

        const { managed } = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
        const actualManagedBalance = await assetManager.getAUM();

        expect(managed).to.be.eq(actualManagedBalance);
      });

      it('allows the pool to withdraw tokens to rebalance', async () => {
        const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);

        // return a portion of the return to the vault to serve as a buffer
        const amountToWithdraw = maxInvestableBalance.abs();

        await expectBalanceChange(() => assetManager.connect(lp).capitalOut(poolId, amountToWithdraw), tokens, [
          { account: lendingPool.address, changes: { DAI: ['near', amountToWithdraw.mul(-1)] } },
          { account: vault.address, changes: { DAI: ['near', amountToWithdraw] } },
        ]);
      });
    });
  });

  describe('claimRewards', () => {
    const rewardAmount = fp(1);

    beforeEach(async () => {
      const bptBalance = await pool.balanceOf(lp.address);
      await pool.connect(lp).approve(distributor.address, bptBalance);
      await distributor.connect(lp)['stake(address,uint256)'](pool.address, bptBalance.mul(3).div(4));

      // Stake half of the BPT to another address
      await distributor.connect(lp)['stake(address,uint256,address)'](pool.address, bptBalance.div(4), other.address);
    });

    it('sends expected amount of stkAave to the rewards contract', async () => {
      const rewardsBefore = await vault.getInternalBalance(distributor.address, [stkAave.address]);
      await assetManager.claimRewards();
      const rewardsAfter = await vault.getInternalBalance(distributor.address, [stkAave.address]);
      expect(rewardsAfter[0]).to.be.eq(rewardsBefore[0].add(rewardAmount));
    });

    it('distributes the reward according to the fraction of staked LP tokens', async () => {
      await assetManager.claimRewards();
      await advanceTime(10);

      const expectedReward = fp(0.75);
      const actualReward = await distributor.earned(pool.address, lp.address, stkAave.address);
      expect(expectedReward.sub(actualReward).abs()).to.be.lte(100);
    });
  });

  describe('rebalance', () => {
    function itRebalancesCorrectly(force: boolean) {
      it('emits a Rebalance event', async () => {
        const tx = await assetManager.rebalance(poolId, force);
        const receipt = await tx.wait();
        expectEvent.inReceipt(receipt, 'Rebalance');
      });

      it('transfers the expected number of tokens to the Vault', async () => {
        const config = await assetManager.getInvestmentConfig(poolId);
        const { poolCash, poolManaged } = await assetManager.getPoolBalances(poolId);
        const expectedRebalanceAmount = calcRebalanceAmount(poolCash, poolManaged, config);

        await expectBalanceChange(() => assetManager.rebalance(poolId, force), tokens, [
          { account: lendingPool.address, changes: { DAI: expectedRebalanceAmount } },
          { account: vault.address, changes: { DAI: expectedRebalanceAmount.mul(-1) } },
        ]);
      });

      it('returns the pool to its target allocation', async () => {
        await assetManager.rebalance(poolId, force);
        const differenceFromTarget = await assetManager.maxInvestableBalance(poolId);
        expect(differenceFromTarget.abs()).to.be.lte(1);
      });

      it("updates the pool's managed balance on the vault correctly", async () => {
        await assetManager.rebalance(poolId, force);
        const { poolManaged: expectedManaged } = await assetManager.getPoolBalances(poolId);
        const { managed: actualManaged } = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
        expect(actualManaged).to.be.eq(expectedManaged);
      });
    }

    function itSkipsTheRebalance() {
      it('skips the rebalance', async () => {
        const tx = await assetManager.rebalance(poolId, false);
        const receipt = await tx.wait();
        expectEvent.notEmitted(receipt, 'Rebalance');
      });
    }

    const config = {
      targetPercentage: fp(0.5),
      upperCriticalPercentage: fp(0.75),
      lowerCriticalPercentage: fp(0.25),
    };

    sharedBeforeEach(async () => {
      const poolController = lp; // TODO
      await assetManager.connect(poolController).setConfig(poolId, encodeInvestmentConfig(config));
    });

    context('when pool is above target investment level', () => {
      context('when pool is in non-critical range', () => {
        sharedBeforeEach(async () => {
          const poolController = lp; // TODO
          await assetManager.connect(poolController).setConfig(poolId, encodeInvestmentConfig(config));
          const amountToDeposit = await assetManager.maxInvestableBalance(poolId);
          await assetManager.connect(poolController).capitalIn(poolId, amountToDeposit);

          // should be perfectly balanced
          const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);
          expect(maxInvestableBalance).to.equal(bn(0));

          // Simulate a return on asset manager's investment
          const amountReturned = amountToDeposit.div(10);
          await lendingPool
            .connect(lp)
            .simulateATokenIncrease(tokens.DAI.address, amountReturned, assetManager.address);
        });

        context('when forced', () => {
          const force = true;
          itRebalancesCorrectly(force);
        });

        context('when not forced', () => {
          itSkipsTheRebalance();
        });
      });
    });

    context('when pool is above upper critical investment level', () => {
      sharedBeforeEach(async () => {
        const poolController = lp; // TODO
        const amountToDeposit = await assetManager.maxInvestableBalance(poolId);
        await assetManager.connect(poolController).capitalIn(poolId, amountToDeposit);

        // should be perfectly balanced
        const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);
        expect(maxInvestableBalance).to.equal(bn(0));

        // Simulate a return on asset manager's investment which results in exceeding the upper critical level
        await tokens.DAI.mint(lendingPool.address, amountToDeposit.mul(4));
        await lendingPool
          .connect(lp)
          .simulateATokenIncrease(tokens.DAI.address, amountToDeposit.mul(4), assetManager.address);
        await assetManager.updateBalanceOfPool(poolId);
      });

      context('when forced', () => {
        const force = true;
        itRebalancesCorrectly(force);
      });

      context('when not forced', () => {
        const force = false;
        itRebalancesCorrectly(force);
      });
    });

    context('when pool is below target investment level', () => {
      context('when pool is in non-critical range', () => {
        sharedBeforeEach(async () => {
          const poolController = lp; // TODO
          // Ensure that the pool is invested below its target level but above than critical level
          const targetInvestmentAmount = await assetManager.maxInvestableBalance(poolId);
          await assetManager.connect(poolController).capitalIn(poolId, targetInvestmentAmount.div(2));
        });

        context('when forced', () => {
          const force = true;
          itRebalancesCorrectly(force);
        });

        context('when not forced', () => {
          itSkipsTheRebalance();
        });
      });

      context('when pool is below lower critical investment level', () => {
        context('when forced', () => {
          const force = true;
          itRebalancesCorrectly(force);
        });

        context('when not forced', () => {
          const force = false;
          itRebalancesCorrectly(force);
        });
      });
    });
  });
});
