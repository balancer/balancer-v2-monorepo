import { ethers } from '@nomiclabs/buidler';
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
  ].slice(0, num);
};

describe('ConstantWeightedProdStrategy', function () {
  let poolID: string;
  let strategy: Contract;
  let ConstantWeightedProdStrategyFactory: ContractFactory;

  beforeEach(async function () {
    poolID = ethers.utils.id('Test');
    ConstantWeightedProdStrategyFactory = await ethers.getContractFactory('ConstantWeightedProdStrategy');
  });

  describe('TS Creation', () => {
    it('Creates correctly TS', async () => {
      strategy = await ConstantWeightedProdStrategyFactory.deploy(
        generateAddressArray(2),
        [(2e18).toString(), (8e18).toString()],
        2,
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

      strategy = await ConstantWeightedProdStrategyFactory.deploy(
        generateAddressArray(5),
        [(2.15e18).toString(), (24.3e18).toString(), (12.11e18).toString(), (2e18).toString(), (6e18).toString()],
        5,
        (0.05e18).toString()
      );
      expect(await strategy.getTotalTokens()).to.equal(5);
      expect(await strategy.getWeight('0x0000000000000000000000000000000000000001')).to.equal((2.15e18).toString());
      expect(await strategy.getWeight('0x0000000000000000000000000000000000000005')).to.equal((6e18).toString());
      await expect(strategy.getWeight('0x0000000000000000000000000000000000000006')).to.be.revertedWith(
        'ERR_INVALID_TOKEN'
      );

      strategy = await ConstantWeightedProdStrategyFactory.deploy(
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
        16,
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
        ConstantWeightedProdStrategyFactory.deploy(generateAddressArray(2), [0, 8], 2, (0.05e18).toString())
      ).to.be.revertedWith('ERR_MIN_WEIGHT');
    });
    it('Fails creating below MIN TOKENS', async () => {
      await expect(
        ConstantWeightedProdStrategyFactory.deploy(generateAddressArray(1), [8], 1, (0.05e18).toString())
      ).to.be.revertedWith('ERR_MIN_TOKENS');
    });
    it('Fails creating above MAX TOKENS', async () => {
      await expect(
        ConstantWeightedProdStrategyFactory.deploy(
          generateAddressArray(16),
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
          17,
          (0.05e18).toString()
        ) //fee: 5%
      ).to.be.revertedWith('ERR_MAX_TOKENS');
    });
  });

  describe('Pair balances validation', () => {
    it('Validates correctly two tokens', async () => {
      //weights: [8, 2]
      const tokens = generateAddressArray(2);
      strategy = await ConstantWeightedProdStrategyFactory.deploy(
        tokens,
        [(8e18).toString(), (2e18).toString()],
        2,
        (0.05e18).toString()
      ); //fee: 5%
      await strategy.deployed();
      const result = await strategy.validatePair(
        poolID,
        tokens[0],
        tokens[1],
        (100e18).toString(),
        (200e18).toString(),
        (15e18 / (1 - 0.05)).toString(), //15e18 + fee
        (85.64935e18).toString()
      );
      expect(result[0]).to.be.true;
    });
    it('Validates correctly three tokens', async () => {
      //weights: [4, 4, 2]
      const tokens = generateAddressArray(3);
      strategy = await ConstantWeightedProdStrategyFactory.deploy(
        tokens,
        [(4e18).toString(), (4e18).toString(), (2e18).toString()],
        3,
        (0.05e18).toString()
      ); //fee: 5%
      await strategy.deployed();
      const result = await strategy.validatePair(
        poolID,
        tokens[0],
        tokens[1],
        (100e18).toString(),
        (200e18).toString(),
        (15e18 / (1 - 0.05)).toString(), //15e18 + fee
        (26.08695652e18).toString()
      );
      expect(result[0]).to.be.true;
    });
  });
});
