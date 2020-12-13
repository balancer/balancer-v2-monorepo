import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../scripts/helpers/deploy';
import { PairTS } from '../../scripts/helpers/pools';
import { deployTokens, TokenList } from '../helpers/tokens';
import { MAX_UINT256 } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { setupController } from '../../scripts/helpers/controllers';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';

describe('ProtocolSwapFee', function () {
  let admin: SignerWithAddress;
  let lp: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let strategy: Contract;
  let tokens: TokenList = {};

  let tokenizer: Contract;
  let poolId: string;

  const initialBPT = (100e18).toString();

  before(async function () {
    [, admin, lp, other] = await ethers.getSigners();
  });

  beforeEach(async function () {
    vault = await deploy('Vault', { from: admin, args: [admin.address] });

    tokens = await deployTokens(['DAI', 'MKR'], [18, 18]);
    await Promise.all(
      ['DAI', 'MKR'].map(async (token) => {
        await tokens[token].mint(lp.address, (100e18).toString());
        await tokens[token].connect(lp).approve(vault.address, MAX_UINT256);

        await tokens[token].mint(other.address, (100e18).toString());
        await tokens[token].connect(other).approve(vault.address, MAX_UINT256);
      })
    );

    strategy = await deploy('MockTradingStrategy', { args: [] });

    tokenizer = await setupController(
      vault,
      admin,
      lp,
      'FixedSetPoolTokenizer',
      strategy.address,
      PairTS,
      initialBPT,
      [tokens.DAI.address, tokens.MKR.address],
      [(1e18).toString(), (2e18).toString()]
    );

    poolId = await tokenizer.poolId();
  });

  context('paying protocol fees', () => {
    beforeEach(async () => {
      //Set protocol swap fee in Vault
      await vault.connect(admin).setProtocolFeeCollector(admin.address);
      await vault.connect(admin).setProtocolSwapFee((0.1e18).toString()); //10%
    });

    it.skip('pays in all tokens', async () => {
      //Swap fees accumulated are 0.1 DAI and 0.1 MKR
      await strategy.setAccSwapFees([(0.1e18).toString(), (0.1e18).toString()]);

      //Pay protocol swap fees (0.01 DAI and 0.01 MKR)
      await tokenizer.connect(other).payProtocolFees();

      //Real balances will change from [1, 2] to [0.99, 1.99]
      expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
        BigNumber.from((0.99e18).toString()),
        BigNumber.from((1.99e18).toString()),
      ]);
    });

    it('pays in one token', async () => {
      //Swap fees accumulated is 0.1 DAI
      await strategy.setAccSwapFees([(0.1e18).toString(), 0]);

      //Pay protocol swap fees (0.01 DAI and 0 MKR)
      await tokenizer.connect(other).payProtocolFees();

      //Real balances will change from [1, 2] to [0.99, 2]
      expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
        BigNumber.from((0.99e18).toString()),
        BigNumber.from((2e18).toString()),
      ]);
    });

    it('pays nothing after reset', async () => {
      //Swap fees accumulated is 0.1 DAI
      await strategy.setAccSwapFees([(0.1e18).toString(), 0]);

      //Swap fees are reseted
      await strategy.resetAccSwapFees([]);

      //Pay protocol swap fees
      await tokenizer.connect(other).payProtocolFees();

      //Real balances will not change
      expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
        BigNumber.from((1e18).toString()),
        BigNumber.from((2e18).toString()),
      ]);
    });

    it('fails when no enough funds', async () => {
      //Swap fees accumulated is 20 DAI
      await strategy.setAccSwapFees([(20e18).toString(), 0]);

      //Reverts when paying protocol swap fees (2 DAI and 0 MKR)
      expect(tokenizer.connect(other).payProtocolFees()).to.be.revertedWith(
        'Not enough cash to pay for protocol swap fee'
      );
    });

    context('joining', () => {
      beforeEach(async () => {
        //Swap fees accumulated are 0.1 DAI and 0.1 MKR
        await strategy.setAccSwapFees([(0.1e18).toString(), (0.1e18).toString()]);
      });
      it('send less tokens', async () => {
        const previousBPT = await tokenizer.balanceOf(lp.address);

        //Swap fees accumulated are 0.1 DAI and 0.1 MKR
        //Real balances will change from [1, 2] to [0.99, 1.99]
        // To get 10% of the current BPT, an LP needs to supply 10% of the current token balance
        await expectBalanceChange(
          () =>
            tokenizer
              .connect(lp)
              .joinPool((10e18).toString(), [(0.099e18).toString(), (0.199e18).toString()], true, lp.address),

          lp,
          tokens,
          { DAI: -0.099e18, MKR: -0.199e18 }
        );

        const newBPT = await tokenizer.balanceOf(lp.address);
        expect(newBPT.sub(previousBPT)).to.equal((10e18).toString());
      });

      it('after paying protocol fees', async () => {
        const previousBPT = await tokenizer.balanceOf(lp.address);

        //Pay protocol swap fees (0.01 DAI and 0 MKR)
        await tokenizer.connect(other).payProtocolFees();

        //Real balances will change from [1, 2] to [0.99, 1.99]
        // To get 10% of the current BPT, an LP needs to supply 10% of the current token balance
        await expectBalanceChange(
          () =>
            tokenizer
              .connect(lp)
              .joinPool((10e18).toString(), [(0.099e18).toString(), (0.199e18).toString()], true, lp.address),

          lp,
          tokens,
          { DAI: -0.099e18, MKR: -0.199e18 }
        );

        const newBPT = await tokenizer.balanceOf(lp.address);
        expect(newBPT.sub(previousBPT)).to.equal((10e18).toString());
      });
    });
    context('exiting', () => {
      beforeEach(async () => {
        //Swap fees accumulated are 0.1 DAI and 0.1 MKR
        await strategy.setAccSwapFees([(0.1e18).toString(), (0.1e18).toString()]);
      });
      it('a bit less tokens are pushed', async () => {
        const previousBPT = await tokenizer.balanceOf(lp.address);

        //Swap fees accumulated are 0.1 DAI and 0.1 MKR
        //Real balances will change from [1, 2] to [0.99, 1.99]
        // By returning 10% of the current BPT, an LP gets in return 10% of the current token balance
        await expectBalanceChange(
          () => tokenizer.connect(lp).exitPool((10e18).toString(), [0, 0], true, lp.address),
          lp,
          tokens,
          {
            DAI: 0.099e18,
            MKR: 0.199e18,
          }
        );
        const newBPT = await tokenizer.balanceOf(lp.address);
        expect(newBPT.sub(previousBPT)).to.equal((-10e18).toString());
      });
      context('with protocol withdraw fees', async () => {
        const protocolWithdrawFee = 0.01;

        beforeEach(async () => {
          await vault.connect(admin).setProtocolWithdrawFee(toFixedPoint(protocolWithdrawFee));
        });

        //Swap fees accumulated are 0.1 DAI and 0.1 MKR
        //Real balances will change from [1, 2] to [0.99, 1.99]
        // By returning 10% of the current BPT, an LP gets in return 10% of the current token balance
        it('tokens minus fee are pushed', async () => {
          await expectBalanceChange(
            () => tokenizer.connect(lp).exitPool((10e18).toString(), [0, 0], true, lp.address),
            lp,
            tokens,
            {
              DAI: 0.099e18 * (1 - protocolWithdrawFee),
              MKR: 0.199e18 * (1 - protocolWithdrawFee),
            }
          );
        });
      });
    });
  });
});
