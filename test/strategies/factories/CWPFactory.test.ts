import { ethers } from 'hardhat';
import { expect } from 'chai';
import { ContractFactory, Contract } from 'ethers';
import { TokenList, deployTokens } from '../../helpers/tokens';
import * as expectEvent from '../../helpers/expectEvent';

describe('CWPFactory', function () {
  let cwpFactory: Contract;
  let CWPFactoryFactory: ContractFactory;
  let CWPTradingStrategyFactory: ContractFactory;
  let tokens: TokenList = {};

  beforeEach(async function () {
    CWPFactoryFactory = await ethers.getContractFactory('CWPFactory');
    CWPTradingStrategyFactory = await ethers.getContractFactory('CWPTradingStrategy');
    cwpFactory = await CWPFactoryFactory.deploy();
    tokens = await deployTokens(['DAI', 'MKR', 'SNX'], [18, 18, 18]);
  });

  it('emits an event that the strategy was created', async () => {
    const tokenAddresses = [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address];
    const weights = [(2e18).toString(), (8e18).toString(), (5e18).toString()];
    const swapFee = (0.05e18).toString();

    const receipt = await (await cwpFactory.create(tokenAddresses, weights, swapFee)).wait();
    const event = expectEvent.inReceipt(receipt, 'StrategyCreated');

    const strategy = CWPTradingStrategyFactory.attach(event.args.strategy);
    expect(await strategy.getTotalTokens()).to.equal(3);
  });

  it('doesnt emit an event when a duplicated strategy is created', async () => {
    const tokenAddresses = [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address];
    const weights = [(2e18).toString(), (8e18).toString(), (5e18).toString()];
    const swapFee = (0.05e18).toString();

    let receipt = await (await cwpFactory.create(tokenAddresses, weights, swapFee)).wait();
    expectEvent.inReceipt(receipt, 'StrategyCreated');

    receipt = await (await cwpFactory.create(tokenAddresses, weights, swapFee)).wait();
    expect(receipt.events).to.be.empty;
  });
});
