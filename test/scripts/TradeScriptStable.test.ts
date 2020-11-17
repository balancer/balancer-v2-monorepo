import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { getTokensSwapsAndAmounts, getSwapTokenIndexes } from '../../scripts/helpers/trading';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { setupPool } from '../../scripts/helpers/pools';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../helpers/constants';

describe('TradeScript - Stable', () => {
  let admin: SignerWithAddress;
  let controller: SignerWithAddress;
  let trader: SignerWithAddress;

  let vault: Contract;
  let curve: Contract;
  let curveWithFee: Contract;
  let tradeScript: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, admin, controller, trader] = await ethers.getSigners();
  });

  beforeEach('deploy vault', async () => {
    vault = await deploy('Vault', { from: admin, args: [] });
    tradeScript = await deploy('TradeScript', { args: [vault.address] });
    tokens = await deployTokens(['DAI', 'USDC', 'TUSD', 'SUSD']);

    const amp = (30e18).toString();
    curve = await deploy('StableStrategy', { args: [amp, 0] });
    curveWithFee = await deploy('StableStrategy', { args: [amp, (0.02e18).toString()] }); // 2% fee
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
      // Create pool 4 with fee
      poolId = await setupPool(vault, curveWithFee, 1, tokens, controller, [
        ['DAI', (50e18).toString()],
        ['USDC', (60e18).toString()],
      ]);
      pools.push(poolId);

      // Mint tokens for trader
      await tokens.DAI.mint(trader.address, (10e18).toString());
      await tokens.DAI.connect(trader).approve(vault.address, MAX_UINT256);

      await vault.connect(trader).authorizeOperator(tradeScript.address);
    });

    describe('swapExactAmountIn', () => {
      it('one pool DAI for USDC', async () => {
        const [tokenAddresses, swaps, amounts] = getTokensSwapsAndAmounts(tokens, [
          { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'USDC', amount: (2e18).toString() },
        ]);
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
              swaps,
              tokenAddresses,
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

      it('one pool DAI for USDC with swap fee', async () => {
        const [tokenAddresses, swaps, amounts] = getTokensSwapsAndAmounts(tokens, [
          { poolId: pools[3], tokenIn: 'DAI', tokenOut: 'USDC', amount: (2.041e18).toString() }, //2e18 / (1 - 0.02)
        ]);
        const indexes = getSwapTokenIndexes([[0, 1]]);

        await expectBalanceChange(
          async () => {
            await tokens.DAI.connect(trader).approve(tradeScript.address, (100e18).toString());
            await tradeScript.connect(trader).swapExactAmountIn(
              {
                overallTokenIn: tokens.DAI.address,
                overallTokenOut: tokens.USDC.address,
                minAmountOut: (2e18).toString(), //minAmountOut
                maxPrice: (1.1e18).toString(), //maxPrice
              },
              swaps,
              tokenAddresses,
              indexes,
              amounts,
              true
            );
          },
          trader,
          tokens,
          { DAI: (-2.041e18).toString(), USDC: ['gte', '2004825982206027991'] }
        );
      });

      it('one pool DAI for USDC with swap fee and swap protocol fee', async () => {
        await vault.connect(admin).setProtocolSwapFee((0.5e18).toString()); //50%

        const [tokenAddresses, swaps, amounts] = getTokensSwapsAndAmounts(tokens, [
          { poolId: pools[3], tokenIn: 'DAI', tokenOut: 'USDC', amount: (2.041e18).toString() }, //2e18 / (1 - 0.02)
        ]);
        const indexes = getSwapTokenIndexes([[0, 1]]);

        await expectBalanceChange(
          async () => {
            await tokens.DAI.connect(trader).approve(tradeScript.address, (100e18).toString());
            await tradeScript.connect(trader).swapExactAmountIn(
              {
                overallTokenIn: tokens.DAI.address,
                overallTokenOut: tokens.USDC.address,
                minAmountOut: (2e18).toString(), //minAmountOut
                maxPrice: (1.1e18).toString(), //maxPrice
              },
              swaps,
              tokenAddresses,
              indexes,
              amounts,
              true
            );
          },
          trader,
          tokens,
          { DAI: (-2.041e18).toString(), USDC: ['gte', '2004825982206027991'] }
        );

        expect(await vault.getTotalUnaccountedForTokens(tokens.DAI.address)).to.equal((0.04082e18 / 2).toString()); //50% of 2% of 2.041e18
      });

      it('multihop DAI for SUSD', async () => {
        const [tokenAddresses, swaps, amounts] = getTokensSwapsAndAmounts(tokens, [
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
            await tradeScript.connect(trader).swapExactAmountIn(
              {
                overallTokenIn: tokens.DAI.address,
                overallTokenOut: tokens.SUSD.address,
                minAmountOut: (2e18).toString(), //minAmountOut
                maxPrice: (1e18).toString(), //maxPrice
              },
              swaps,
              tokenAddresses,
              indexes,
              amounts,
              true
            );
          },
          trader,
          tokens,
          { DAI: (-2e18).toString(), SUSD: ['gte', '2004844365375433805'] } //2004844365375433805
        );
      });
    });
    describe('swapExactAmountOut', () => {
      it('one pool USDC for DAI', async () => {
        const [tokenAddresses, swaps, amounts] = getTokensSwapsAndAmounts(tokens, [
          { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'USDC', amount: '2004825982206027991' }, //in (2e18).toString()
        ]);
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
              swaps,
              tokenAddresses,
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
        const [tokenAddresses, swaps, amounts] = getTokensSwapsAndAmounts(tokens, [
          { poolId: pools[2], tokenIn: 'TUSD', tokenOut: 'SUSD', amount: '2004844365375433805' },
          { poolId: pools[1], tokenIn: 'USDC', tokenOut: 'TUSD' },
          { poolId: pools[0], tokenIn: 'DAI', tokenOut: 'USDC' },
        ]);
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
              swaps,
              tokenAddresses,
              indexes,
              amounts,
              true
            );
          },
          trader,
          tokens,
          { SUSD: '2004844365375433805', DAI: '-2000000000000000000' } //2132790554831920652
        );
      });
    });
  });
});
