import { ethers } from '@nomiclabs/buidler';
import { Contract, Signer } from 'ethers';
import { TokenList, deployTokens, mintTokens } from './helpers/tokens';
import { deploy } from '../scripts/helpers/deploy';
import { getDiffsAndSwaps } from '../scripts/helpers/trading';
import { expectBalanceChange } from './helpers/tokenBalance';
import { setupPool } from '../scripts/helpers/pools';

describe('TradingEngine', () => {
  let controller: Signer;
  let trader: Signer;

  let vault: Contract;
  let tradingEngine: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, controller, trader] = await ethers.getSigners();
  });

  beforeEach('deploy vault', async () => {
    vault = await deploy('Vault');
    tradingEngine = await deploy('TradingEngine', vault.address);
    tokens = await deployTokens(['DAI', 'BAT', 'ANT', 'SNX', 'MKR']);
  });

  describe('swap', () => {
    const totalPools = 5;

    let pools: Array<string> = [];

    beforeEach('setup pools & mint tokens', async () => {
      pools = [];

      // Mint and approve controller liquidity
      await Promise.all(
        ['DAI', 'BAT', 'ANT', 'SNX', 'MKR'].map(async (symbol) => mintTokens(tokens, symbol, controller, 100e18))
      );

      for (let poolIdIdx = 0; poolIdIdx < totalPools; ++poolIdIdx) {
        // Create even pools with all tokens, initial balance of 1e18 for each
        const poolId = await setupPool(vault, tokens, controller, [
          ['DAI', 20],
          ['BAT', 20],
          ['ANT', 20],
          ['SNX', 20],
          ['MKR', 20],
        ]);

        pools.push(poolId);
      }

      // Mint tokens for trader
      await tokens['DAI'].mint(await trader.getAddress(), (1e18).toString());
    });

    it('double pool DAI for MKR', async () => {
      // Move the first two pools to a different price point (DAI:MKR becomes 1:2) by withdrawing DAI
      await vault
        .connect(controller)
        .rebind(pools[0], tokens['DAI'].address, (0.5e18).toString(), (12.5e18).toString());
      await vault
        .connect(controller)
        .rebind(pools[1], tokens['DAI'].address, (0.5e18).toString(), (12.5e18).toString());

      const [diffs, swaps] = getDiffsAndSwaps(tokens, [
        { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'MKR' },
        { poolId: pools[1], tokenIn: 'DAI', tokenOut: 'MKR' },
      ]);

      const amounts = [600, 600];

      await expectBalanceChange(
        async () => {
          await tokens['DAI'].connect(trader).approve(tradingEngine.address, (100e18).toString());
          await tradingEngine
            .connect(trader)
            .swapExactAmountIn(
              tokens['DAI'].address,
              tokens['MKR'].address,
              2000,
              (0.6e18).toString(),
              diffs,
              swaps,
              amounts
            );
        },
        trader,
        tokens,
        { DAI: -1200, MKR: ['gte', 2000] }
      );
    });

    it('multihop DAI for MKR', async () => {
      // Move the first and second pools to a different price point (DAI:SNX becomes 1:2) by withdrawing DAI
      await vault.connect(controller).rebind(pools[0], tokens['DAI'].address, (0.5e18).toString(), (5e18).toString());
      await vault.connect(controller).rebind(pools[1], tokens['DAI'].address, (0.5e18).toString(), (5e18).toString());

      // Move the third pool to a different price point (SNX:BAT becomes 1:2) by withdrawing SNX
      await vault.connect(controller).rebind(pools[2], tokens['SNX'].address, (0.5e18).toString(), (5e18).toString());

      // Move the fourth pool to a different price point (BAT:MKR becomes 1:2) by withdrawing BAT
      await vault.connect(controller).rebind(pools[3], tokens['BAT'].address, (0.5e18).toString(), (5e18).toString());

      // Move the fifth pool to a different price point (DAI:MKR becomes 1:2) by withdrawing DAI
      await vault.connect(controller).rebind(pools[4], tokens['DAI'].address, (0.5e18).toString(), (5e18).toString());

      const [diffs, swaps] = getDiffsAndSwaps(tokens, [
        { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'SNX' },
        { poolId: pools[1], tokenIn: 'DAI', tokenOut: 'SNX' },
        { poolId: pools[2], tokenIn: 'SNX', tokenOut: 'BAT' },
        { poolId: pools[3], tokenIn: 'BAT', tokenOut: 'MKR' },
        { poolId: pools[4], tokenIn: 'DAI', tokenOut: 'MKR' },
      ]);

      // Put in 1800 DAI, 0 SNX (3rd value is ignored by engine regardless)
      const amounts = [600, 600, 0, 0, 600];

      await expectBalanceChange(
        async () => {
          await tokens['DAI'].connect(trader).approve(tradingEngine.address, (100e18).toString());
          await tradingEngine
            .connect(trader)
            .swapExactAmountIn(
              tokens['DAI'].address,
              tokens['MKR'].address,
              4600,
              (0.6e18).toString(),
              diffs,
              swaps,
              amounts
            );
        },
        trader,
        tokens,
        { DAI: -1800, MKR: ['gte', 4600] }
      );
    });
  });
});
