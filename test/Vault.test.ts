import { ethers } from '@nomiclabs/buidler';
import { expect } from 'chai';
import { Contract, Signer, ContractReceipt } from 'ethers';
import * as expectEvent from './helpers/expectEvent';
import { MAX_UINT256 } from './helpers/constants';
import { expectBalanceChange } from './helpers/tokenBalance';
import { TokenList, deployTokens } from './helpers/tokens';
import { deploy } from '../scripts/helpers/deploy';

describe('Vault', () => {
  let controller: Signer;
  let trader: Signer;

  let vault: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, controller, trader] = await ethers.getSigners();
  });

  beforeEach('deploy vault', async () => {
    vault = await deploy('Vault');
    tokens = await deployTokens(['DAI', 'MKR']);
  });

  describe('pool management', () => {
    let poolId: string;

    beforeEach('add pool', async () => {
      poolId = ethers.utils.id('Test');
      const receipt: ContractReceipt = await (await vault.connect(controller).newPool(poolId)).wait();
      expectEvent.inReceipt(receipt, 'PoolCreated');
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
        const poolId = ethers.utils.id('batch' + poolIdIdx);

        const receipt: ContractReceipt = await (await vault.connect(controller).newPool(poolId)).wait();
        expectEvent.inReceipt(receipt, 'PoolCreated', { poolId });

        //Set fee to 5%
        await vault.connect(controller).setSwapFee(poolId, (5e16).toString());

        // 50-50 DAI-MKR pool with 1e18 tokens in each
        await vault.connect(controller).bind(poolId, tokens.DAI.address, (1e18).toString(), (1e18).toString());
        await vault.connect(controller).bind(poolId, tokens.MKR.address, (1e18).toString(), (1e18).toString());
      }

      // Mint tokens for trader
      await tokens.DAI.mint(await trader.getAddress(), (1e18).toString());
      await tokens.MKR.mint(await trader.getAddress(), (2e18).toString());
    });

    it('single pair single pool swap', async () => {
      // Trade 1e18 MKR for 0.5e18 DAI
      const diffs = [
        {
          token: tokens.DAI.address,
          vaultDelta: 0,
        },
        {
          token: tokens.MKR.address,
          vaultDelta: 0,
        },
      ];

      const fee = 1e18 * 0.05; //5% fee

      const swaps = [
        {
          poolId: ethers.utils.id('batch0'),
          tokenA: { tokenDiffIndex: 1, balance: (2e18 + fee).toString() }, //Math isn't 100% accurate
          tokenB: { tokenDiffIndex: 0, balance: (0.51e18).toString() },
        },
      ];

      await expectBalanceChange(
        async () => {
          // Send tokens & swap - would normally happen in the same tx
          await tokens.MKR.connect(trader).transfer(vault.address, (1e18 + fee).toString());
          await vault.connect(trader).batchSwap(diffs, swaps, await trader.getAddress());
        },
        trader,
        tokens,
        { DAI: 0.49e18, MKR: -1e18 - fee }
      );
    });

    it('single pair multi pool (batch) swap', async () => {
      // Trade 0.68e18 MKR for 0.5e18 DAI
      const diffs = [
        {
          token: tokens.DAI.address,
          vaultDelta: 0,
        },
        {
          token: tokens.MKR.address,
          vaultDelta: 0,
        },
      ];

      const fee = 0.34e18 * 0.05; //5% fee

      const swaps = [
        {
          poolId: ethers.utils.id('batch0'),
          tokenA: { tokenDiffIndex: 1, balance: (1.34e18 + fee).toString() },
          tokenB: { tokenDiffIndex: 0, balance: (0.75e18).toString() },
        },
        {
          poolId: ethers.utils.id('batch1'),
          tokenA: { tokenDiffIndex: 1, balance: (1.34e18 + fee).toString() },
          tokenB: { tokenDiffIndex: 0, balance: (0.75e18).toString() },
        },
      ];

      await expectBalanceChange(
        async () => {
          // Send tokens & swap - would normally happen in the same tx
          await tokens.MKR.connect(trader).transfer(vault.address, (0.68e18 + 2 * fee).toString());
          await vault.connect(trader).batchSwap(diffs, swaps, await trader.getAddress());
        },
        trader,
        tokens,
        { DAI: 0.5e18, MKR: -0.68e18 - 2 * fee }
      );
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
        await vault.connect(controller).bind(poolId, tokens.DAI.address, (0.5e18).toString(), (1e18).toString());
        await vault.connect(controller).bind(poolId, tokens.MKR.address, (2e18).toString(), (1e18).toString());
      }

      // Move the first pool to a difference price point (1 to 10 DAI:MKR) by withdrawing DAI
      const firstPoolId = ethers.utils.id('unbalanced0');
      await vault.connect(controller).rebind(firstPoolId, tokens.DAI.address, (0.2e18).toString(), (1e18).toString());
    });

    it('works', async () => {
      const diffs = [
        {
          token: tokens.DAI.address,
          vaultDelta: 0,
        },
        {
          token: tokens.MKR.address,
          vaultDelta: 0,
        },
      ];

      // Move the unbalanced pool to a 1:7 ratio (this is not the optimal ratio)

      // Has min fee: 0.000001%
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

      await expectBalanceChange(
        async () => {
          // The trader gets MKR without spending DAI
          await vault.connect(trader).batchSwap(diffs, swaps, await trader.getAddress());
        },
        trader,
        tokens,
        { DAI: ['gt', 0], MKR: ['gte', 0] }
      );
    });
  });
});
