import { ethers } from '@nomiclabs/buidler';
import { expect } from 'chai';
import { ContractFactory, Contract } from 'ethers';

describe('ConstantSumProdStrategy', function () {
  let poolID: string;
  let strategy: Contract;

  beforeEach(async function () {
    poolID = ethers.utils.id('Test');

    const ConstantSumProdStrategyFactory: ContractFactory = await ethers.getContractFactory('ConstantSumProdStrategy');

    strategy = await ConstantSumProdStrategyFactory.deploy(100, (0.05e18).toString()); //fee: 0.05%
    await strategy.deployed();
  });

  describe('All balances validation', () => {
    it('should validate correctly two tokens', async () => {
      const result = await strategy.validateTuple(
        poolID,
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
        0,
        1,
        [(82.57e18).toString(), (82.57e18).toString()],
        (5.294737e18).toString(), //5.03 / (1 - fee)
        (4.97e18).toString()
      );
      expect(result[0]).to.be.true;
    });
    it('should validate correctly three tokens', async () => {
      const result = await strategy.validateTuple(
        poolID,
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
        0,
        1,
        ['76090948022791367352564021', '153330925159873', '142105440540871'],
        '105263157900000000000', //100 / (1 - fee)
        '100888873'
      );
      expect(result[0]).to.be.true;
    });
  });
});
