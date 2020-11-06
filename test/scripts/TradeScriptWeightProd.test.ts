import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { getDiffsSwapsAndAmounts } from '../../scripts/helpers/trading';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { PairTS, setupPool } from '../../scripts/helpers/pools';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../helpers/constants';

describe('TradeScript - WeightProduct', () => {
  let controller: SignerWithAddress;
  let trader: SignerWithAddress;

  let vault: Contract;
  let strategy: Contract;
  let tradeScript: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, controller, trader] = await ethers.getSigners();
  });

  beforeEach('deploy vault', async () => {
    vault = await deploy('Vault', { args: [] });
    tradeScript = await deploy('TradeScript', { args: [vault.address] });
    tokens = await deployTokens(['DAI', 'BAT', 'ANT', 'SNX', 'MKR']);

    const weights = [(1e18).toString(), (1e18).toString(), (1e18).toString(), (1e18).toString(), (1e18).toString()];
    strategy = await deploy('WeightedProdStrategy', {
      args: [
        [tokens.DAI.address, tokens.BAT.address, tokens.ANT.address, tokens.SNX.address, tokens.MKR.address],
        weights,
        5,
        0,
      ],
    });
  });

  describe('swap', () => {
    const totalPools = 4;

    let pools: Array<string> = [];

    beforeEach('setup pools & mint tokens', async () => {
      pools = [];

      // Mint and approve controller liquidity
      await Promise.all(
        ['DAI', 'BAT', 'ANT', 'SNX', 'MKR'].map(async (symbol) => mintTokens(tokens, symbol, controller, 100e18))
      );

      for (let poolIdIdx = 0; poolIdIdx < totalPools; ++poolIdIdx) {
        // Create even pools with all tokens, initial balance of 1e18 for each
        const poolId = await setupPool(vault, strategy, PairTS, tokens, controller, [
          ['DAI', (1e18).toString()],
          ['BAT', (1e18).toString()],
          ['ANT', (1e18).toString()],
          ['SNX', (1e18).toString()],
          ['MKR', (1e18).toString()],
        ]);

        pools.push(poolId);
      }

      // Mint tokens for trader
      await tokens.DAI.mint(trader.address, (1e18).toString());
      await tokens.DAI.connect(trader).approve(vault.address, MAX_UINT256);

      await vault.connect(trader).authorizeOperator(tradeScript.address);
    });

    describe('swapExactAmountIn', () => {
      it('double pool DAI for MKR', async () => {
        // Move the first two pools to a different price point (DAI:MKR becomes 1:2) by withdrawing DAI
        await vault
          .connect(controller)
          .removeLiquidity(
            pools[0],
            controller.address,
            [tokens.DAI.address],
            [(0.5e18).toString()],
            [(0.5e18).toString()]
          );
        await vault
          .connect(controller)
          .removeLiquidity(
            pools[1],
            controller.address,
            [tokens.DAI.address],
            [(0.5e18).toString()],
            [(0.5e18).toString()]
          );

        const [diffs, swaps, amounts] = getDiffsSwapsAndAmounts(tokens, [
          { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'MKR', amount: 600 }, //out 1200
          { poolId: pools[1], tokenIn: 'DAI', tokenOut: 'MKR', amount: 600 }, //out 1200
        ]);

        await expectBalanceChange(
          async () => {
            await tradeScript.connect(trader).swapExactAmountIn(
              {
                overallTokenIn: tokens.DAI.address,
                overallTokenOut: tokens.MKR.address,
                minAmountOut: 1500, //minAmountOut
                maxPrice: (0.6e18).toString(), //maxPrice
              },
              diffs,
              swaps,
              [],
              amounts,
              true
            );
          },
          trader,
          tokens,
          { DAI: -1200, MKR: ['gte', 2000] }
        );
      });

      it('multihop DAI for MKR', async () => {
        // Move the first and second pools to a different price point (DAI:SNX becomes 1:2) by withdrawing DAI
        await vault
          .connect(controller)
          .removeLiquidity(
            pools[0],
            controller.address,
            [tokens.DAI.address],
            [(0.5e18).toString()],
            [(0.5e18).toString()]
          );

        // Move the third pool to a different price point (SNX:BAT becomes 1:2) by withdrawing SNX
        await vault
          .connect(controller)
          .removeLiquidity(
            pools[1],
            controller.address,
            [tokens.SNX.address],
            [(0.5e18).toString()],
            [(0.5e18).toString()]
          );

        // Move the fourth pool to a different price point (BAT:MKR becomes 1:2) by withdrawing BAT
        await vault
          .connect(controller)
          .removeLiquidity(
            pools[2],
            controller.address,
            [tokens.BAT.address],
            [(0.5e18).toString()],
            [(0.5e18).toString()]
          );

        // Move the fifth pool to a different price point (DAI:MKR becomes 1:2) by withdrawing DAI
        await vault
          .connect(controller)
          .removeLiquidity(
            pools[3],
            controller.address,
            [tokens.DAI.address],
            [(0.5e18).toString()],
            [(0.5e18).toString()]
          );

        const [diffs, swaps, amounts] = getDiffsSwapsAndAmounts(tokens, [
          { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'SNX', amount: 1200 }, //out 2400
          { poolId: pools[1], tokenIn: 'SNX', tokenOut: 'BAT' }, //out 4800
          { poolId: pools[2], tokenIn: 'BAT', tokenOut: 'MKR' }, //out 9600
          { poolId: pools[3], tokenIn: 'DAI', tokenOut: 'MKR', amount: 600 }, //out 10800
        ]);

        await expectBalanceChange(
          async () => {
            await tradeScript.connect(trader).swapExactAmountIn(
              {
                overallTokenIn: tokens.DAI.address,
                overallTokenOut: tokens.MKR.address,
                minAmountOut: 10800, //minAmountOut
                maxPrice: (0.6e18).toString(), //maxPrice
              },
              diffs,
              swaps,
              [],
              amounts,
              true
            );
          },
          trader,
          tokens,
          { DAI: -1800, MKR: ['gte', 4600] }
        );
      });
    });
    describe('swapExactAmountOut', () => {
      it('double pool DAI for MKR', async () => {
        // Move the first two pools to a different price point (DAI:MKR becomes 1:2) by withdrawing DAI
        await vault
          .connect(controller)
          .removeLiquidity(
            pools[0],
            controller.address,
            [tokens.DAI.address],
            [(0.5e18).toString()],
            [(0.5e18).toString()]
          );
        await vault
          .connect(controller)
          .removeLiquidity(
            pools[1],
            controller.address,
            [tokens.DAI.address],
            [(0.5e18).toString()],
            [(0.5e18).toString()]
          );

        const [diffs, swaps, amounts] = getDiffsSwapsAndAmounts(tokens, [
          { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'MKR', amount: 1200 }, //in 600
          { poolId: pools[1], tokenIn: 'DAI', tokenOut: 'MKR', amount: 1200 }, //in 600
        ]);

        await expectBalanceChange(
          async () => {
            await tradeScript.connect(trader).swapExactAmountOut(
              {
                overallTokenIn: tokens.DAI.address,
                overallTokenOut: tokens.MKR.address,
                maxAmountIn: 1200, //maxAmountIn
                maxPrice: (0.6e18).toString(), //maxPrice
              },
              diffs,
              swaps,
              [],
              amounts,
              true
            );
          },
          trader,
          tokens,
          { DAI: -1200, MKR: ['gte', 2000] }
        );
      });

      it('multihop DAI for MKR', async () => {
        // Move the first and second pools to a different price point (DAI:SNX becomes 1:2) by withdrawing DAI
        await vault
          .connect(controller)
          .removeLiquidity(
            pools[0],
            controller.address,
            [tokens.DAI.address],
            [(0.5e18).toString()],
            [(0.5e18).toString()]
          );

        // Move the third pool to a different price point (SNX:BAT becomes 1:2) by withdrawing SNX
        await vault
          .connect(controller)
          .removeLiquidity(
            pools[1],
            controller.address,
            [tokens.SNX.address],
            [(0.5e18).toString()],
            [(0.5e18).toString()]
          );

        // Move the fourth pool to a different price point (BAT:MKR becomes 1:2) by withdrawing BAT
        await vault
          .connect(controller)
          .removeLiquidity(
            pools[2],
            controller.address,
            [tokens.BAT.address],
            [(0.5e18).toString()],
            [(0.5e18).toString()]
          );

        // Move the fifth pool to a different price point (DAI:MKR becomes 1:2) by withdrawing DAI
        await vault
          .connect(controller)
          .removeLiquidity(
            pools[3],
            controller.address,
            [tokens.DAI.address],
            [(0.5e18).toString()],
            [(0.5e18).toString()]
          );

        const [diffs, swaps, amounts] = getDiffsSwapsAndAmounts(tokens, [
          { poolId: pools[2], tokenIn: 'BAT', tokenOut: 'MKR', amount: 9600 }, //in 4800
          { poolId: pools[1], tokenIn: 'SNX', tokenOut: 'BAT' }, //in 2400
          { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'SNX' }, //in 1200
          { poolId: pools[3], tokenIn: 'DAI', tokenOut: 'MKR', amount: 1200 }, //in 600
        ]);

        await expectBalanceChange(
          async () => {
            await tokens.DAI.connect(trader).approve(tradeScript.address, (100e18).toString());
            await tradeScript.connect(trader).swapExactAmountOut(
              {
                overallTokenIn: tokens.DAI.address,
                overallTokenOut: tokens.MKR.address,
                maxAmountIn: 1800, //maxAmountIn
                maxPrice: (0.6e18).toString(), //maxPrice
              },
              diffs,
              swaps,
              [],
              amounts,
              true
            );
          },
          trader,
          tokens,
          { DAI: -1800, MKR: ['gte', 4600] }
        );
      });
    });
  });
});
