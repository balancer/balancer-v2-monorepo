import { ethers } from '@nomiclabs/buidler';
import { expect } from 'chai';
import { ContractFactory, Contract } from 'ethers';

//Packs up to 16 weights in 32 bytes (16 bit per weight) in hexa format with 2 decimals.
//For example [2, 8] is packed into 0x00000000000000000000000000000000000000000000000000000000032000c8
const packWeights = (weights: number[]) => {
  const _weights =
    weights.length == 16 ? weights.reverse() : new Array(16 - weights.length).fill(0).concat(weights.reverse());
  return _weights.reduce(function (acc: string, weight: number) {
    if (weight >= 100) {
      throw 'Invalid weight';
    }
    const s = '000' + parseInt(weight.toFixed(2).replace('.', '')).toString(16);
    return acc + s.substr(s.length - 4);
  }, '0x');
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
      strategy = await ConstantWeightedProdStrategyFactory.deploy(packWeights([2, 8]), 2);
      expect(await strategy.getTotalTokens()).to.equal(2);
      expect(await strategy.getWeight(0)).to.equal('200');
      expect(await strategy.getWeight(1)).to.equal('800');
      await expect(strategy.getWeight(2)).to.be.revertedWith('ERR_INVALID_INDEX');

      strategy = await ConstantWeightedProdStrategyFactory.deploy(packWeights([2.15, 24.3, 12.11, 2, 6]), 5);
      expect(await strategy.getTotalTokens()).to.equal(5);
      expect(await strategy.getWeight(0)).to.equal('215');
      expect(await strategy.getWeight(4)).to.equal('600');
      await expect(strategy.getWeight(5)).to.be.revertedWith('ERR_INVALID_INDEX');

      strategy = await ConstantWeightedProdStrategyFactory.deploy(
        packWeights([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
        16
      );
      expect(await strategy.getTotalTokens()).to.equal(16);
      expect(await strategy.getWeight(0)).to.equal('100');
      expect(await strategy.getWeight(15)).to.equal('1600');
      await expect(strategy.getWeight(16)).to.be.revertedWith('ERR_INVALID_INDEX');
    });
    it('Fails creating below MIN WEIGHT', async () => {
      await expect(ConstantWeightedProdStrategyFactory.deploy(packWeights([0, 8]), 2)).to.be.revertedWith(
        'ERR_MIN_WEIGHT'
      );
    });
    it('Fails creating below MIN TOKENS', async () => {
      await expect(ConstantWeightedProdStrategyFactory.deploy(packWeights([8]), 1)).to.be.revertedWith(
        'ERR_MIN_TOKENS'
      );
    });
    it('Fails creating above MAX TOKENS', async () => {
      await expect(
        ConstantWeightedProdStrategyFactory.deploy(
          packWeights([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
          17
        )
      ).to.be.revertedWith('ERR_MAX_TOKENS');
    });
  });

  describe('Pair balances validation', () => {
    it('Validates correctly two tokens', async () => {
      //weights: [8, 2]
      strategy = await ConstantWeightedProdStrategyFactory.deploy(packWeights([8, 2]), 2);
      await strategy.deployed();
      const result = await strategy.validatePair(
        poolID,
        0,
        1,
        (100e18).toString(),
        (200e18).toString(),
        (15e18).toString(),
        (85.64935e18).toString()
      );
      expect(result).to.be.true;
    });
    it('Validates correctly three tokens', async () => {
      //weights: [4, 4, 2]
      strategy = await ConstantWeightedProdStrategyFactory.deploy(packWeights([4, 4, 2]), 3);
      await strategy.deployed();
      const result = await strategy.validatePair(
        poolID,
        0,
        1,
        (100e18).toString(),
        (200e18).toString(),
        (15e18).toString(),
        (26.08695652e18).toString()
      );
      expect(result).to.be.true;
    });
  });
});
