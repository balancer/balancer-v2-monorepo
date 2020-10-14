import { ethers } from '@nomiclabs/buidler';
import { expect } from 'chai';
import { ContractFactory, Contract } from 'ethers';

describe('ConstantWeightedProdStrategy', function () {
  let twoTokensStrategy: Contract;
  let threeTokensStrategy: Contract;

  beforeEach(async function () {
    const ConstantWeightedProdStrategyFactory: ContractFactory = await ethers.getContractFactory(
      'ConstantWeightedProdStrategy'
    );

    twoTokensStrategy = await ConstantWeightedProdStrategyFactory.deploy([(0.8e18).toString(), (0.2e18).toString()]);
    await twoTokensStrategy.deployed();
    threeTokensStrategy = await ConstantWeightedProdStrategyFactory.deploy([
      (0.4e18).toString(),
      (0.4e18).toString(),
      (0.2e18).toString(),
    ]);
    await threeTokensStrategy.deployed();
  });

  describe('Pair balances validation', () => {
    it('should validate correctly two tokens', async () => {
      const result = await twoTokensStrategy.validatePair(
        0,
        1,
        (100e18).toString(),
        (200e18).toString(),
        (15e18).toString(),
        (85.64935e18).toString()
      );
      expect(result).to.be.true;
    });
    it('should validate correctly three tokens', async () => {
      const result = await threeTokensStrategy.validatePair(
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
  describe('All balances validation', () => {
    it('should validate correctly two tokens', async () => {
      const result = await twoTokensStrategy.validateAll(
        [(100e18).toString(), (200e18).toString()],
        [(115e18).toString(), (114.35065e18).toString()]
      );
      expect(result).to.be.true;
    });
    it('should validate correctly three tokens', async () => {
      const result = await threeTokensStrategy.validateAll(
        [(100e18).toString(), (200e18).toString(), (300e18).toString()],
        [(115e18).toString(), (173.91304348e18).toString(), (300e18).toString()]
      );
      expect(result).to.be.true;
    });
  });
});
