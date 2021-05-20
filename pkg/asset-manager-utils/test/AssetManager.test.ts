import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { GeneralPool } from '@balancer-labs/v2-helpers/src/models/vault/pools';
import { encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';

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

  // Deploy Asset manager
  const assetManager = await deploy('TestAssetManager', {
    args: [vault.address, tokens.DAI.address],
  });

  // Deploy Pool
  const pool = await deploy('v2-vault/MockPool', { args: [vault.address, GeneralPool] });
  const poolId = await pool.getPoolId();

  await tokens.mint({ to: lp, amount: tokenInitialBalance });
  await tokens.approve({ to: vault.address, from: [lp] });

  // Assign assetManager to the DAI token, and other to the other token
  const assetManagers = [assetManager.address, other.address];

  await pool.registerTokens(tokens.addresses, assetManagers);

  await vault.connect(lp).joinPool(poolId, lp.address, lp.address, {
    assets: tokens.addresses,
    maxAmountsIn: tokens.addresses.map(() => MAX_UINT256),
    fromInternalBalance: false,
    userData: encodeJoin(
      tokens.addresses.map(() => tokenInitialBalance),
      tokens.addresses.map(() => 0)
    ),
  });

  return {
    data: {
      poolId,
    },
    contracts: {
      assetManager,
      tokens,
      pool,
      vault,
    },
  };
};

describe('Asset manager', function () {
  let tokens: TokenList, vault: Contract, assetManager: Contract;

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
  });

  describe('capital[In/Out]', () => {
    describe('when a token is below its investment target', () => {
      let poolController: SignerWithAddress; // TODO
      const investablePercent = fp(0.9);

      sharedBeforeEach(async () => {
        poolController = lp; // TODO
        await assetManager
          .connect(poolController)
          .setPoolConfig(poolId, { targetPercentage: investablePercent, criticalPercentage: 0, feePercentage: 0 });
      });

      describe('capitalIn', () => {
        it('transfers only the requested token from the vault to the lending pool via the manager', async () => {
          await expectBalanceChange(() => assetManager.connect(lp).capitalIn(poolId, amount), tokens, [
            { account: assetManager.address, changes: { DAI: amount } },
            { account: vault.address, changes: { DAI: -amount } },
          ]);
        });

        it('allows anyone to deposit pool assets to an investment manager to get to the target investable %', async () => {
          const amountToDeposit = tokenInitialBalance.mul(bn(79)).div(bn(100));

          await expectBalanceChange(() => assetManager.connect(lp).capitalIn(poolId, amountToDeposit), tokens, [
            { account: assetManager.address, changes: { DAI: amountToDeposit } },
            { account: vault.address, changes: { DAI: -amountToDeposit } },
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
        sharedBeforeEach(async () => {
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

      sharedBeforeEach(async () => {
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
        await assetManager.connect(lp).setUnrealisedAUM(amountToDeposit.add(amountReturned));

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
            { account: assetManager.address, changes: { DAI: ['very-near', -amountToWithdraw] } },
            { account: vault.address, changes: { DAI: ['very-near', amountToWithdraw] } },
          ]);
        });

        it("updates the pool's managed balance", async () => {
          const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);

          // return a portion of the return to the vault to serve as a buffer
          const amountToWithdraw = maxInvestableBalance.abs();

          await assetManager.connect(lp).capitalOut(poolId, amountToWithdraw);

          const { managed } = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
          const actualManagedBalance = await assetManager.readAUM();

          expect(managed.sub(actualManagedBalance)).to.be.lt(10);
        });

        it('allows the pool to withdraw tokens to rebalance', async () => {
          const maxInvestableBalance = await assetManager.maxInvestableBalance(poolId);

          // return a portion of the return to the vault to serve as a buffer
          const amountToWithdraw = maxInvestableBalance.abs();

          await expectBalanceChange(() => assetManager.connect(lp).capitalOut(poolId, amountToWithdraw), tokens, [
            { account: assetManager.address, changes: { DAI: ['very-near', -amountToWithdraw] } },
            { account: vault.address, changes: { DAI: ['very-near', amountToWithdraw] } },
          ]);
        });
      });
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
            { account: assetManager.address, changes: { DAI: ['very-near', expectedRebalanceAmount] } },
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
              { account: assetManager.address, changes: { DAI: ['very-near', expectedRebalanceAmount] } },
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
              { account: assetManager.address, changes: { DAI: ['very-near', expectedInvestmentAmount] } },
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
