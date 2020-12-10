import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../scripts/helpers/deploy';
import { PairTS } from '../../scripts/helpers/pools';
import { deployTokens } from '../helpers/tokens';
import { MAX_UINT256 } from '../helpers/constants';
import { setupController } from '../../scripts/helpers/controllers';

const { BigNumber } = ethers;

describe('InvestmentManager', function () {
  let poolId: string;
  let investmentManager: SignerWithAddress, owner: SignerWithAddress;
  let DAI: Contract, USDT: Contract, vault: Contract, strategy: Contract;

  beforeEach('set up investment manager', async () => {
    [, investmentManager, owner] = await ethers.getSigners();
    vault = await deploy('Vault', { args: [owner.address] });
    strategy = await deploy('MockTradingStrategy', { args: [] });

    const tokens = await deployTokens(['DAI', 'WETH'], [18, 18]);
    DAI = tokens.DAI;
    USDT = tokens.WETH;

    await Promise.all(
      [USDT, DAI].map(async (token) => {
        await token.mint(owner.address, (200e18).toString());
        await token.connect(owner).approve(vault.address, MAX_UINT256);
        await token.connect(investmentManager).approve(vault.address, MAX_UINT256);
      })
    );

    const tokenizer = await setupController(
      vault,
      owner,
      owner,
      'OwnableFixedSetPoolTokenizer',
      strategy.address,
      PairTS,
      (100e18).toString(),
      [USDT.address, DAI.address],
      [(100e18).toString(), (100e18).toString()],
      owner.address
    );

    await tokenizer.connect(owner).authorizePoolInvestmentManager(DAI.address, investmentManager.address);

    poolId = await tokenizer.poolId();
  });

  describe('invest', () => {
    context('when the sender is an allowed manager', () => {
      context('when trying to invest less than the vault balance', () => {
        const amount = BigNumber.from((10e18).toString());

        it('transfers the requested token from the vault to the investment manager', async () => {
          const previousVaultBalance = await DAI.balanceOf(vault.address);
          const previousManagerBalance = await DAI.balanceOf(investmentManager.address);

          await vault.connect(investmentManager).investPoolBalance(poolId, DAI.address, amount);

          const currentVaultBalance = await DAI.balanceOf(vault.address);
          expect(currentVaultBalance).to.equal(previousVaultBalance.sub(amount));

          const currentManagerBalance = await DAI.balanceOf(investmentManager.address);
          expect(currentManagerBalance).to.equal(previousManagerBalance.add(amount));
        });

        it('does not affect other vault tokens', async () => {
          const previousVaultBalance = await USDT.balanceOf(vault.address);
          const previousManagerBalance = await USDT.balanceOf(investmentManager.address);

          await vault.connect(investmentManager).investPoolBalance(poolId, DAI.address, amount);

          const currentVaultBalance = await USDT.balanceOf(vault.address);
          expect(currentVaultBalance).to.equal(previousVaultBalance);

          const currentManagerBalance = await USDT.balanceOf(investmentManager.address);
          expect(currentManagerBalance).to.equal(previousManagerBalance);
        });

        it('does not affect the balance of the pools', async () => {
          const tokenAddresses = [DAI.address, USDT.address];
          const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

          await vault.connect(investmentManager).investPoolBalance(poolId, DAI.address, amount);

          const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
          expect(currentBalanceDAI).to.equal(previousBalanceDAI);
          expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
        });
      });

      context('when trying to invest more than the vault balance', () => {
        const amount = BigNumber.from((101e18).toString());

        it('reverts', async () => {
          await expect(
            vault.connect(investmentManager).investPoolBalance(poolId, DAI.address, amount)
          ).to.be.revertedWith('ERR_SUB_UNDERFLOW');
        });
      });
    });

    context('when the sender is not an allowed manager', () => {
      it('reverts', async () => {
        await expect(vault.investPoolBalance(poolId, DAI.address, 0)).to.be.revertedWith(
          'SENDER_NOT_INVESTMENT_MANAGER'
        );
      });
    });
  });

  describe('divest', () => {
    context('when the sender is an allowed manager', () => {
      context('when trying to divest less than the invested balance', () => {
        const investedAmount = BigNumber.from((75e18).toString());
        const amount = investedAmount.div(2);

        beforeEach('invest', async () => {
          await vault.connect(investmentManager).investPoolBalance(poolId, DAI.address, investedAmount);
        });

        it('transfers the requested token from the manager to the vault', async () => {
          const previousVaultBalance = await DAI.balanceOf(vault.address);
          const previousManagerBalance = await DAI.balanceOf(investmentManager.address);

          await vault.connect(investmentManager).divestPoolBalance(poolId, DAI.address, amount);

          const currentVaultBalance = await DAI.balanceOf(vault.address);
          expect(currentVaultBalance).to.equal(previousVaultBalance.add(amount));

          const currentManagerBalance = await DAI.balanceOf(investmentManager.address);
          expect(currentManagerBalance).to.equal(previousManagerBalance.sub(amount));
        });

        it('does not affect other vault tokens', async () => {
          const previousVaultBalance = await USDT.balanceOf(vault.address);
          const previousManagerBalance = await USDT.balanceOf(investmentManager.address);

          await vault.connect(investmentManager).divestPoolBalance(poolId, DAI.address, amount);

          const currentVaultBalance = await USDT.balanceOf(vault.address);
          expect(currentVaultBalance).to.equal(previousVaultBalance);

          const currentManagerBalance = await USDT.balanceOf(investmentManager.address);
          expect(currentManagerBalance).to.equal(previousManagerBalance);
        });

        it('does not affect the balance of the pools', async () => {
          const tokenAddresses = [DAI.address, USDT.address];
          const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

          await vault.connect(investmentManager).divestPoolBalance(poolId, DAI.address, amount);

          const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
          expect(currentBalanceDAI).to.equal(previousBalanceDAI);
          expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
        });
      });

      context('when trying to divest more than the invested balance', () => {
        it('reverts', async () => {
          await expect(vault.connect(investmentManager).divestPoolBalance(poolId, DAI.address, 1)).to.be.revertedWith(
            'ERC20: transfer amount exceeds balance'
          );
        });
      });
    });

    context('when the sender is not an allowed manager', () => {
      it('reverts', async () => {
        await expect(vault.divestPoolBalance(poolId, DAI.address, 0)).to.be.revertedWith(
          'SENDER_NOT_INVESTMENT_MANAGER'
        );
      });
    });
  });

  describe('update', () => {
    context('when the sender is an allowed manager', () => {
      const investedAmount = BigNumber.from((10e18).toString());

      beforeEach('invest', async () => {
        await vault.connect(investmentManager).investPoolBalance(poolId, DAI.address, investedAmount);
      });

      context('without gains or losses', () => {
        const amount = investedAmount;

        it('reverts', async () => {
          await expect(vault.connect(investmentManager).updateInvested(poolId, DAI.address, amount)).to.be.revertedWith(
            'INVESTMENT_ALREADY_UP_TO_DATE'
          );
        });
      });

      context('with gains', () => {
        const amount = investedAmount.add(1);

        it('does not affect token balances', async () => {
          const previousVaultBalanceDAI = await DAI.balanceOf(vault.address);
          const previousManagerBalanceDAI = await DAI.balanceOf(investmentManager.address);
          const previousVaultBalanceUSDT = await USDT.balanceOf(vault.address);
          const previousManagerBalanceUSDT = await USDT.balanceOf(investmentManager.address);

          await vault.connect(investmentManager).updateInvested(poolId, DAI.address, amount);

          const currentVaultBalanceDAI = await DAI.balanceOf(vault.address);
          expect(currentVaultBalanceDAI).to.equal(previousVaultBalanceDAI);

          const currentManagerBalanceDAI = await DAI.balanceOf(investmentManager.address);
          expect(currentManagerBalanceDAI).to.equal(previousManagerBalanceDAI);

          const currentVaultBalanceUSDT = await USDT.balanceOf(vault.address);
          expect(currentVaultBalanceUSDT).to.equal(previousVaultBalanceUSDT);

          const currentManagerBalanceUSDT = await USDT.balanceOf(investmentManager.address);
          expect(currentManagerBalanceUSDT).to.equal(previousManagerBalanceUSDT);
        });

        it('updates the balance of the pool', async () => {
          const tokenAddresses = [DAI.address, USDT.address];
          const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

          await vault.connect(investmentManager).updateInvested(poolId, DAI.address, amount);

          const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
          expect(currentBalanceDAI).to.equal(previousBalanceDAI.add(1));
          expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
        });
      });

      context('with losses', () => {
        const amount = investedAmount.sub(1);

        it('does not affect token balances', async () => {
          const previousVaultBalanceDAI = await DAI.balanceOf(vault.address);
          const previousManagerBalanceDAI = await DAI.balanceOf(investmentManager.address);
          const previousVaultBalanceUSDT = await USDT.balanceOf(vault.address);
          const previousManagerBalanceUSDT = await USDT.balanceOf(investmentManager.address);

          await vault.connect(investmentManager).updateInvested(poolId, DAI.address, amount);

          const currentVaultBalanceDAI = await DAI.balanceOf(vault.address);
          expect(currentVaultBalanceDAI).to.equal(previousVaultBalanceDAI);

          const currentManagerBalanceDAI = await DAI.balanceOf(investmentManager.address);
          expect(currentManagerBalanceDAI).to.equal(previousManagerBalanceDAI);

          const currentVaultBalanceUSDT = await USDT.balanceOf(vault.address);
          expect(currentVaultBalanceUSDT).to.equal(previousVaultBalanceUSDT);

          const currentManagerBalanceUSDT = await USDT.balanceOf(investmentManager.address);
          expect(currentManagerBalanceUSDT).to.equal(previousManagerBalanceUSDT);
        });

        it('updates the balance of the pool', async () => {
          const tokenAddresses = [DAI.address, USDT.address];
          const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

          await vault.connect(investmentManager).updateInvested(poolId, DAI.address, amount);

          const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
          expect(currentBalanceDAI).to.equal(previousBalanceDAI.sub(1));
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
