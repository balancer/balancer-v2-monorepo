import { ethers } from '@nomiclabs/buidler';
import { expect } from 'chai';
import { ContractFactory, Contract, Signer, ContractReceipt } from 'ethers';
import * as expectEvent from './helpers/expectEvent';
import { MAX_UINT256 } from './helpers/constants';

describe('Vault', () => {
  let controller: Signer;
  let trader: Signer;

  let VaultFactory: ContractFactory;
  let vault: Contract;

  let TestTokenFactory: ContractFactory;
  const tokens: { [symbol: string]: Contract } = {};

  async function deployToken(symbol: string, decimals?: number) {
    const token = await (await TestTokenFactory.deploy(symbol, symbol, decimals ?? 18)).deployed();
    tokens[symbol] = token;
  }

  before('setup', async () => {
    [, controller, trader] = await ethers.getSigners();

    VaultFactory = await ethers.getContractFactory('Vault');
    TestTokenFactory = await ethers.getContractFactory('TestToken');

    await deployToken('DAI');
    await deployToken('MKR');
  });

  beforeEach('deploy vault', async () => {
    vault = await (await VaultFactory.deploy()).deployed();
  });

  describe('pool management', () => {
    let poolId: string;

    beforeEach('add pool', async () => {
      poolId = ethers.utils.id('Test');
      await vault.connect(controller).newPool(poolId);
    });

    it('has the correct controller', async () => {
      expect(await vault.getController(poolId)).to.equal(await controller.getAddress());
    });
  });

  describe('batch swap', () => {
    const totalPools = 5;

    beforeEach('setup pools & mint tokens', async () => {
      // Mint and approve controller liquidity
      await Promise.all(
        ['DAI', 'MKR'].map(async (token) => {
          await tokens[token].mint(await controller.getAddress(), (100e18).toString());
          await tokens[token].connect(controller).approve(vault.address, MAX_UINT256);
        })
      );

      for (let poolIdIdx = 0; poolIdIdx < totalPools; ++poolIdIdx) {
        const poolId: string = ethers.utils.id('batch' + poolIdIdx);

        const receipt: ContractReceipt = await (await vault.connect(controller).newPool(poolId)).wait();
        expectEvent.inReceipt(receipt, 'PoolCreated', { poolId });

        // 50-50 DAI-MKR pool with 1e18 tokens in each
        await vault.connect(controller).bind(poolId, tokens['DAI'].address, (1e18).toString(), (1e18).toString());
        await vault.connect(controller).bind(poolId, tokens['MKR'].address, (1e18).toString(), (1e18).toString());
      }

      // Mint tokens for trader
      await tokens['DAI'].mint(await trader.getAddress(), (1e18).toString());
      await tokens['MKR'].mint(await trader.getAddress(), (1e18).toString());
    });

    it('single pair single pool swap', async () => {
      // Trade 1e18 MKR for 0.5e18 DAI

      const diffs = [
        {
          token: tokens['DAI'].address,
          vaultDelta: 0,
        },
        {
          token: tokens['MKR'].address,
          vaultDelta: 0,
        },
      ];

      const swaps = [
        {
          poolId: ethers.utils.id('batch0'),
          tokenA: { tokenDiffIndex: 0, balance: (0.51e18).toString() }, // Math isn't 100% accurate
          tokenB: { tokenDiffIndex: 1, balance: (2e18).toString() },
        },
      ];

      // Send tokens & swap - would normally happen in the same tx
      await tokens['MKR'].connect(trader).transfer(vault.address, (1e18).toString());
      await vault.connect(trader).batchSwap(diffs, swaps);
    });

    it('single pair multi pool (batch) swap', async () => {
      // Trade 0.68e18 MKR for 0.5e18 DAI

      const diffs = [
        {
          token: tokens['DAI'].address,
          vaultDelta: 0,
        },
        {
          token: tokens['MKR'].address,
          vaultDelta: 0,
        },
      ];

      const swaps = [
        {
          poolId: ethers.utils.id('batch0'),
          tokenA: { tokenDiffIndex: 0, balance: (0.75e18).toString() },
          tokenB: { tokenDiffIndex: 1, balance: (1.34e18).toString() },
        },
        {
          poolId: ethers.utils.id('batch1'),
          tokenA: { tokenDiffIndex: 0, balance: (0.75e18).toString() },
          tokenB: { tokenDiffIndex: 1, balance: (1.34e18).toString() },
        },
      ];

      // Send tokens & swap - would normally happen in the same tx
      await tokens['MKR'].connect(trader).transfer(vault.address, (0.68e18).toString());
      await vault.connect(trader).batchSwap(diffs, swaps);
    });
  });

  describe('flash swap arbitrage', () => {
    const totalPools = 5;

    beforeEach('setup unbalanced pools & mint tokens', async () => {
      // Mint and approve controller liquidity
      await Promise.all(
        ['DAI', 'MKR'].map(async (token) => {
          await tokens[token].mint(await controller.getAddress(), (100e18).toString());
          await tokens[token].connect(controller).approve(vault.address, MAX_UINT256);
        })
      );

      for (let poolIdIdx = 0; poolIdIdx < totalPools; ++poolIdIdx) {
        const poolId = ethers.utils.id('unbalanced' + poolIdIdx);
        const receipt: ContractReceipt = await (await vault.connect(controller).newPool(poolId)).wait();
        expectEvent.inReceipt(receipt, 'PoolCreated', { poolId });

        // 50-50 DAI-MKR pool with a 1 to 4 DAI:MKR ratio
        await vault.connect(controller).bind(poolId, tokens['DAI'].address, (0.5e18).toString(), (1e18).toString());
        await vault.connect(controller).bind(poolId, tokens['MKR'].address, (2e18).toString(), (1e18).toString());
      }

      // Move the first pool to a difference price point (1 to 10 DAI:MKR) by withdrawing DAI
      const firstPoolId = ethers.utils.id('unbalanced0');
      await vault
        .connect(controller)
        .rebind(firstPoolId, tokens['DAI'].address, (0.2e18).toString(), (1e18).toString());
    });

    it('works', async () => {
      const diffs = [
        {
          token: tokens['DAI'].address,
          vaultDelta: 0,
        },
        {
          token: tokens['MKR'].address,
          vaultDelta: 0,
        },
      ];

      // Move the unbalanced pool to a 1:7 ratio (this is not the optimal ratio)

      const swaps = [
        {
          poolId: ethers.utils.id('unbalanced0'),
          tokenA: { tokenDiffIndex: 0, balance: (0.2391e18).toString() },
          tokenB: { tokenDiffIndex: 1, balance: (1.673e18).toString() },
        },
        {
          poolId: ethers.utils.id('unbalanced1'),
          tokenA: { tokenDiffIndex: 0, balance: (0.4902e18).toString() },
          tokenB: { tokenDiffIndex: 1, balance: (2.04e18).toString() },
        },
        {
          poolId: ethers.utils.id('unbalanced2'),
          tokenA: { tokenDiffIndex: 0, balance: (0.4902e18).toString() },
          tokenB: { tokenDiffIndex: 1, balance: (2.04e18).toString() },
        },
        {
          poolId: ethers.utils.id('unbalanced3'),
          tokenA: { tokenDiffIndex: 0, balance: (0.4902e18).toString() },
          tokenB: { tokenDiffIndex: 1, balance: (2.04e18).toString() },
        },
        {
          poolId: ethers.utils.id('unbalanced4'),
          tokenA: { tokenDiffIndex: 0, balance: (0.4902e18).toString() },
          tokenB: { tokenDiffIndex: 1, balance: (2.04e18).toString() },
        },
      ];

      const preDAI = await tokens['DAI'].balanceOf(await trader.getAddress());
      const preMKR = await tokens['MKR'].balanceOf(await trader.getAddress());

      // Swap
      await vault.connect(trader).batchSwap(diffs, swaps);

      const postDAI = await tokens['DAI'].balanceOf(await trader.getAddress());
      const postMKR = await tokens['MKR'].balanceOf(await trader.getAddress());

      // The trader got MKR without spending DAI
      expect(postMKR).to.be.gt(preMKR);
      expect(postDAI).to.be.gte(preDAI);
    });
  });
});
