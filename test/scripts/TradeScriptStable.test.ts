import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { TokenList, deployTokens, mintTokens } from './../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { getDiffsSwapsAndAmounts, getSwapTokenIndexes } from '../../scripts/helpers/trading';
import { expectBalanceChange } from './../helpers/tokenBalance';
import { setupPool } from '../../scripts/helpers/pools';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

describe('TradeScriptStable', () => {
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
    tradeScript = await deploy('TradeScriptStable', vault.address);
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
    });

    it.only('swapExactAmountIn - one pool DAI for USDC', async () => {
      const [diffs, swaps, amounts] = getDiffsSwapsAndAmounts(tokens, [
        { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'USDC', amount: (2e18).toString() },
      ]);
      const indexes = getSwapTokenIndexes([[0, 1]]);

      await expectBalanceChange(
        async () => {
          await tokens.DAI.connect(trader).approve(tradeScript.address, (100e18).toString());
          await tradeScript
            .connect(trader)
            .swapExactAmountIn(
              tokens.DAI.address,
              tokens.USDC.address,
              (2e18).toString(),
              (1e18).toString(),
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

    it.only('swapExactAmountIn - multihop DAI for SUSD', async () => {
      const [diffs, swaps, amounts] = getDiffsSwapsAndAmounts(tokens, [
        { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'USDC', amount: (2e18).toString() },
        { poolId: pools[1], tokenIn: 'USDC', tokenOut: 'TUSD' },
        { poolId: pools[2], tokenIn: 'TUSD', tokenOut: 'SUSD' },
      ]);
      const indexes = getSwapTokenIndexes([
        [0, 1],
        [1, 2],
        [2, 3],
      ]);

      await expectBalanceChange(
        async () => {
          await tokens.DAI.connect(trader).approve(tradeScript.address, (100e18).toString());
          await tradeScript
            .connect(trader)
            .swapExactAmountIn(
              tokens.DAI.address,
              tokens.SUSD.address,
              (2e18).toString(),
              (1e18).toString(),
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
});
