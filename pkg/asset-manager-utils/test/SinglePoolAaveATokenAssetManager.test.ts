import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';
import { encodeJoinWeightedPool } from '@balancer-labs/v2-helpers/src/models/pools/weighted/encoding';

const OVER_INVESTMENT_REVERT_REASON = 'investment amount exceeds target';
const UNDER_INVESTMENT_REVERT_REASON = 'withdrawal leaves insufficient balance invested';

const tokenInitialBalance = bn(200e18);
const amount = bn(100e18);

const setup = async () => {
  const [, admin, lp, other] = await ethers.getSigners();

  const tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });

  // Deploy Balancer Vault
  const vaultHelper = await Vault.create({ admin });
  const vault = vaultHelper.instance;

  // Deploy mocked Aave
  const lendingPool = await deploy('MockAaveLendingPool', { args: [] });
  const aaveRewardsController = await deploy('MockAaveRewards');
  const stkAave = aaveRewardsController;

  const daiAToken = await deploy('MockAToken', { args: [lendingPool.address, 'aDai', 'aDai', 18] });
  await lendingPool.registerAToken(tokens.DAI.address, daiAToken.address);

  // Deploy Asset manager
  const assetManager = await deploy('SinglePoolAaveATokenAssetManager', {
    args: [
      vault.address,
      tokens.DAI.address,
      lendingPool.address,
      daiAToken.address,
      aaveRewardsController.address,
      stkAave.address,
    ],
  });
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
    args: [vault.address, pool.address],
  });

  await assetManager.initialise(poolId, distributor.address);

  const rewardsDuration = 1; // Have a neglibile duration so that rewards are distributed instantaneously
  await distributor.addReward(stkAave.address, assetManager.address, rewardsDuration);

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
      lendingPool,
      tokens,
      pool,
      distributor,
      stkAave,
      vault,
    },
  };
};

describe('Single Pool Aave AToken asset manager', function () {
  let tokens: TokenList,
    pool: Contract,
    vault: Contract,
    lendingPool: Contract,
    assetManager: Contract,
    distributor: Contract,
    stkAave: Contract;
  let lp: SignerWithAddress, other: SignerWithAddress;
  let poolId: string;

  before('deploy base contracts', async () => {
    [, , lp, other] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager', async () => {
    const { data, contracts } = await setup();
    poolId = data.poolId;

    pool = contracts.pool;
    assetManager = contracts.assetManager;
    lendingPool = contracts.lendingPool;
    distributor = contracts.distributor;
    stkAave = contracts.stkAave;
    tokens = contracts.tokens;
    vault = contracts.vault;
  });

  describe('deployment', () => {
    it('different managers can be set for different tokens', async () => {
      expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(assetManager.address);
      expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).assetManager).to.equal(other.address);
    });
  });

  describe('setPoolConfig', () => {
    it('allows a pool controller to set the pool config', async () => {
      const targetPercentage = fp(0.8);
      const poolController = lp; // TODO
      await assetManager
        .connect(poolController)
        .setPoolConfig(poolId, { targetPercentage, criticalPercentage: 0, feePercentage: 0 });

      const result = await assetManager.getPoolConfig(poolId);
      expect(result.targetPercentage).to.equal(targetPercentage);
    });

    xit('prevents an unauthorized user from setting the pool config');
  });

  describe('when a token is below its investment target', () => {
    let poolController: SignerWithAddress; // TODO
    const targetPercentage = fp(0.9);

    beforeEach(async () => {
      poolController = lp; // TODO
      await assetManager
        .connect(poolController)
        .setPoolConfig(poolId, { targetPercentage, criticalPercentage: 0, feePercentage: 0 });
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
        const actualManagedBalance = await assetManager.readAUM();

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
      await assetManager
        .connect(poolController)
        .setPoolConfig(poolId, { targetPercentage: investablePercent, criticalPercentage: 0, feePercentage: 0 });

      await assetManager.connect(poolController).capitalIn(poolId, amountToDeposit);

      // should be perfectly balanced
      const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);
      expect(maxInvestableBalance).to.equal(bn(0));

      // Simulate a return on asset manager's investment
      const amountReturned = amountToDeposit.div(10);
      await lendingPool.connect(lp).simulateATokenIncrease(tokens.DAI.address, amountReturned, assetManager.address);
      await assetManager.connect(lp).realizeGains();

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
        const actualManagedBalance = await assetManager.readAUM();

        expect(managed).to.be.eq(actualManagedBalance);
      });

      it('allows the pool to withdraw tokens to rebalance', async () => {
        const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);

        // return a portion of the return to the vault to serve as a buffer
        const amountToWithdraw = maxInvestableBalance.abs();

        await expectBalanceChange(() => assetManager.connect(lp).capitalOut(poolId, amountToWithdraw), tokens, [
          { account: lendingPool.address, changes: { DAI: ['near', -amountToWithdraw] } },
          { account: vault.address, changes: { DAI: ['near', amountToWithdraw] } },
        ]);
      });
    });
  });

  describe('ClaimRewards', () => {
    const rewardAmount = fp(1);

    beforeEach(async () => {
      const bptBalance = await pool.balanceOf(lp.address);
      await pool.connect(lp).approve(distributor.address, bptBalance);
      await distributor.connect(lp)['stake(uint256)'](bptBalance.mul(3).div(4));

      // Stake half of the BPT to another address
      await distributor.connect(lp)['stake(uint256,address)'](bptBalance.div(4), other.address);
    });

    it('sends expected amount of stkAave to the rewards contract', async () => {
      const rewardsBefore = await stkAave.balanceOf(distributor.address);
      await assetManager.claimRewards();
      const rewardsAfter = await stkAave.balanceOf(distributor.address);
      expect(rewardsAfter).to.be.eq(rewardsBefore.add(rewardAmount));
    });

    it('distributes the reward according to the fraction of staked LP tokens', async () => {
      await assetManager.claimRewards();
      await advanceTime(10);

      const expectedReward = fp(0.75);
      const actualReward = await distributor.earned(lp.address, stkAave.address);
      expect(expectedReward.sub(actualReward).abs()).to.be.lte(100);
    });
  });
});
