import { ethers } from '@nomiclabs/buidler';
import { expect } from 'chai';
import { Contract, Signer, ContractReceipt } from 'ethers';
import * as expectEvent from '../helpers/expectEvent';
import { MAX_UINT256 } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deployTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';

describe('Vault - multiple pool trading strategies', () => {
  let controller: Signer;

  let vault: Contract;
  let curveProd: Contract;
  let curveConstantPrice: Contract;
  let tradeScript: Contract;
  let trader: Signer;
  let creditor: Signer;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, controller, trader, creditor] = await ethers.getSigners();
  });

  beforeEach('deploy vault', async () => {
    vault = await deploy('Vault');
    curveProd = await deploy('ConstantWeightedProdCurve', [1, 1]);
    curveConstantPrice = await deploy('ConstantPriceCurve');
    tradeScript = await deploy('MockTradeScript');
    tokens = await deployTokens(['DAI', 'TEST']);
  });

  describe('curve management', () => {
    let poolIdProd: string;
    let poolIdConstantPrice: string;

    beforeEach('add 2 pools with different curves', async () => {
      // mint tokens
      await Promise.all(
        ['DAI', 'TEST'].map(async (token) => {
          await tokens[token].mint(await controller.getAddress(), (500e18).toString());
          await tokens[token].connect(controller).approve(vault.address, MAX_UINT256);
        })
      );

      // Set up constant weighted product pool
      poolIdProd = ethers.utils.id('Test - Prod');
      await vault.connect(controller).newPool(poolIdProd, curveProd.address);
      await vault.connect(controller).setSwapFee(poolIdProd, (5e16).toString());
      // 50-50 DAI-TEST pool with 1e18 tokens in each
      await vault.connect(controller).bind(poolIdProd, tokens.DAI.address, (200e18).toString());
      await vault.connect(controller).bind(poolIdProd, tokens.TEST.address, (200e18).toString());

      // Set up constant sum product pool
      poolIdConstantPrice = ethers.utils.id('Test - ConstantPrice');
      await vault.connect(controller).newPool(poolIdConstantPrice, curveConstantPrice.address);
      await vault.connect(controller).setSwapFee(poolIdConstantPrice, (5e16).toString());
      // 50-50 DAI-TEST pool with 1e18 tokens in each
      await vault.connect(controller).bind(poolIdConstantPrice, tokens.DAI.address, (200e18).toString());
      await vault.connect(controller).bind(poolIdConstantPrice, tokens.TEST.address, (200e18).toString());

      // Mint tokens for trader
      await tokens.DAI.mint(await trader.getAddress(), (300e18).toString());
      await tokens.TEST.mint(await trader.getAddress(), (300e18).toString());

      // Approve trade script by trader
      await tokens.DAI.connect(trader).approve(tradeScript.address, (900e18).toString());
      await tokens.TEST.connect(trader).approve(tradeScript.address, (900e18).toString());
    });

    it('has the correct curve', async () => {
      expect(await vault.getInvariant(poolIdProd)).to.equal(curveProd.address);
      expect(await vault.getInvariant(poolIdConstantPrice)).to.equal(curveConstantPrice.address);
    });

    it('gives different outGivenIn for each curve', async () => {
      const trade = [0, 1, 100, 100, 100];
      const outGivenInProd = await curveProd.calculateOutGivenIn(...trade);
      const outGivenInConstantPrice = await curveConstantPrice.calculateOutGivenIn(...trade);
      expect(outGivenInConstantPrice).to.equal(100);
      expect(outGivenInProd).to.equal(50);
    });

    it('trades with constant price pool', async () => {
      const diffs = [
        {
          token: tokens.DAI.address,
          vaultDelta: 0,
        },
        {
          token: tokens.TEST.address,
          vaultDelta: 0,
        },
      ];

      const fee = 0;

      const swaps = [
        {
          poolId: poolIdConstantPrice,
          tokenA: { tokenDiffIndex: 1, delta: (1e18).toString() },
          tokenB: { tokenDiffIndex: 0, delta: (-1e18).toString() },
        },
      ];

      await expectBalanceChange(
        async () => {
          // Send tokens & swap - would normally happen in the same tx
          const receipt: ContractReceipt = await (
            await tradeScript.batchSwap(
              vault.address,
              [tokens.TEST.address],
              [(1e18).toString()],
              diffs,
              swaps,
              tradeScript.address,
              tradeScript.address,
              true
            )
          ).wait();
          expectEvent.inReceipt(receipt, 'TestCurveValidate');
        },
        tradeScript.address,
        tokens,
        { DAI: 1e18, TEST: -1e18 }
      );
    });

    it('trades with constant weighted product pool', async () => {
      const diffs = [
        {
          token: tokens.DAI.address,
          vaultDelta: 0,
        },
        {
          token: tokens.TEST.address,
          vaultDelta: 0,
        },
      ];

      const fee = 0;

      const swaps = [
        {
          poolId: poolIdProd,
          tokenA: { tokenDiffIndex: 1, delta: (1e18).toString() },
          tokenB: { tokenDiffIndex: 0, delta: (-1e18).toString() },
        },
      ];

      await expectBalanceChange(
        async () => {
          // Send tokens & swap - would normally happen in the same tx
          await tradeScript.batchSwap(
            vault.address,
            [tokens.TEST.address],
            [(1e18).toString()],
            diffs,
            swaps,
            tradeScript.address,
            tradeScript.address,
            true
          );
        },
        tradeScript.address,
        tokens,
        { DAI: 1e18, TEST: -1e18 }
      );
    });
  });
});
