import { ethers } from 'hardhat';
import { expect } from 'chai';
import { ContractFactory, Contract } from 'ethers';

const generateAddressArray = (num: number): string[] => {
  return [
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000003',
    '0x0000000000000000000000000000000000000004',
    '0x0000000000000000000000000000000000000005',
    '0x0000000000000000000000000000000000000006',
    '0x0000000000000000000000000000000000000007',
    '0x0000000000000000000000000000000000000008',
    '0x0000000000000000000000000000000000000009',
    '0x0000000000000000000000000000000000000010',
    '0x0000000000000000000000000000000000000011',
    '0x0000000000000000000000000000000000000012',
    '0x0000000000000000000000000000000000000013',
    '0x0000000000000000000000000000000000000014',
    '0x0000000000000000000000000000000000000015',
    '0x0000000000000000000000000000000000000016',
    '0x0000000000000000000000000000000000000017',
  ].slice(0, num);
};

describe('CWPTradingStrategy', function () {
  let poolId: string;
  let strategy: Contract;
  let CWPTradingStrategyFactory: ContractFactory;
  let traderAddress: string;

  beforeEach(async function () {
    poolId = ethers.utils.id('Test');
    traderAddress = '0x0000000000000000000000000000000000000001';
    CWPTradingStrategyFactory = await ethers.getContractFactory('CWPTradingStrategy');
  });

  describe('TS Creation', () => {
    it('Creates correctly TS', async () => {
      strategy = await CWPTradingStrategyFactory.deploy(
        generateAddressArray(2),
        [(2e18).toString(), (8e18).toString()],
        (0.05e18).toString()
      );
      expect(await strategy.getTotalTokens()).to.equal(2);
      expect(await strategy.getWeight('0x0000000000000000000000000000000000000001')).to.equal((2e18).toString());
      expect(await strategy.getWeight('0x0000000000000000000000000000000000000002')).to.equal((8e18).toString());
      await expect(strategy.getWeight('0x0000000000000000000000000000000000000003')).to.be.revertedWith(
        'ERR_INVALID_TOKEN'
      );
      await expect(strategy.getWeight('0x0000000000000000000000000000000000000000')).to.be.revertedWith(
        'ERR_INVALID_ADDRESS'
      );

      strategy = await CWPTradingStrategyFactory.deploy(
        generateAddressArray(5),
        [(2.15e18).toString(), (24.3e18).toString(), (12.11e18).toString(), (2e18).toString(), (6e18).toString()],
        (0.05e18).toString()
      );
      expect(await strategy.getTotalTokens()).to.equal(5);
      expect(await strategy.getWeight('0x0000000000000000000000000000000000000001')).to.equal((2.15e18).toString());
      expect(await strategy.getWeight('0x0000000000000000000000000000000000000005')).to.equal((6e18).toString());
      await expect(strategy.getWeight('0x0000000000000000000000000000000000000006')).to.be.revertedWith(
        'ERR_INVALID_TOKEN'
      );

      strategy = await CWPTradingStrategyFactory.deploy(
        generateAddressArray(16),
        [
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
        (0.05e18).toString()
      );
      expect(await strategy.getTotalTokens()).to.equal(16);
      expect(await strategy.getWeight('0x0000000000000000000000000000000000000001')).to.equal((1e18).toString());
      expect(await strategy.getWeight('0x0000000000000000000000000000000000000016')).to.equal((16e18).toString());
      await expect(strategy.getWeight('0x0000000000000000000000000000000000000017')).to.be.revertedWith(
        'ERR_INVALID_TOKEN'
      );
    });
    it('Fails creating below MIN WEIGHT', async () => {
      await expect(
        CWPTradingStrategyFactory.deploy(generateAddressArray(2), [0, 8], (0.05e18).toString())
      ).to.be.revertedWith('ERR_MIN_WEIGHT');
    });
    it('Fails creating below MIN TOKENS', async () => {
      await expect(
        CWPTradingStrategyFactory.deploy(generateAddressArray(1), [8], (0.05e18).toString())
      ).to.be.revertedWith('ERR_MIN_TOKENS');
    });
    it('Fails creating above MAX TOKENS', async () => {
      await expect(
        CWPTradingStrategyFactory.deploy(
          generateAddressArray(17),
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
          (0.05e18).toString()
        ) //fee: 5%
      ).to.be.revertedWith('ERR_MAX_TOKENS');
    });
  });

  describe('Pair balances validation', () => {
    it('Validates correctly two tokens', async () => {
      //weights: [8, 2]
      const tokens = generateAddressArray(2);
      strategy = await CWPTradingStrategyFactory.deploy(
        tokens,
        [(8e18).toString(), (2e18).toString()],
        (0.05e18).toString()
      ); //fee: 5%
      await strategy.deployed();
      const result = await strategy.quoteOutGivenIn(
        {
          poolId,
          from: traderAddress,
          to: traderAddress,
          tokenIn: tokens[0],
          tokenOut: tokens[1],
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
      const tokens = generateAddressArray(3);
      strategy = await CWPTradingStrategyFactory.deploy(
        tokens,
        [(4e18).toString(), (4e18).toString(), (2e18).toString()],
        (0.05e18).toString()
      ); //fee: 5%
      await strategy.deployed();
      const result = await strategy.quoteOutGivenIn(
        {
          poolId,
          from: traderAddress,
          to: traderAddress,
          tokenIn: tokens[0],
          tokenOut: tokens[1],
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
