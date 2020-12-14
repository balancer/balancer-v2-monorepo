import { ethers } from 'hardhat';
import { expect } from 'chai';
import { ContractFactory, Contract, BigNumber } from 'ethers';
import { ZERO_ADDRESS } from '../helpers/constants';
import { deployTokens, TokenList } from '../helpers/tokens';

const generateAddressArray = (tokens: TokenList, num: number): string[] => {
  return Object.values(tokens)
    .map((token: Contract) => token.address)
    .slice(0, num);
};

describe('CWPTradingStrategy', function () {
  let poolId: string;
  let strategy: Contract;
  let CWPTradingStrategyFactory: ContractFactory;
  let traderAddress: string;
  let tokens: TokenList = {};

  beforeEach(async function () {
    tokens = await deployTokens(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'M', 'N', 'L', 'O', 'P', 'Q'],
      [18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18]
    );
    poolId = ethers.utils.id('Test');
    traderAddress = '0x0000000000000000000000000000000000000001';
    CWPTradingStrategyFactory = await ethers.getContractFactory('CWPTradingStrategy');
  });

  describe('TS Creation', () => {
    it('Creates correctly TS', async () => {
      strategy = await CWPTradingStrategyFactory.deploy(
        { isMutable: false, tokens: generateAddressArray(tokens, 2), weights: [(2e18).toString(), (8e18).toString()] },
        { isMutable: false, value: (0.05e18).toString() }
      );
      expect(await strategy.getTotalTokens()).to.equal(2);
      expect(await strategy.getWeight(tokens.A.address)).to.equal((2e18).toString());
      expect(await strategy.getWeight(tokens.B.address)).to.equal((8e18).toString());
      await expect(strategy.getWeight(tokens.C.address)).to.be.revertedWith('ERR_INVALID_TOKEN');
      await expect(strategy.getWeight(ZERO_ADDRESS)).to.be.revertedWith('ERR_INVALID_ADDRESS');

      strategy = await CWPTradingStrategyFactory.deploy(
        {
          isMutable: false,
          tokens: generateAddressArray(tokens, 5),
          weights: [
            (2.15e18).toString(),
            (24.3e18).toString(),
            (12.11e18).toString(),
            (2e18).toString(),
            (6e18).toString(),
          ],
        },
        { isMutable: false, value: (0.05e18).toString() }
      );
      expect(await strategy.getTotalTokens()).to.equal(5);
      expect(await strategy.getWeight(tokens.A.address)).to.equal((2.15e18).toString());
      expect(await strategy.getWeight(tokens.E.address)).to.equal((6e18).toString());
      await expect(strategy.getWeight(tokens.F.address)).to.be.revertedWith('ERR_INVALID_TOKEN');

      strategy = await CWPTradingStrategyFactory.deploy(
        {
          isMutable: false,
          tokens: generateAddressArray(tokens, 16),
          weights: [
            (1e18).toString(),
            (2e18).toString(),
            (3e18).toString(),
            (4e18).toString(),
            (5e18).toString(),
            (6e18).toString(),
            (7e18).toString(),
            (8e18).toString(),
            (9e18).toString(),
            (10e18).toString(),
            (11e18).toString(),
            (12e18).toString(),
            (13e18).toString(),
            (14e18).toString(),
            (15e18).toString(),
            (16e18).toString(),
          ],
        },
        { isMutable: false, value: (0.05e18).toString() }
      );
      expect(await strategy.getTotalTokens()).to.equal(16);
      expect(await strategy.getWeight(tokens.A.address)).to.equal((1e18).toString());
      expect(await strategy.getWeight(tokens.P.address)).to.equal((16e18).toString());
      await expect(strategy.getWeight(tokens.Q.address)).to.be.revertedWith('ERR_INVALID_TOKEN');
    });
    it('Fails creating below MIN WEIGHT', async () => {
      await expect(
        CWPTradingStrategyFactory.deploy(
          { isMutable: false, tokens: generateAddressArray(tokens, 2), weights: [0, 8] },
          { isMutable: false, value: (0.05e18).toString() }
        )
      ).to.be.revertedWith('ERR_MIN_WEIGHT');
    });
    it('Fails creating below MIN TOKENS', async () => {
      await expect(
        CWPTradingStrategyFactory.deploy(
          { isMutable: false, tokens: generateAddressArray(tokens, 1), weights: [8] },
          { isMutable: false, value: (0.05e18).toString() }
        )
      ).to.be.revertedWith('ERR_MIN_TOKENS');
    });
    it('Fails creating above MAX TOKENS', async () => {
      await expect(
        CWPTradingStrategyFactory.deploy(
          {
            isMutable: false,
            tokens: generateAddressArray(tokens, 17),
            weights: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
          },
          { isMutable: false, value: (0.05e18).toString() }
        ) //fee: 5%
      ).to.be.revertedWith('ERR_MAX_TOKENS');
    });
  });

  describe('Pair balances validation', () => {
    it('Validates correctly two tokens', async () => {
      //weights: [8, 2]
      strategy = await CWPTradingStrategyFactory.deploy(
        { isMutable: false, tokens: generateAddressArray(tokens, 2), weights: [(8e18).toString(), (2e18).toString()] },
        { isMutable: false, value: (0.05e18).toString() }
      ); //fee: 5%
      await strategy.deployed();
      const result = await strategy.quoteOutGivenIn(
        {
          poolId,
          from: traderAddress,
          to: traderAddress,
          tokenIn: tokens.A.address,
          tokenOut: tokens.B.address,
          amountIn: (15e18 / (1 - 0.05)).toString(), //15e18 + fee
          userData: '0x',
        },
        (100e18).toString(),
        (200e18).toString()
      );
      expect(result).to.be.at.least((85.64935e18).toString());
    });
    it('Validates correctly three tokens', async () => {
      //weights: [4, 4, 2]
      strategy = await CWPTradingStrategyFactory.deploy(
        {
          itsMutable: false,
          tokens: generateAddressArray(tokens, 3),
          weights: [(4e18).toString(), (4e18).toString(), (2e18).toString()],
        },
        { isMutable: false, value: (0.05e18).toString() }
      ); //fee: 5%
      await strategy.deployed();
      const result = await strategy.quoteOutGivenIn(
        {
          poolId,
          from: traderAddress,
          to: traderAddress,
          tokenIn: tokens.A.address,
          tokenOut: tokens.B.address,
          amountIn: (15e18 / (1 - 0.05)).toString(), //15e18 + fee
          userData: '0x',
        },
        (100e18).toString(),
        (200e18).toString()
      );
      expect(result).to.be.at.least((26.08695652e18).toString());
    });
  });
});
