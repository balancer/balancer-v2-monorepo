import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { getDiffsSwapsAndAmounts, getSwapTokenIndexes } from '../../scripts/helpers/trading';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { setupPool } from '../../scripts/helpers/pools';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../helpers/constants';

describe('TradeScript - Stable', () => {
  let controller: SignerWithAddress;
  let trader: SignerWithAddress;

  let vault: Contract;
  let curve: Contract;
  let tradeScript: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, controller, trader] = await ethers.getSigners();
  });

  beforeEach('deploy vault', async () => {
    vault = await deploy('Vault');
    tradeScript = await deploy('TradeScript', vault.address);
    tokens = await deployTokens(['DAI', 'USDC', 'TUSD', 'SUSD']);

    const amp = (30e18).toString();
    curve = await deploy('StableStrategy', amp, 0);
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
      let poolId = await setupPool(vault, curve, 1, tokens, controller, [
        ['DAI', (50e18).toString()],
        ['USDC', (60e18).toString()],
      ]);
      pools.push(poolId);
      // Create pool 2
      poolId = await setupPool(vault, curve, 1, tokens, controller, [
        ['DAI', (20e18).toString()],
        ['USDC', (30e18).toString()],
        ['TUSD', (40e18).toString()],
      ]);
      pools.push(poolId);
      // Create pool 3
      poolId = await setupPool(vault, curve, 1, tokens, controller, [
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
      it('one pool DAI for USDC', async () => {
        const [diffs, swaps, amounts] = getDiffsSwapsAndAmounts(
          await trader.getAddress(),
          await trader.getAddress(),
          tokens,
          [{ poolId: pools[0], tokenIn: 'DAI', tokenOut: 'USDC', amount: (2e18).toString() }]
        );
        const indexes = getSwapTokenIndexes([[0, 1]]);

        await expectBalanceChange(
          async () => {
            await tokens.DAI.connect(trader).approve(tradeScript.address, (100e18).toString());
            await tradeScript.connect(trader).swapExactAmountIn(
              {
                overallTokenIn: tokens.DAI.address,
                overallTokenOut: tokens.USDC.address,
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
          { DAI: (-2e18).toString(), USDC: ['gte', '2004825982206027991'] } //2004825982206027991
        );
      });

      it('multihop DAI for SUSD', async () => {
        const [diffs, swaps, amounts] = getDiffsSwapsAndAmounts(
          await trader.getAddress(),
          await trader.getAddress(),
          tokens,
          [
            { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'USDC', amount: (2e18).toString() },
            { poolId: pools[1], tokenIn: 'USDC', tokenOut: 'TUSD' },
            { poolId: pools[2], tokenIn: 'TUSD', tokenOut: 'SUSD' },
          ]
        );
        const indexes = getSwapTokenIndexes([
          [0, 1],
          [1, 2],
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
          { DAI: (-2e18).toString(), SUSD: ['gte', '2132790554831920652'] } //2132790554831920652
        );
      });
    });
    describe('swapExactAmountOut', () => {
      it('one pool USDC for DAI', async () => {
        const [diffs, swaps, amounts] = getDiffsSwapsAndAmounts(
          await trader.getAddress(),
          await trader.getAddress(),
          tokens,
          [
            { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'USDC', amount: '2004825982206027991' }, //in (2e18).toString()
          ]
        );
        const indexes = getSwapTokenIndexes([[0, 1]]);

        await expectBalanceChange(
          async () => {
            await tokens.DAI.connect(trader).approve(tradeScript.address, (100e18).toString());
            await tradeScript.connect(trader).swapExactAmountOut(
              {
                overallTokenIn: tokens.DAI.address,
                overallTokenOut: tokens.USDC.address,
                maxAmountIn: (2e18).toString(), //maxAmountIn
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
          { USDC: '2004825982206027991', DAI: '-2000000000000000000' } //2004825982206027991
        );
      });

      it('multihop DAI for SUSD', async () => {
        const [diffs, swaps, amounts] = getDiffsSwapsAndAmounts(
          await trader.getAddress(),
          await trader.getAddress(),
          tokens,
          [
            { poolId: pools[2], tokenIn: 'TUSD', tokenOut: 'SUSD', amount: '2132790554831920652' },
            { poolId: pools[1], tokenIn: 'USDC', tokenOut: 'TUSD' },
            { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'USDC' },
          ]
        );
        const indexes = getSwapTokenIndexes([
          [2, 3],
          [1, 2],
          [0, 1],
        ]);

        await expectBalanceChange(
          async () => {
            await tokens.DAI.connect(trader).approve(tradeScript.address, (100e18).toString());
            await tradeScript.connect(trader).swapExactAmountOut(
              {
                overallTokenIn: tokens.DAI.address,
                overallTokenOut: tokens.SUSD.address,
                maxAmountIn: (2e18).toString(), //maxAmountIn
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
          { SUSD: '2132790554831920652', DAI: '-2000000000000000000' } //2132790554831920652
        );
      });
    });
  });
});
