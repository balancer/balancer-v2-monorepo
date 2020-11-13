import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract, ContractReceipt } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { MAX_UINT256 } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deployTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PairTS, setupPool } from '../../scripts/helpers/pools';

describe('Vault - swaps', () => {
  let controller: SignerWithAddress;
  let trader: SignerWithAddress;
  let creditor: SignerWithAddress;
  let traderAddress: string;

  let vault: Contract;
  let strategy: Contract;
  let tradeScript: Contract;
  let tokens: TokenList = {};
  let tokenAddresses: string[];

  before('setup', async () => {
    [, controller, trader, creditor] = await ethers.getSigners();
    traderAddress = await trader.getAddress();
  });

  beforeEach('deploy vault & tokens', async () => {
    vault = await deploy('Vault', { args: [] });
    tokens = await deployTokens(['DAI', 'MKR']);
    tokenAddresses = [tokens.DAI.address, tokens.MKR.address];
    strategy = await deploy('WeightedProdStrategy', {
      args: [[tokens.DAI.address, tokens.MKR.address], [(1e18).toString(), (1e18).toString()], 2, 0],
    });
    tradeScript = await deploy('MockTradeScript', { args: [] });
  });

  describe('pool management', () => {
    let poolId: string;

    beforeEach('add pool', async () => {
      poolId = await setupPool(vault, strategy, PairTS, tokens, controller, [
        ['DAI', (1e18).toString()],
        ['MKR', (1e18).toString()],
      ]);
    });

    it('has the correct controller', async () => {
      expect(await vault.getPoolController(poolId)).to.equal(controller.address);
    });
  });

  describe('batch swap', () => {
    const totalPools = 5;
    let poolIds: string[] = [];

    beforeEach('setup pools & mint tokens', async () => {
      // Mint and approve controller liquidity
      await Promise.all(
        ['DAI', 'MKR'].map(async (token) => {
          await tokens[token].mint(controller.address, (100e18).toString());
          await tokens[token].connect(controller).approve(vault.address, MAX_UINT256);
        })
      );

      poolIds = [];
      for (let poolIdIdx = 0; poolIdIdx < totalPools; ++poolIdIdx) {
        const strategy = await deploy('WeightedProdStrategy', {
          args: [
            [tokens.DAI.address, tokens.MKR.address],
            [(1e18).toString(), (1e18).toString()],
            2,
            (0.05e18).toString(),
          ],
        });

        poolIds.push(
          await setupPool(vault, strategy, PairTS, tokens, controller, [
            ['DAI', (1e18).toString()],
            ['MKR', (1e18).toString()],
          ])
        );
      }

      // Mint tokens for trader
      await tokens.DAI.mint(trader.address, (200e18).toString());
      await tokens.MKR.mint(trader.address, (200e18).toString());

      // Approve Vault by trader
      await tokens.DAI.connect(trader).approve(vault.address, MAX_UINT256);
      await tokens.MKR.connect(trader).approve(vault.address, MAX_UINT256);

      // Set Vault as trader operator
      await vault.connect(trader).authorizeOperator(tradeScript.address);
    });

    it('single pair single pool swap', async () => {
      // Trade 1e18 MKR for 0.5e18 DAI

      const fee = 1e18 * 0.05; //5% fee

      const swaps = [
        {
          poolId: poolIds[0],
          from: traderAddress,
          to: traderAddress,
          tokenIn: { tokenDiffIndex: 1, amount: (1e18 + fee).toString() }, //Math isn't 100% accurate
          tokenOut: { tokenDiffIndex: 0, amount: (0.49e18).toString() },
          userData: '0x',
        },
      ];

      await expectBalanceChange(
        async () => {
          await tradeScript.batchSwap(
            vault.address,
            ['0', (1e18 + fee).toString()],
            swaps,
            tokenAddresses,
            trader.address,
            trader.address,
            true
          );
        },
        trader,
        tokens,
        { DAI: 0.49e18, MKR: -1e18 - fee }
      );
    });

    it('single pair multi pool (batch) swap', async () => {
      // Trade 0.68e18 MKR for 0.5e18 DAI
      const fee = 0.34e18 * 0.05; //5% fee

      const swaps = [
        {
          poolId: poolIds[0],
          from: traderAddress,
          to: traderAddress,
          tokenIn: { tokenDiffIndex: 1, amount: (0.34e18 + fee).toString() },
          tokenOut: { tokenDiffIndex: 0, amount: (0.25e18).toString() },
          userData: '0x',
        },
        {
          poolId: poolIds[1],
          from: traderAddress,
          to: traderAddress,
          tokenIn: { tokenDiffIndex: 1, amount: (0.34e18 + fee).toString() },
          tokenOut: { tokenDiffIndex: 0, amount: (0.25e18).toString() },
          userData: '0x',
        },
      ];

      await expectBalanceChange(
        async () => {
          await tradeScript.batchSwap(
            vault.address,
            ['0', (0.68e18 + 2 * fee).toString()],
            swaps,
            tokenAddresses,
            trader.address,
            trader.address,
            true
          );
        },
        trader,
        tokens,
        { DAI: 0.5e18, MKR: -0.68e18 - 2 * fee }
      );
    });

    describe('input user balance', () => {
      it('fails if caller is not authorized', async () => {
        // Trade 1e18 MKR for 0.5e18 DAI
        const fee = 1e18 * 0.05; //5% fee

        const swaps = [
          {
            poolId: poolIds[0],
            from: traderAddress,
            to: traderAddress,
            tokenIn: { tokenDiffIndex: 1, amount: (1e18 + fee).toString() },
            tokenOut: { tokenDiffIndex: 0, amount: (0.49e18).toString() }, //Math isn't 100% accurate
            userData: '0x',
          },
        ];

        // Deposit MKR as user balance
        await vault.connect(trader).deposit(tokens.MKR.address, (1e18 + fee).toString(), trader.address);

        // Revoke trade script
        await vault.connect(trader).revokeOperator(tradeScript.address);

        await expect(
          tradeScript.batchSwap(vault.address, ['0', '0'], swaps, tokenAddresses, trader.address, trader.address, true)
        ).to.be.revertedWith('Caller is not operator');
      });

      it('withdraws from user balance if caller is authorized', async () => {
        // Trade 1e18 MKR for 0.5e18 DAI
        const fee = 1e18 * 0.05; //5% fee

        const swaps = [
          {
            poolId: poolIds[0],
            from: traderAddress,
            to: traderAddress,
            tokenIn: { tokenDiffIndex: 1, amount: (1e18 + fee).toString() },
            tokenOut: { tokenDiffIndex: 0, amount: (0.49e18).toString() }, //Math isn't 100% accurate
            userData: '0x',
          },
        ];

        // Deposit MKR as user balance
        await vault.connect(trader).deposit(tokens.MKR.address, (2e18).toString(), trader.address);

        await expectBalanceChange(
          async () =>
            tradeScript.batchSwap(
              vault.address,
              ['0', '0'],
              swaps,
              tokenAddresses,
              trader.address,
              trader.address,
              true
            ),
          trader,
          tokens,
          { DAI: 0.49e18 }
        );

        expect(await vault.getUserTokenBalance(trader.address, tokens.MKR.address)).to.equal(
          (2e18 - (1e18 + fee)).toString()
        );
        expect(await vault.getUserTokenBalance(trader.address, tokens.DAI.address)).to.equal(0);
      });

      it('only withdraws from user balance if funds are missing', async () => {
        // Trade 1e18 MKR for 0.5e18 DAI
        const fee = 1e18 * 0.05; //5% fee

        const swaps = [
          {
            poolId: poolIds[0],
            from: traderAddress,
            to: traderAddress,
            tokenIn: { tokenDiffIndex: 1, amount: (1e18 + fee).toString() },
            tokenOut: { tokenDiffIndex: 0, amount: (0.49e18).toString() }, //Math isn't 100% accurate
            userData: '0x',
          },
        ];

        // Deposit MKR as user balance
        await vault.connect(trader).deposit(tokens.MKR.address, (2e18).toString(), trader.address);

        await expectBalanceChange(
          async () =>
            tradeScript.batchSwap(
              vault.address,
              ['0', (1e18 + fee).toString()],
              swaps,
              tokenAddresses,
              trader.address,
              trader.address,
              true
            ),
          trader,
          tokens,
          { MKR: -1e18 - fee, DAI: 0.49e18 }
        );

        expect(await vault.getUserTokenBalance(trader.address, tokens.MKR.address)).to.equal((2e18).toString());
        expect(await vault.getUserTokenBalance(trader.address, tokens.DAI.address)).to.equal(0);
      });
    });

    describe('output user balance', () => {
      it('deposits to user balance if requested', async () => {
        // Trade 1e18 MKR for 0.5e18 DAI
        const fee = 1e18 * 0.05; //5% fee

        const swaps = [
          {
            poolId: poolIds[0],
            from: traderAddress,
            to: traderAddress,
            tokenIn: { tokenDiffIndex: 1, amount: (1e18 + fee).toString() },
            tokenOut: { tokenDiffIndex: 0, amount: (0.49e18).toString() }, //Math isn't 100% accurate
            userData: '0x',
          },
        ];

        await expectBalanceChange(
          async () =>
            tradeScript.batchSwap(
              vault.address,
              ['0', (1e18 + fee).toString()],
              swaps,
              tokenAddresses,
              trader.address,
              creditor.address,
              false
            ),
          trader,
          tokens,
          { MKR: -1e18 - fee }
        );

        expect(await vault.getUserTokenBalance(trader.address, tokens.DAI.address)).to.equal(0);
        expect(await vault.getUserTokenBalance(creditor.address, tokens.DAI.address)).to.equal((0.49e18).toString());
      });
    });
  });

  describe.skip('flash swap arbitrage', () => {
    const totalPools = 5;

    beforeEach('setup unbalanced pools & mint tokens', async () => {
      // Mint and approve controller liquidity
      await Promise.all(
        ['DAI', 'MKR'].map(async (token) => {
          await tokens[token].mint(controller.address, (100e18).toString());
          await tokens[token].connect(controller).approve(vault.address, MAX_UINT256);
        })
      );

      strategy = await deploy('WeightedProdStrategy', {
        args: [[tokens.DAI.address, tokens.MKR.address], [(1e18).toString(), (4e18).toString()], 2, 0],
      });
      // first curve is 1:10
      const curveFirst = await deploy('WeightedProdStrategy', {
        args: [[tokens.DAI.address, tokens.MKR.address], [(1e18).toString(), (10e18).toString()], 2, 0],
      });

      for (let poolIdIdx = 0; poolIdIdx < totalPools; ++poolIdIdx) {
        const c = poolIdIdx == 0 ? curveFirst.address : strategy.address;
        const poolId = ethers.utils.id('unbalanced' + poolIdIdx);
        const receipt: ContractReceipt = await (await vault.connect(controller).newPool(poolId, c, 0)).wait();
        expectEvent.inReceipt(receipt, 'PoolCreated', { poolId });

        // 50-50 DAI-MKR pool with a 1 to 4 DAI:MKR ratio
        await vault.connect(controller).bind(poolId, tokens.DAI.address, (1e18).toString());
        await vault.connect(controller).bind(poolId, tokens.MKR.address, (1e18).toString());
      }
    });

    it('works', async () => {
      // Move the unbalanced pool to a 1:7 ratio (this is not the optimal ratio)

      // Has min fee: 0.000001%
      const swaps = [
        // Withdraw 300 MKR in exchange for 36 DAI (buy at ~8)
        {
          poolId: ethers.utils.id('unbalanced0'),
          from: traderAddress,
          to: traderAddress,
          tokenIn: { tokenDiffIndex: 0, amount: (36e15).toString() },
          tokenOut: { tokenDiffIndex: 1, amount: (300e15).toString() },
          userData: '0x',
        },
        // Spend 40 MKR to get 9 DAI in each pool (sell at ~44)
        // A total 160 MKR out of 300 is spent (140 profit), and all 36 gained DAI are spent
        {
          poolId: ethers.utils.id('unbalanced1'),
          from: traderAddress,
          to: traderAddress,
          tokenIn: { tokenDiffIndex: 0, amount: (9e15).toString() },
          tokenOut: { tokenDiffIndex: 1, amount: (40e15).toString() },
          userData: '0x',
        },
        {
          poolId: ethers.utils.id('unbalanced2'),
          from: traderAddress,
          to: traderAddress,
          tokenIn: { tokenDiffIndex: 0, amount: (9e15).toString() },
          tokenOut: { tokenDiffIndex: 1, amount: (40e15).toString() },
          userData: '0x',
        },
        {
          poolId: ethers.utils.id('unbalanced3'),
          from: traderAddress,
          to: traderAddress,
          tokenIn: { tokenDiffIndex: 0, amount: (9e15).toString() },
          tokenOut: { tokenDiffIndex: 1, amount: (40e15).toString() },
          userData: '0x',
        },
        {
          poolId: ethers.utils.id('unbalanced4'),
          from: traderAddress,
          to: traderAddress,
          tokenIn: { tokenDiffIndex: 0, amount: (9e15).toString() },
          tokenOut: { tokenDiffIndex: 1, amount: (40e15).toString() },
          userData: '0x',
        },
      ];

      await expectBalanceChange(
        async () => {
          // The trader gets MKR without spending DAI
          await tradeScript.batchSwap(
            vault.address,
            [],
            [],
            swaps,
            tokenAddresses,
            trader.address,
            trader.address,
            true
          );
        },
        trader,
        tokens,
        { MKR: (140e15).toString() }
      );
    });
  });
});
