import { ethers } from '@nomiclabs/buidler';
import { expect } from 'chai';
import { ContractFactory, Contract } from 'ethers';

describe('ConstantSumProdStrategy', function () {
  let poolID: string;
  let strategy: Contract;

  beforeEach(async function () {
    poolID = ethers.utils.id('Test');

    const ConstantSumProdStrategyFactory: ContractFactory = await ethers.getContractFactory('ConstantSumProdStrategy');

    strategy = await ConstantSumProdStrategyFactory.deploy(100);
    await strategy.deployed();
  });

  describe('All balances validation', () => {
    it('should validate correctly two tokens', async () => {
      const result = await strategy.validateAll(
        poolID,
        [(82.57e18).toString(), (82.57e18).toString()],
        [(87.6e18).toString(), (77.6e18).toString()]
      );
      expect(result).to.be.true;
    });
    it('should validate correctly three tokens', async () => {
      const result = await strategy.validateAll(
        poolID,
        ['76090948022791367352564021', '153330925159873', '142105440540871'],
        ['76091048022791367352564021', '153330824271000', '142105440540871']
      );
      expect(result).to.be.true;
    });
  });
});
