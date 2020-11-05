import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { getDiffsSwapsAndAmounts, getSwapTokenIndexes } from '../../scripts/helpers/trading';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { setupPool } from '../../scripts/helpers/pools';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../helpers/constants';

describe('TradeScript - Multiple Strategies', () => {
  let controller: SignerWithAddress;
  let trader: SignerWithAddress;

  let vault: Contract;
  let curveWeightProd1: Contract;
  let curveWeightProd2: Contract;
  let curveStable: Contract;
  let tradeScript: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, controller, trader] = await ethers.getSigners();
  });

  beforeEach('deploy vault', async () => {
    vault = await deploy('Vault', { args: [] });
    tradeScript = await deploy('TradeScript', { args: [vault.address] });
    tokens = await deployTokens(['DAI', 'USDC', 'TUSD', 'SUSD', 'MKR']);

    const weights = [(1e18).toString(), (1e18).toString()];
    curveWeightProd1 = await deploy('WeightedProdStrategy', {
      args: [[tokens.USDC.address, tokens.MKR.address], weights, 2, 0],
    });
    curveWeightProd2 = await deploy('WeightedProdStrategy', {
      args: [[tokens.TUSD.address, tokens.MKR.address], weights, 2, 0],
    });

    const amp = (30e18).toString();
    curveStable = await deploy('StableStrategy', { args: [amp, 0] });
  });

  describe('swap', () => {
    let pools: Array<string> = [];

    beforeEach('setup pools & mint tokens', async () => {
      pools = [];

      // Mint and approve controller liquidity
      await Promise.all(
        ['DAI', 'USDC', 'TUSD', 'SUSD'].map(async (symbol) => mintTokens(tokens, symbol, controller, 100e18))
      );

      // Create pool 1
      let poolId = await setupPool(vault, curveStable, 1, tokens, controller, [
        ['DAI', (50e18).toString()],
        ['USDC', (60e18).toString()],
      ]);
      pools.push(poolId);
      // Create pool 2
      poolId = await setupPool(vault, curveWeightProd1, 0, tokens, controller, [
        ['USDC', (700e18).toString()],
        ['MKR', (10e18).toString()],
      ]);
      pools.push(poolId);
      // Create pool 3
      poolId = await setupPool(vault, curveWeightProd2, 0, tokens, controller, [
        ['TUSD', (700e18).toString()],
        ['MKR', (10e18).toString()],
      ]);
      pools.push(poolId);
      // Create pool 4
      poolId = await setupPool(vault, curveStable, 1, tokens, controller, [
        ['DAI', (20e18).toString()],
        ['USDC', (30e18).toString()],
        ['TUSD', (40e18).toString()],
        ['SUSD', (50e18).toString()],
      ]);
      pools.push(poolId);

      // Mint tokens for trader
      await tokens.DAI.mint(trader.address, (10e18).toString());
      await tokens.DAI.connect(trader).approve(vault.address, MAX_UINT256);

      await vault.connect(trader).authorizeOperator(tradeScript.address);
    });

    describe('swapExactAmountIn', () => {
      it('multihop DAI for SUSD', async () => {
        const [diffs, swaps, amounts] = getDiffsSwapsAndAmounts(
          await trader.getAddress(),
          await trader.getAddress(),
          tokens,
          [
            { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'USDC', amount: (2e18).toString() },
            { poolId: pools[1], tokenIn: 'USDC', tokenOut: 'MKR' },
            { poolId: pools[2], tokenIn: 'MKR', tokenOut: 'TUSD' },
            { poolId: pools[3], tokenIn: 'TUSD', tokenOut: 'SUSD' },
          ]
        );
        const indexes = getSwapTokenIndexes([
          [0, 1],
          [0, 1],
          [1, 0],
          [2, 3],
        ]);

        await expectBalanceChange(
          async () => {
            await tokens.DAI.connect(trader).approve(tradeScript.address, (100e18).toString());
            await tradeScript.connect(trader).swapExactAmountIn(
              {
                overallTokenIn: tokens.DAI.address,
                overallTokenOut: tokens.SUSD.address,
                minAmountOut: (2e18).toString(), //minAmountOut
                maxPrice: (1e18).toString(), //maxPrice
              },
              diffs,
              swaps,
              indexes,
              amounts,
              true
            );
          },
          trader,
          tokens,
          { DAI: (-2e18).toString(), SUSD: ['gte', '2011635607989682633'] } //2011635607989682633
        );
      });
    });
    describe('swapExactAmountOut', () => {
      it('multihop DAI for SUSD', async () => {
        const [diffs, swaps, amounts] = getDiffsSwapsAndAmounts(
          await trader.getAddress(),
          await trader.getAddress(),
          tokens,
          [
            { poolId: pools[3], tokenIn: 'TUSD', tokenOut: 'SUSD', amount: '2011635607989682633' },
            { poolId: pools[2], tokenIn: 'MKR', tokenOut: 'TUSD' },
            { poolId: pools[1], tokenIn: 'USDC', tokenOut: 'MKR' },
            { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'USDC' },
          ]
        );

        const indexes = getSwapTokenIndexes([
          [2, 3],
          [1, 0],
          [0, 1],
          [0, 1],
        ]);

        await expectBalanceChange(
          async () => {
            await tokens.DAI.connect(trader).approve(tradeScript.address, (100e18).toString());
            await tradeScript.connect(trader).swapExactAmountOut(
              {
                overallTokenIn: tokens.DAI.address,
                overallTokenOut: tokens.SUSD.address,
                maxAmountIn: (3e18).toString(), //maxAmountIn
                maxPrice: (1.1e18).toString(), //maxPrice
              },
              diffs,
              swaps,
              indexes,
              amounts,
              true
            );
          },
          trader,
          tokens,
          { SUSD: '2011635607989682633', DAI: '-2000000000000000108' } //2011635607989682633
        );
      });
    });
  });
});
