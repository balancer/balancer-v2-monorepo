import { ethers } from 'hardhat';
import { expect } from 'chai';
import { ContractFactory, Contract } from 'ethers';

describe('StableStrategy', function () {
  let poolId: string;
  let strategy: Contract;

  beforeEach(async function () {
    poolId = ethers.utils.id('Test');

    const StableStrategyFactory: ContractFactory = await ethers.getContractFactory('StableStrategy');

    strategy = await StableStrategyFactory.deploy((7.6e18).toString(), (0.05e18).toString()); //fee: 0.05%
    await strategy.deployed();
  });

  describe('All balances validation', () => {
    it('should validate correctly two tokens', async () => {
      const result = await strategy.validateTuple(
        {
          poolId,
          tokenIn: '0x0000000000000000000000000000000000000001',
          tokenOut: '0x0000000000000000000000000000000000000002',
          amountIn: (4.3579e18).toString(), //4.14 / (1 - fee)
          amountOut: (3.7928e18).toString(),
        },
        [(108.6e18).toString(), (42.482e18).toString()],
        0,
        1
      );
      expect(result[0]).to.be.true;
    });
    it('should validate correctly three tokens', async () => {
      const result = await strategy.validateTuple(
        {
          poolId,
          tokenIn: '0x0000000000000000000000000000000000000001',
          tokenOut: '0x0000000000000000000000000000000000000002',
          amountIn: '105263157900000000000', //100 / (1 - fee)
          amountOut: '100888873',
        },
        ['76090948022791367352564021', '153330925159873', '142105440540871'],
        0,
        1
      );
      expect(result[0]).to.be.true;
    });
  });
});
