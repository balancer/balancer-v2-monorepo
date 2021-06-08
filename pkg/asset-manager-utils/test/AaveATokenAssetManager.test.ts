import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { encodeJoinWeightedPool } from '@balancer-labs/v2-helpers/src/models/pools/weighted/encoding';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';

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

  describe('setPoolConfig', () => {
    let poolController: SignerWithAddress;

    sharedBeforeEach(async () => {
      poolController = lp; // TODO
    });

    it('allows a pool controller to set the pools target investment config', async () => {
      const updatedConfig = { targetPercentage: 3, criticalPercentage: 2, feePercentage: 1 };
      await assetManager.connect(poolController).setPoolConfig(poolId, updatedConfig);

      const result = await assetManager.getPoolConfig(poolId);
      expect(result.targetPercentage).to.equal(updatedConfig.targetPercentage);
      expect(result.criticalPercentage).to.equal(updatedConfig.criticalPercentage);
      expect(result.feePercentage).to.equal(updatedConfig.feePercentage);
    });

    it('reverts when setting target over 100%', async () => {
      const badPoolConfig = { targetPercentage: fp(1.1), criticalPercentage: 0, feePercentage: 0 };
      await expect(assetManager.connect(poolController).setPoolConfig(poolId, badPoolConfig)).to.be.revertedWith(
        'Investment target must be less than 100%'
      );
    });

    it('reverts when setting critical above target', async () => {
      const badPoolConfig = { targetPercentage: 1, criticalPercentage: 2, feePercentage: 0 };
      await expect(assetManager.connect(poolController).setPoolConfig(poolId, badPoolConfig)).to.be.revertedWith(
        'Critical level must be less than target'
      );
    });

    it('reverts when setting fee percentage over 100%', async () => {
      const badPoolConfig = { targetPercentage: 0, criticalPercentage: 0, feePercentage: fp(1.01) };
      await expect(assetManager.connect(poolController).setPoolConfig(poolId, badPoolConfig)).to.be.revertedWith(
        'Fee on critical rebalances must be less than 10%'
      );
    });

    it('prevents an unauthorized user from setting the pool config');
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

  describe('getRebalanceFee', () => {
    describe('when pool is safely above critical investment level', () => {
      let poolController: SignerWithAddress; // TODO
      const poolConfig = { targetPercentage: fp(0.5), criticalPercentage: fp(0.1), feePercentage: fp(0.1) };

      sharedBeforeEach(async () => {
        poolController = lp; // TODO

        await assetManager.connect(poolController).setPoolConfig(poolId, poolConfig);
        // Ensure that the pool is invested below its target level but above than critical level
        const targetInvestmentAmount = await assetManager.maxInvestableBalance(poolId);
        await assetManager.connect(poolController).capitalIn(poolId, targetInvestmentAmount.div(2));
      });

      it('returns 0', async () => {
        expect(await assetManager.getRebalanceFee(poolId)).to.be.eq(0);
      });
    });

    describe('when pool is below critical investment level', () => {
      let poolController: SignerWithAddress; // TODO

      describe('when fee percentage is zero', () => {
        const poolConfig = { targetPercentage: fp(0.5), criticalPercentage: fp(0.1), feePercentage: fp(0) };
        sharedBeforeEach(async () => {
          poolController = lp; // TODO

          await assetManager.connect(poolController).setPoolConfig(poolId, poolConfig);
        });

        it('returns 0', async () => {
          const expectedFee = 0;
          expect(await assetManager.getRebalanceFee(poolId)).to.be.eq(expectedFee);
        });
      });

      describe('when fee percentage is non-zero', () => {
        let targetInvestmentAmount: BigNumber;
        const poolConfig = { targetPercentage: fp(0.5), criticalPercentage: fp(0.1), feePercentage: fp(0.1) };
        sharedBeforeEach(async () => {
          poolController = lp; // TODO

          await assetManager.connect(poolController).setPoolConfig(poolId, poolConfig);
          targetInvestmentAmount = await assetManager.maxInvestableBalance(poolId);
        });

        it('returns the expected fee', async () => {
          const expectedFee = targetInvestmentAmount.div(5).div(10);
          expect(await assetManager.getRebalanceFee(poolId)).to.be.eq(expectedFee);
        });
      });
    });
  });

  describe('rebalance', () => {
    describe('when pool is below target investment level', () => {
      describe('when pool is safely above critical investment level', () => {
        let poolController: SignerWithAddress; // TODO
        const poolConfig = { targetPercentage: fp(0.5), criticalPercentage: fp(0.1), feePercentage: fp(0.1) };

        sharedBeforeEach(async () => {
          poolController = lp; // TODO

          await assetManager.connect(poolController).setPoolConfig(poolId, poolConfig);
          // Ensure that the pool is invested below its target level but above than critical level
          const targetInvestmentAmount = await assetManager.maxInvestableBalance(poolId);
          await assetManager.connect(poolController).capitalIn(poolId, targetInvestmentAmount.div(2));
        });

        it('transfers the expected number of tokens from the Vault', async () => {
          const expectedRebalanceAmount = await assetManager.maxInvestableBalance(poolId);

          await expectBalanceChange(() => assetManager.rebalance(poolId), tokens, [
            { account: lendingPool.address, changes: { DAI: ['very-near', expectedRebalanceAmount] } },
            { account: vault.address, changes: { DAI: ['very-near', -expectedRebalanceAmount] } },
          ]);
        });

        it('returns the pool to its target allocation', async () => {
          await assetManager.rebalance(poolId);
          expect(await assetManager.maxInvestableBalance(poolId)).to.be.eq(0);
        });
      });

      describe('when pool is below critical investment level', () => {
        let poolController: SignerWithAddress; // TODO

        describe('when fee percentage is zero', () => {
          const poolConfig = { targetPercentage: fp(0.5), criticalPercentage: fp(0.1), feePercentage: fp(0) };
          sharedBeforeEach(async () => {
            poolController = lp; // TODO

            await assetManager.connect(poolController).setPoolConfig(poolId, poolConfig);
          });

          it('transfers the expected number of tokens from the Vault', async () => {
            const expectedRebalanceAmount = await assetManager.maxInvestableBalance(poolId);

            await expectBalanceChange(() => assetManager.rebalance(poolId), tokens, [
              { account: lendingPool.address, changes: { DAI: ['very-near', expectedRebalanceAmount] } },
              { account: vault.address, changes: { DAI: ['very-near', -expectedRebalanceAmount] } },
            ]);
          });

          it('returns the pool to its target allocation', async () => {
            await assetManager.rebalance(poolId);
            expect(await assetManager.maxInvestableBalance(poolId)).to.be.eq(0);
          });
        });

        describe('when fee percentage is non-zero', () => {
          let zeroFeeRebalanceAmount: BigNumber;
          const poolConfig = { targetPercentage: fp(0.5), criticalPercentage: fp(0.1), feePercentage: fp(0.1) };
          sharedBeforeEach(async () => {
            poolController = lp; // TODO

            await assetManager.connect(poolController).setPoolConfig(poolId, poolConfig);
            zeroFeeRebalanceAmount = await assetManager.maxInvestableBalance(poolId);
          });

          it('transfers the expected number of tokens from the Vault', async () => {
            const expectedFeeAmount = await assetManager.getRebalanceFee(poolId);

            const investmentFeeAdjustment = expectedFeeAmount.mul(poolConfig.targetPercentage).div(fp(1));
            const expectedInvestmentAmount = zeroFeeRebalanceAmount.sub(investmentFeeAdjustment);

            const expectedVaultRemovedAmount = expectedInvestmentAmount.add(expectedFeeAmount);

            await expectBalanceChange(() => assetManager.connect(lp).rebalance(poolId), tokens, [
              { account: lendingPool.address, changes: { DAI: ['very-near', expectedInvestmentAmount] } },
              { account: vault.address, changes: { DAI: ['very-near', -expectedVaultRemovedAmount] } },
            ]);
          });

          it('pays the correct fee to the rebalancer', async () => {
            const expectedFeeAmount = await assetManager.getRebalanceFee(poolId);
            await expectBalanceChange(() => assetManager.connect(lp).rebalance(poolId), tokens, [
              { account: lp.address, changes: { DAI: ['very-near', expectedFeeAmount] } },
            ]);
          });

          it('returns the pool to its target allocation', async () => {
            await assetManager.rebalance(poolId);
            expect(await assetManager.maxInvestableBalance(poolId)).to.be.eq(0);
          });
        });
      });
    });
  });
});
