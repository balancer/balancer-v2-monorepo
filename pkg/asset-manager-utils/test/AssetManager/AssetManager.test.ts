import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';

import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { amount, setup, tokenInitialBalance } from '../helpers/setup';

const OVER_INVESTMENT_REVERT_REASON = 'investment amount exceeds target';
const UNDER_INVESTMENT_REVERT_REASON = 'withdrawal leaves insufficient balance invested';

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
      const updatedConfig = {
        targetPercentage: 3,
        upperCriticalPercentage: 4,
        lowerCriticalPercentage: 2,
        feePercentage: 1,
      };
      await assetManager.connect(poolController).setPoolConfig(poolId, updatedConfig);

      const result = await assetManager.getPoolConfig(poolId);
      expect(result.targetPercentage).to.equal(updatedConfig.targetPercentage);
      expect(result.upperCriticalPercentage).to.equal(updatedConfig.upperCriticalPercentage);
      expect(result.lowerCriticalPercentage).to.equal(updatedConfig.lowerCriticalPercentage);
      expect(result.feePercentage).to.equal(updatedConfig.feePercentage);
    });

    it('reverts when setting upper critical over 100%', async () => {
      const badPoolConfig = {
        targetPercentage: 0,
        upperCriticalPercentage: fp(1.1),
        lowerCriticalPercentage: 0,
        feePercentage: 0,
      };
      await expect(assetManager.connect(poolController).setPoolConfig(poolId, badPoolConfig)).to.be.revertedWith(
        'Upper critical level must be less than 100%'
      );
    });

    it('reverts when setting upper critical below target', async () => {
      const badPoolConfig = {
        targetPercentage: 1,
        upperCriticalPercentage: 0,
        lowerCriticalPercentage: 0,
        feePercentage: 0,
      };
      await expect(assetManager.connect(poolController).setPoolConfig(poolId, badPoolConfig)).to.be.revertedWith(
        'Target must be less than upper critical level'
      );
    });

    it('reverts when setting lower critical above target', async () => {
      const badPoolConfig = {
        targetPercentage: 1,
        upperCriticalPercentage: 2,
        lowerCriticalPercentage: 2,
        feePercentage: 0,
      };
      await expect(assetManager.connect(poolController).setPoolConfig(poolId, badPoolConfig)).to.be.revertedWith(
        'Lower critical level must be less than target'
      );
    });

    it('reverts when setting fee percentage over 100%', async () => {
      const badPoolConfig = {
        targetPercentage: 0,
        upperCriticalPercentage: 0,
        lowerCriticalPercentage: 0,
        feePercentage: fp(1.01),
      };
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
        await assetManager.connect(poolController).setPoolConfig(poolId, {
          targetPercentage: investablePercent,
          upperCriticalPercentage: fp(1),
          lowerCriticalPercentage: 0,
          feePercentage: 0,
        });
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
        await assetManager.connect(poolController).setPoolConfig(poolId, {
          targetPercentage: investablePercent,
          upperCriticalPercentage: fp(1),
          lowerCriticalPercentage: 0,
          feePercentage: 0,
        });
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
});
