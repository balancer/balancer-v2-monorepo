import { ethers } from 'hardhat';
import { expect } from 'chai';
import { ContractFactory, Contract } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';

describe('FlattenedTradingStrategy', function () {
  let poolId: string;
  let strategy: Contract;
  let traderAddress: string;
  let tokens: string[];

  const AMP = (7.6e18).toString();
  const SWAP_FEE = (0.05e18).toString(); // fee: 0.05%

  const testFlattenedTradingStrategy = (isAmpMutable: boolean, isSwapFeeMutable: boolean) => {
    beforeEach('deploy strategy', async function () {
      poolId = ethers.utils.id('Test');
      traderAddress = '0x0000000000000000000000000000000000000001';
      tokens = ['0x0000000000000000000000000000000000000002', '0x0000000000000000000000000000000000000003'];

      const StableStrategyFactory: ContractFactory = await ethers.getContractFactory('FlattenedTradingStrategy');

      strategy = await StableStrategyFactory.deploy(isAmpMutable, AMP, isSwapFeeMutable, SWAP_FEE);
      await strategy.deployed();
    });

    describe('initialization', () => {
      it('creates the strategy correctly', async () => {
        const currentAmp = await strategy.getAmp();
        expect(currentAmp).to.equal(AMP);

        const currentSwapFee = await strategy.getSwapFee();
        expect(currentSwapFee).to.equal(SWAP_FEE);
      });
    });

    describe('all balances validation', () => {
      it('should validate correctly two tokens', async () => {
        const result = await strategy.quoteOutGivenIn(
          {
            poolId,
            from: traderAddress,
            to: traderAddress,
            tokenIn: tokens[0],
            tokenOut: tokens[1],
            amountIn: (4.3579e18).toString(), //4.14 / (1 - fee)
            userData: '0x',
          },
          [(108.6e18).toString(), (42.482e18).toString()],
          0,
          1
        );
        expect(result).to.be.at.least((3.7928e18).toString());
      });

      it('should validate correctly three tokens', async () => {
        const result = await strategy.quoteOutGivenIn(
          {
            poolId,
            from: traderAddress,
            to: traderAddress,
            tokenIn: tokens[0],
            tokenOut: tokens[1],
            amountIn: '105263157900000000000', //100 / (1 - fee)
            userData: '0x',
          },
          ['76090948022791367352564021', '153330925159873', '142105440540871'],
          0,
          1
        );
        expect(result).to.be.at.least('100888873');
      });
    });

    describe('set amp', () => {
      const NEW_AMP = (1e18).toString();

      if (isAmpMutable) {
        it('supports changing amp', async () => {
          const receipt = await (await strategy.setAmp(NEW_AMP)).wait();
          expectEvent.inReceipt(receipt, 'AmpSet', { amp: NEW_AMP });

          const currentAmp = await strategy.getAmp();
          expect(currentAmp).to.equal(NEW_AMP);
        });
      } else {
        it('does not support changing amp', async () => {
          await expect(strategy.setAmp(NEW_AMP)).to.be.revertedWith('Amp is not mutable');
        });
      }
    });

    describe('set swap fee', () => {
      const NEW_SWAP_FEE = (0.02e18).toString();

      if (isSwapFeeMutable) {
        it('supports changing swap fee', async () => {
          const receipt = await (await strategy.setSwapFee(NEW_SWAP_FEE)).wait();
          expectEvent.inReceipt(receipt, 'SwapFeeSet', { swapFee: NEW_SWAP_FEE });

          const currentSwapFee = await strategy.getSwapFee();
          expect(currentSwapFee).to.equal(NEW_SWAP_FEE);
        });
      } else {
        it('does not support changing swap fee', async () => {
          await expect(strategy.setSwapFee(NEW_SWAP_FEE)).to.be.revertedWith('Swap fee is not mutable');
        });
      }
    });
  };

  context('when amp is mutable', () => {
    const isAmpMutable = true;

    context('when the swap fee is mutable', () => {
      const isSwapFeeMutable = true;

      testFlattenedTradingStrategy(isAmpMutable, isSwapFeeMutable);
    });

    context('when the swap fee is immutable', () => {
      const isSwapFeeMutable = false;

      testFlattenedTradingStrategy(isAmpMutable, isSwapFeeMutable);
    });
  });

  context('when amp is immutable', () => {
    const isAmpMutable = false;

    context('when the swap fee is mutable', () => {
      const isSwapFeeMutable = true;

      testFlattenedTradingStrategy(isAmpMutable, isSwapFeeMutable);
    });

    context('when the swap fee is immutable', () => {
      const isSwapFeeMutable = false;

      testFlattenedTradingStrategy(isAmpMutable, isSwapFeeMutable);
    });
  });
});
