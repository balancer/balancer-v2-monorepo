import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../scripts/helpers/deploy';
import { PairTS } from '../scripts/helpers/pools';
import { deployToken } from './helpers/tokens';
import { MAX_UINT256 } from './helpers/constants';
import { setupController } from '../scripts/helpers/controllers';

const { BigNumber } = ethers;

describe('InvestmentManager', function () {
  let poolId: string;
  let admin: SignerWithAddress, owner: SignerWithAddress;
  let vault: Contract, tokenizer: Contract, strategy: Contract;
  let investmentManager: Contract, DAI: Contract, USDT: Contract;

  beforeEach('set up investment manager', async () => {
    [, admin, owner] = await ethers.getSigners();
    vault = await deploy('Vault', { args: [admin.address] });
    strategy = await deploy('MockTradingStrategy', { args: [] });

    DAI = await deployToken('DAI', 18);
    USDT = await deployToken('USDT', 18);

    await Promise.all(
      [USDT, DAI].map(async (token) => {
        await token.mint(owner.address, (200e18).toString());
        await token.connect(owner).approve(vault.address, MAX_UINT256);
      })
    );

    tokenizer = await setupController(
      vault,
      admin,
      owner,
      'OwnableFixedSetPoolTokenizer',
      strategy.address,
      PairTS,
      (100e18).toString(),
      [USDT.address, DAI.address],
      [(100e18).toString(), (100e18).toString()],
      owner.address
    );

    poolId = await tokenizer.poolId();
    investmentManager = await deploy('MockInvestmentManager', { args: [vault.address, DAI.address] });
    await investmentManager.initialize();
  });

  describe('invest', () => {
    context('when the given manager is allowed', () => {
      beforeEach('authorize manager', async () => {
        await tokenizer.connect(owner).authorizePoolInvestmentManager(DAI.address, investmentManager.address);
      });

      context('when trying to invest less than the vault balance', () => {
        const amount = BigNumber.from((10e18).toString());

        it('transfers the requested token from the vault to the investment manager', async () => {
          const previousVaultBalance = await DAI.balanceOf(vault.address);
          const previousManagerBalance = await DAI.balanceOf(investmentManager.address);

          await vault.investPoolBalance(poolId, DAI.address, investmentManager.address, amount);

          const currentVaultBalance = await DAI.balanceOf(vault.address);
          expect(currentVaultBalance).to.equal(previousVaultBalance.sub(amount));

          const currentManagerBalance = await DAI.balanceOf(investmentManager.address);
          expect(currentManagerBalance).to.equal(previousManagerBalance.add(amount));
        });

        it('does not affect other vault tokens', async () => {
          const previousVaultBalance = await USDT.balanceOf(vault.address);
          const previousManagerBalance = await USDT.balanceOf(investmentManager.address);

          await vault.investPoolBalance(poolId, DAI.address, investmentManager.address, amount);

          const currentVaultBalance = await USDT.balanceOf(vault.address);
          expect(currentVaultBalance).to.equal(previousVaultBalance);

          const currentManagerBalance = await USDT.balanceOf(investmentManager.address);
          expect(currentManagerBalance).to.equal(previousManagerBalance);
        });

        it('does not affect the balance of the pools', async () => {
          const tokenAddresses = [DAI.address, USDT.address];
          const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

          await vault.investPoolBalance(poolId, DAI.address, investmentManager.address, amount);

          const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
          expect(currentBalanceDAI).to.equal(previousBalanceDAI);
          expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
        });
      });

      context('when trying to invest more than the vault balance', () => {
        const amount = BigNumber.from((101e18).toString());

        it('reverts', async () => {
          await expect(
            vault.investPoolBalance(poolId, DAI.address, investmentManager.address, amount)
          ).to.be.revertedWith('ERR_SUB_UNDERFLOW');
        });
      });
    });

    context('when the given manager is not allowed', () => {
      it('reverts', async () => {
        await expect(vault.investPoolBalance(poolId, DAI.address, investmentManager.address, 0)).to.be.revertedWith(
          'SENDER_NOT_INVESTMENT_MANAGER'
        );
      });
    });
  });

  describe('divest', () => {
    context('when the given manager is allowed', () => {
      beforeEach('authorize manager', async () => {
        await tokenizer.connect(owner).authorizePoolInvestmentManager(DAI.address, investmentManager.address);
      });

      context('when trying to divest less than the invested balance', () => {
        const investedAmount = BigNumber.from((75e18).toString());
        const amount = investedAmount.div(2);

        beforeEach('invest', async () => {
          await vault.investPoolBalance(poolId, DAI.address, investmentManager.address, investedAmount);
        });

        it('transfers the requested token from the manager to the vault', async () => {
          const previousVaultBalance = await DAI.balanceOf(vault.address);
          const previousManagerBalance = await DAI.balanceOf(investmentManager.address);

          await vault.divestPoolBalance(poolId, DAI.address, investmentManager.address, amount);

          const currentVaultBalance = await DAI.balanceOf(vault.address);
          expect(currentVaultBalance).to.equal(previousVaultBalance.add(amount));

          const currentManagerBalance = await DAI.balanceOf(investmentManager.address);
          expect(currentManagerBalance).to.equal(previousManagerBalance.sub(amount));
        });

        it('does not affect other vault tokens', async () => {
          const previousVaultBalance = await USDT.balanceOf(vault.address);
          const previousManagerBalance = await USDT.balanceOf(investmentManager.address);

          await vault.divestPoolBalance(poolId, DAI.address, investmentManager.address, amount);

          const currentVaultBalance = await USDT.balanceOf(vault.address);
          expect(currentVaultBalance).to.equal(previousVaultBalance);

          const currentManagerBalance = await USDT.balanceOf(investmentManager.address);
          expect(currentManagerBalance).to.equal(previousManagerBalance);
        });

        it('does not affect the balance of the pools', async () => {
          const tokenAddresses = [DAI.address, USDT.address];
          const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

          await vault.divestPoolBalance(poolId, DAI.address, investmentManager.address, amount);

          const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
          expect(currentBalanceDAI).to.equal(previousBalanceDAI);
          expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
        });
      });

      context('when trying to divest more than the invested balance', () => {
        it('reverts', async () => {
          await expect(vault.divestPoolBalance(poolId, DAI.address, investmentManager.address, 1)).to.be.revertedWith(
            'ERR_SUB_UNDERFLOW'
          );
        });
      });
    });

    context('when the given manager is not allowed', () => {
      it('reverts', async () => {
        await expect(vault.divestPoolBalance(poolId, DAI.address, investmentManager.address, 0)).to.be.revertedWith(
          'SENDER_NOT_INVESTMENT_MANAGER'
        );
      });
    });
  });

  describe('update', () => {
    context('when the sender is an allowed manager', () => {
      beforeEach('authorize manager', async () => {
        await tokenizer.connect(owner).authorizePoolInvestmentManager(DAI.address, investmentManager.address);
      });

      context('without gains or losses', () => {
        it('reverts', async () => {
          const amount = BigNumber.from((1e18).toString());
          await vault.investPoolBalance(poolId, DAI.address, investmentManager.address, amount);

          await expect(investmentManager.updateInvested(poolId)).to.be.revertedWith('INVESTMENT_ALREADY_UP_TO_DATE');
        });
      });

      context('with gains', () => {
        const investedAmount = BigNumber.from((75e18).toString());
        const investmentReturns = investedAmount.div(10);

        beforeEach('invest and simulate gains', async () => {
          // simulate returns 100 -> 110 (10%)
          await vault.investPoolBalance(poolId, DAI.address, investmentManager.address, investedAmount);
          await investmentManager.mockIncreasePresentValue((0.1e18).toString());
        });

        it('transfers the requested token from the vault to the investment manager', async () => {
          const previousVaultBalance = await DAI.balanceOf(vault.address);
          const previousManagerBalance = await DAI.balanceOf(investmentManager.address);

          await investmentManager.updateInvested(poolId);

          const currentVaultBalance = await DAI.balanceOf(vault.address);
          expect(currentVaultBalance).to.equal(previousVaultBalance.sub(investmentReturns));

          const currentManagerBalance = await DAI.balanceOf(investmentManager.address);
          expect(currentManagerBalance).to.equal(previousManagerBalance.add(investmentReturns));
        });

        it('does not affect other vault tokens', async () => {
          const previousVaultBalance = await USDT.balanceOf(vault.address);
          const previousManagerBalance = await USDT.balanceOf(investmentManager.address);

          await investmentManager.updateInvested(poolId);

          const currentVaultBalance = await USDT.balanceOf(vault.address);
          expect(currentVaultBalance).to.equal(previousVaultBalance);

          const currentManagerBalance = await USDT.balanceOf(investmentManager.address);
          expect(currentManagerBalance).to.equal(previousManagerBalance);
        });

        it('updates the balance of the pool with gains', async () => {
          const tokenAddresses = [DAI.address, USDT.address];
          const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

          await investmentManager.updateInvested(poolId);

          const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
          expect(currentBalanceDAI).to.equal(previousBalanceDAI.add(investmentReturns));
          expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
        });
      });

      context('with losses', () => {
        const investedAmount = BigNumber.from((75e18).toString());
        const investmentLosses = investedAmount.div(10);

        beforeEach('invest and simulate losses', async () => {
          // simulate returns 100 -> 90 (-10%)
          await vault.investPoolBalance(poolId, DAI.address, investmentManager.address, investedAmount);
          await investmentManager.mockDecreasePresentValue((0.1e18).toString());
        });

        it('transfers the requested token from the vault to the investment manager', async () => {
          const previousVaultBalance = await DAI.balanceOf(vault.address);
          const previousManagerBalance = await DAI.balanceOf(investmentManager.address);

          await investmentManager.updateInvested(poolId);

          const currentVaultBalance = await DAI.balanceOf(vault.address);
          expect(currentVaultBalance).to.equal(previousVaultBalance.add(investmentLosses));

          const currentManagerBalance = await DAI.balanceOf(investmentManager.address);
          expect(currentManagerBalance).to.equal(previousManagerBalance.sub(investmentLosses));
        });

        it('does not affect other vault tokens', async () => {
          const previousVaultBalance = await USDT.balanceOf(vault.address);
          const previousManagerBalance = await USDT.balanceOf(investmentManager.address);

          await investmentManager.updateInvested(poolId);

          const currentVaultBalance = await USDT.balanceOf(vault.address);
          expect(currentVaultBalance).to.equal(previousVaultBalance);

          const currentManagerBalance = await USDT.balanceOf(investmentManager.address);
          expect(currentManagerBalance).to.equal(previousManagerBalance);
        });

        it('updates the balance of the pool with gains', async () => {
          const tokenAddresses = [DAI.address, USDT.address];
          const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

          await investmentManager.updateInvested(poolId);

          const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
          expect(currentBalanceDAI).to.equal(previousBalanceDAI.sub(investmentLosses));
          expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
        });
      });
    });

    context('when the sender is not an allowed manager', () => {
      it('reverts', async () => {
        await expect(vault.updateInvested(poolId, DAI.address, 0)).to.be.revertedWith('SENDER_NOT_INVESTMENT_MANAGER');
      });
    });
  });
});
