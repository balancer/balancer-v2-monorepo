import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract, BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../helpers/constants';
import { deployTokens, mintTokens, TokenList } from '../helpers/tokens';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { deploy } from '../../scripts/helpers/deploy';
import * as expectEvent from '../helpers/expectEvent';
import { TupleTS } from '../../scripts/helpers/pools';

describe('InvestmentManager', function () {
  let poolId: string;
  let tokens: TokenList;
  let vault: Contract;

  let admin: SignerWithAddress;
  let pool: SignerWithAddress;
  let investmentManager: SignerWithAddress;
  let other: SignerWithAddress;

  before('deploy base contracts', async () => {
    [, admin, pool, investmentManager, other] = await ethers.getSigners();
  });

  beforeEach('set up investment manager', async () => {
    vault = await deploy('Vault', { args: [admin.address] });
    tokens = await deployTokens(['DAI', 'USDT'], [18, 18]);

    const receipt = await (await vault.newPool(pool.address, TupleTS)).wait();

    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    poolId = event.args.poolId;

    for (const symbol in tokens) {
      // Mint tokens for the pool to add liquidity with
      const amount = (200e18).toString();
      await mintTokens(tokens, symbol, pool, amount);
      await tokens[symbol].connect(pool).approve(vault.address, MAX_UINT256);

      await vault.connect(pool).addLiquidity(poolId, pool.address, [tokens[symbol].address], [amount], false);

      await tokens[symbol].connect(investmentManager).approve(vault.address, MAX_UINT256);
      await vault
        .connect(pool)
        .authorizePoolInvestmentManager(poolId, tokens[symbol].address, investmentManager.address);
    }
  });

  describe('invest', () => {
    context('when the sender is an allowed manager', () => {
      context('when trying to invest less than the vault balance', () => {
        const amount = BigNumber.from((10e18).toString());

        it('transfers only the requested token from the vault to the manager', async () => {
          await expectBalanceChange(
            () => vault.connect(investmentManager).investPoolBalance(poolId, tokens.DAI.address, amount),
            tokens,
            [
              { account: investmentManager, changes: { DAI: amount } },
              { account: vault, changes: { DAI: -amount } },
            ]
          );
        });

        it('does not affect the balance of the pools', async () => {
          const tokenAddresses = [tokens.DAI.address, tokens.USDT.address];
          const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

          await vault.connect(investmentManager).investPoolBalance(poolId, tokens.DAI.address, amount);

          const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
          expect(currentBalanceDAI).to.equal(previousBalanceDAI);
          expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
        });
      });

      context('when trying to invest more than the vault balance', () => {
        const amount = BigNumber.from((500e18).toString());

        it('reverts', async () => {
          await expect(
            vault.connect(investmentManager).investPoolBalance(poolId, tokens.DAI.address, amount)
          ).to.be.revertedWith('ERR_SUB_UNDERFLOW');
        });
      });
    });

    context('when the sender is not an allowed manager', () => {
      it('reverts', async () => {
        await expect(vault.connect(other).investPoolBalance(poolId, tokens.DAI.address, 0)).to.be.revertedWith(
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
          await vault.connect(investmentManager).investPoolBalance(poolId, tokens.DAI.address, investedAmount);
        });

        it('transfers only the requested token from the manager to the vault', async () => {
          await expectBalanceChange(
            () => vault.connect(investmentManager).divestPoolBalance(poolId, tokens.DAI.address, amount),
            tokens,
            [
              { account: investmentManager, changes: { DAI: -amount } },
              { account: vault, changes: { DAI: amount } },
            ]
          );
        });

        it('does not affect the balance of the pools', async () => {
          const tokenAddresses = [tokens.DAI.address, tokens.USDT.address];
          const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

          await vault.connect(investmentManager).divestPoolBalance(poolId, tokens.DAI.address, amount);

          const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
          expect(currentBalanceDAI).to.equal(previousBalanceDAI);
          expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
        });
      });

      context('when trying to divest more than the invested balance', () => {
        it('reverts', async () => {
          await expect(
            vault.connect(investmentManager).divestPoolBalance(poolId, tokens.DAI.address, 1)
          ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
        });
      });
    });

    context('when the sender is not an allowed manager', () => {
      it('reverts', async () => {
        await expect(vault.connect(other).divestPoolBalance(poolId, tokens.DAI.address, 0)).to.be.revertedWith(
          'SENDER_NOT_INVESTMENT_MANAGER'
        );
      });
    });
  });

  describe('update', () => {
    context('when the sender is an allowed manager', () => {
      const investedAmount = BigNumber.from((10e18).toString());

      beforeEach('invest', async () => {
        await vault.connect(investmentManager).investPoolBalance(poolId, tokens.DAI.address, investedAmount);
      });

      context('with gains', () => {
        const amount = investedAmount.add(1);

        it('does not affect token balances', async () => {
          await expectBalanceChange(
            () => vault.connect(investmentManager).updateInvested(poolId, tokens.DAI.address, amount),
            tokens,
            [{ account: investmentManager }, { account: vault }]
          );
        });

        it('updates the balance of the pool', async () => {
          const tokenAddresses = [tokens.DAI.address, tokens.USDT.address];
          const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

          await vault.connect(investmentManager).updateInvested(poolId, tokens.DAI.address, amount);

          const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
          expect(currentBalanceDAI).to.equal(previousBalanceDAI.add(1));
          expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
        });
      });

      context('with losses', () => {
        const amount = investedAmount.sub(1);

        it('does not affect token balances', async () => {
          await expectBalanceChange(
            () => vault.connect(investmentManager).updateInvested(poolId, tokens.DAI.address, amount),
            tokens,
            [{ account: investmentManager }, { account: vault }]
          );
        });

        it('updates the balance of the pool', async () => {
          const tokenAddresses = [tokens.DAI.address, tokens.USDT.address];
          const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

          await vault.connect(investmentManager).updateInvested(poolId, tokens.DAI.address, amount);

          const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
          expect(currentBalanceDAI).to.equal(previousBalanceDAI.sub(1));
          expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
        });
      });
    });

    context('when the sender is not an allowed manager', () => {
      it('reverts', async () => {
        await expect(vault.connect(other).updateInvested(poolId, tokens.DAI.address, 0)).to.be.revertedWith(
          'SENDER_NOT_INVESTMENT_MANAGER'
        );
      });
    });
  });
});
