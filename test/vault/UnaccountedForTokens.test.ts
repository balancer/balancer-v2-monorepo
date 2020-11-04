import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { createPool, PairTS, setupPool } from '../../scripts/helpers/pools';
import { MAX_UINT256 } from '../helpers/constants';
import { Diff, Swap } from '../../scripts/helpers/trading';

describe('Vault - unaccounted for tokens', () => {
  let trader: SignerWithAddress;
  let controller: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, trader, controller, other] = await ethers.getSigners();
  });

  beforeEach(async () => {
    vault = await deploy('Vault');
    tokens = await deployTokens(['DAI', 'MKR']);

    for (const symbol in tokens) {
      await mintTokens(tokens, symbol, controller, 100e18);
      await tokens[symbol].connect(controller).approve(vault.address, MAX_UINT256);

      await mintTokens(tokens, symbol, trader, 100e18);
      await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);

      await mintTokens(tokens, symbol, other, 100e18);
    }
  });

  it('initially is zero', async () => {
    expect(await vault.getTotalUnaccountedForTokens(tokens.DAI.address)).to.equal(0);
  });

  it('transfers increase unaccounted for balance for that token', async () => {
    await tokens.DAI.connect(other).transfer(vault.address, (1e18).toString());

    expect(await vault.getTotalUnaccountedForTokens(tokens.DAI.address)).to.equal((1e18).toString());
    expect(await vault.getTotalUnaccountedForTokens(tokens.MKR.address)).to.equal(0);
  });

  context('with pool', () => {
    let poolId: string;

    beforeEach(async () => {
      const strategy = await deploy('MockTradingStrategy');
      poolId = await createPool(vault, strategy, PairTS, controller);
    });

    it('adding liquidity does not alter unaccounted for balance', async () => {
      await tokens.DAI.connect(other).transfer(vault.address, (1e18).toString());

      await vault
        .connect(controller)
        .addLiquidity(
          poolId,
          controller.address,
          [tokens.DAI.address, tokens.MKR.address],
          [(2e18).toString(), (2e18).toString()]
        );

      await tokens.DAI.connect(other).transfer(vault.address, (0.5e18).toString());

      expect(await vault.getTotalUnaccountedForTokens(tokens.DAI.address)).to.equal((1.5e18).toString());
      expect(await vault.getTotalUnaccountedForTokens(tokens.MKR.address)).to.equal(0);
    });
  });

  context('with funded pool', () => {
    let poolId: string;

    beforeEach(async () => {
      const strategy = await deploy('MockTradingStrategy');
      poolId = await setupPool(vault, strategy, PairTS, tokens, controller, [
        ['DAI', (2e18).toString()],
        ['MKR', (2e18).toString()],
      ]);
    });

    it('swaps do not alter unaccounted for balance', async () => {
      await tokens.DAI.connect(other).transfer(vault.address, (1e18).toString());

      const diffs: Array<Diff> = [
        { token: tokens.DAI.address, vaultDelta: 0, amountIn: 500 },
        { token: tokens.MKR.address, vaultDelta: 0, amountIn: 0 },
      ];
      const swaps: [Swap] = [
        { poolId, tokenIn: { tokenDiffIndex: 0, amount: 500 }, tokenOut: { tokenDiffIndex: 1, amount: 500 } },
      ];

      await vault
        .connect(trader)
        .batchSwap(
          diffs,
          swaps,
          { withdrawFrom: trader.address },
          { recipient: trader.address, transferToRecipient: true }
        );

      await tokens.DAI.connect(other).transfer(vault.address, (0.5e18).toString());

      expect(await vault.getTotalUnaccountedForTokens(tokens.DAI.address)).to.equal((1.5e18).toString());
      expect(await vault.getTotalUnaccountedForTokens(tokens.MKR.address)).to.equal(0);
    });
  });
});
