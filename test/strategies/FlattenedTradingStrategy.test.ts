import { ethers } from 'hardhat';
import { expect } from 'chai';
import { ContractFactory, Contract } from 'ethers';

describe('FlattenedTradingStrategy', function () {
  let poolId: string;
  let strategy: Contract;
  let traderAddress: string;
  let tokens: string[];

  const AMP = (7.6e18).toString();
  const SWAP_FEE = (0.05e18).toString(); //fee: 0.05%

  beforeEach(async function () {
    poolId = ethers.utils.id('Test');
    traderAddress = '0x0000000000000000000000000000000000000001';
    tokens = ['0x0000000000000000000000000000000000000002', '0x0000000000000000000000000000000000000003'];

    const StableStrategyFactory: ContractFactory = await ethers.getContractFactory('FlattenedTradingStrategy');
    strategy = await StableStrategyFactory.deploy([false, AMP], [false, SWAP_FEE]);
    await strategy.deployed();
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
});
