import { ethers } from '@nomiclabs/buidler';
import { expect } from 'chai';
import { ContractFactory, Contract, Signer, BigNumber, ContractReceipt } from 'ethers';
import * as expectEvent from './helpers/expectEvent';
import { MAX_UINT256 } from './helpers/constants';

describe('TradingEngine', () => {
  let controller: Signer;
  let trader: Signer;

  let VaultFactory: ContractFactory;
  let vault: Contract;

  let TradingEngineFactory: ContractFactory;
  let tradingEngine: Contract;

  let TestTokenFactory: ContractFactory;
  let tokens: { [symbol: string]: Contract } = {};

  async function deployToken(symbol: string, decimals?: Number) {
    const token = await (await TestTokenFactory.deploy(symbol, symbol, decimals ?? 18)).deployed();
    tokens[symbol] = token;
  }

  before('setup', async () => {
    [, controller, trader] = await ethers.getSigners();

    VaultFactory = await ethers.getContractFactory('Vault');
    TestTokenFactory = await ethers.getContractFactory('TestToken');
    TradingEngineFactory = await ethers.getContractFactory('TradingEngine');

    await deployToken('DAI');
    await deployToken('BAT');
    await deployToken('ANT');
    await deployToken('SNX');
    await deployToken('MKR');
  });

  beforeEach('deploy vault', async () => {
    vault = await (await VaultFactory.deploy()).deployed();
    tradingEngine = await (await TradingEngineFactory.deploy(vault.address)).deployed();
  });

  describe('swap', () => {
    const totalPools = 5;

    beforeEach('setup pools & mint tokens', async () => {
      // Mint and approve controller liquidity
      await Promise.all(['DAI', 'BAT', 'ANT', 'SNX', 'MKR'].map(async token => {
        await tokens[token].mint(await controller.getAddress(), 100e18.toString());
        await tokens[token].connect(controller).approve(vault.address, MAX_UINT256);
      }));

      for (let poolId = 0; poolId < totalPools; ++poolId) {
        const receipt: ContractReceipt = await (await vault.connect(controller).newPool()).wait();
        expectEvent.inReceipt(receipt, 'PoolCreated', { poolId });

        // Create even pools with all tokens, initial balance of 20e18 for each
        await vault.connect(controller).bind(poolId, tokens['DAI'].address, 20e18.toString(), 1e18.toString());
        await vault.connect(controller).bind(poolId, tokens['BAT'].address, 20e18.toString(), 1e18.toString());
        await vault.connect(controller).bind(poolId, tokens['ANT'].address, 20e18.toString(), 1e18.toString());
        await vault.connect(controller).bind(poolId, tokens['SNX'].address, 20e18.toString(), 1e18.toString());
        await vault.connect(controller).bind(poolId, tokens['MKR'].address, 20e18.toString(), 1e18.toString());
      }

      // Mint tokens for trader
      await tokens['DAI'].mint(await trader.getAddress(), 1e18.toString());
    });

    it('double pool DAI for MKR', async () => {
      // Move the first two pools to a different price point (DAI:MKR becomes 1:2) by withdrawing DAI
      await vault.connect(controller).rebind(0, tokens['DAI'].address, 10e18.toString(), 1e18.toString());
      await vault.connect(controller).rebind(1, tokens['DAI'].address, 10e18.toString(), 1e18.toString());

      const diffs = [{
          token: tokens['DAI'].address,
          vaultDelta: 0
      }, {
          token: tokens['MKR'].address,
          vaultDelta: 0
      }];

      const swaps = [
        {
          poolId: 0,
          tokenA: { tokenPoolIndex: 0, tokenDiffIndex: 0, balance: 0 },
          tokenB: { tokenPoolIndex: 4, tokenDiffIndex: 1, balance: 0 },
        },
        {
          poolId: 1,
          tokenA: { tokenPoolIndex: 0, tokenDiffIndex: 0, balance: 0 },
          tokenB: { tokenPoolIndex: 4, tokenDiffIndex: 1, balance: 0 },
        },
      ];

      const amounts = [ 600, 600 ];

      const preDAI = await tokens['DAI'].balanceOf(await trader.getAddress());
      const preMKR = await tokens['MKR'].balanceOf(await trader.getAddress());

      await tokens['DAI'].connect(trader).approve(tradingEngine.address, 100e18.toString());
      await tradingEngine.connect(trader).swapExactAmountIn(
        tokens['DAI'].address,
        tokens['MKR'].address,
        2000,
        0.6e18.toString(),
        diffs,
        swaps,
        amounts
      );

      const postDAI = await tokens['DAI'].balanceOf(await trader.getAddress());
      const postMKR = await tokens['MKR'].balanceOf(await trader.getAddress());

      expect(postDAI).to.be.lt(preDAI);
      expect(postMKR).to.be.gte(preMKR.add(1000));
    });

    it('multihop DAI for MKR', async () => {
      // Move the first and second pools to a different price point (DAI:SNX becomes 1:2) by withdrawing DAI
      await vault.connect(controller).rebind(0, tokens['DAI'].address, 10e18.toString(), 1e18.toString());
      await vault.connect(controller).rebind(1, tokens['DAI'].address, 10e18.toString(), 1e18.toString());

      // Move the third pool to a different price point (SNX:BAT becomes 1:2) by withdrawing SNX
      await vault.connect(controller).rebind(2, tokens['SNX'].address, 10e18.toString(), 1e18.toString());

      // Move the fourth pool to a different price point (BAT:MKR becomes 1:2) by withdrawing BAT
      await vault.connect(controller).rebind(3, tokens['BAT'].address, 10e18.toString(), 1e18.toString());

      // Move the fifth pool to a different price point (DAI:MKR becomes 1:2) by withdrawing DAI
      await vault.connect(controller).rebind(4, tokens['DAI'].address, 10e18.toString(), 1e18.toString());

      const diffs = [{
        token: tokens['DAI'].address,
        vaultDelta: 0,
      }, {
        token: tokens['MKR'].address,
        vaultDelta: 0,
      }, {
        token: tokens['SNX'].address,
        vaultDelta: 0,
      }, {
        token: tokens['BAT'].address,
        vaultDelta: 0,
      }];

      const swaps = [
        { // DAI for SNX on pool 0
          poolId: 0,
          tokenA: { tokenPoolIndex: 0, tokenDiffIndex: 0, balance: 0 },
          tokenB: { tokenPoolIndex: 3, tokenDiffIndex: 2, balance: 0 },
        },
        { // DAI for SNX on pool 1
          poolId: 1,
          tokenA: { tokenPoolIndex: 0, tokenDiffIndex: 0, balance: 0 },
          tokenB: { tokenPoolIndex: 3, tokenDiffIndex: 2, balance: 0 },
        },
        { // SNX for BAT on pool 2
          poolId: 2,
          tokenA: { tokenPoolIndex: 3, tokenDiffIndex: 2, balance: 0 },
          tokenB: { tokenPoolIndex: 1, tokenDiffIndex: 3, balance: 0 },
        },
        { // BAT for MKR on pool 3
          poolId: 3,
          tokenA: { tokenPoolIndex: 1, tokenDiffIndex: 3, balance: 0 },
          tokenB: { tokenPoolIndex: 4, tokenDiffIndex: 1, balance: 0 },
        },
        { // DAI for MKR on pool 4
          poolId: 4,
          tokenA: { tokenPoolIndex: 0, tokenDiffIndex: 0, balance: 0 },
          tokenB: { tokenPoolIndex: 4, tokenDiffIndex: 1, balance: 0 },
        },
      ];

      // Put in 1200 DAI, 0 SNX (3rd value is ignored by engine regardless)
      const amounts = [ 600, 600, 0, 0, 600];

      const preDAI = await tokens['DAI'].balanceOf(await trader.getAddress());
      const preMKR = await tokens['MKR'].balanceOf(await trader.getAddress());

      await tokens['DAI'].connect(trader).approve(tradingEngine.address, 100e18.toString());
      await tradingEngine.connect(trader).swapExactAmountIn(
        tokens['DAI'].address,
        tokens['MKR'].address,
        4600,
        0.6e18.toString(),
        diffs,
        swaps,
        amounts
      );

      const postDAI = await tokens['DAI'].balanceOf(await trader.getAddress());
      const postMKR = await tokens['MKR'].balanceOf(await trader.getAddress());

      expect(postDAI).to.be.lt(preDAI);
      expect(postMKR).to.be.gte(preMKR.add(1000));
    });
  });
});
