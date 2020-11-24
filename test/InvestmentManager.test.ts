import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../scripts/helpers/deploy';
import { PairTS } from '../scripts/helpers/pools';
import { deployTokens, TokenList } from './helpers/tokens';
import { MAX_UINT256 } from './helpers/constants';
import { setupController } from '../scripts/helpers/controllers';

const { BigNumber } = ethers;

describe('InvestmentManager', function () {
  let admin: SignerWithAddress;
  let owner: SignerWithAddress;

  let vault: Contract;
  let strategy: Contract;
  let investmentManager: Contract;
  let tokenizer: Contract;
  let tokens: TokenList = {};

  let poolId: string;
  const investablePercentage = (0.8e18).toString();

  beforeEach(async function () {
    [, admin, owner] = await ethers.getSigners();

    vault = await deploy('Vault', { args: [admin.address] });

    strategy = await deploy('MockTradingStrategy', { args: [] });

    const tokenNames = ['WETH', 'DAI'];
    tokens = await deployTokens(tokenNames, [18, 18]);

    await Promise.all(
      ['WETH', 'DAI'].map(async (token) => {
        await tokens[token].mint(owner.address, (200e18).toString());
        await tokens[token].connect(owner).approve(vault.address, MAX_UINT256);
      })
    );

    tokenizer = await setupController(
      vault,
      admin,
      owner,
      'OwnableFixedSetPoolTokenizer',
      strategy.address,
      PairTS,
      (100e18).toString(),
      [tokens.WETH.address, tokens.DAI.address],
      [(100e18).toString(), (100e18).toString()],
      owner.address
    );

    poolId = await tokenizer.poolId();

    investmentManager = await deploy('MockInvestmentManager', { args: [vault.address, tokens.DAI.address] });
    await investmentManager.initialize();

    await tokenizer.connect(owner).authorizePoolInvestmentManager(tokens.DAI.address, investmentManager.address);
  });

  it('Should let a tokenizer approve its assets to be invested', async () => {
    await tokenizer.connect(owner).setInvestablePercentage(tokens.DAI.address, investablePercentage);
    expect(await vault.getInvestablePercentage(poolId, tokens.DAI.address)).to.equal((0.8e18).toString());
  });

  describe('with asset investment approval', () => {
    beforeEach(async () => {
      await tokenizer.connect(owner).setInvestablePercentage(tokens.DAI.address, investablePercentage);
    });

    it('should let anyone trigger investment when assets are underutilized', async () => {
      const amount = (10e18).toString();
      await vault.investPoolBalance(poolId, tokens.DAI.address, investmentManager.address, amount);
      expect(await tokens.DAI.balanceOf(vault.address)).to.equal(BigNumber.from((90e18).toString()));
      expect(await tokens.DAI.balanceOf(investmentManager.address)).to.equal(BigNumber.from((10e18).toString()));
    });

    describe('with assets invested', () => {
      beforeEach(async () => {
        const amount = (75e18).toString();
        await vault.investPoolBalance(poolId, tokens.DAI.address, investmentManager.address, amount);
      });

      it('should update the vault with any gains', async () => {
        // simulate returns 100 -> 110 (10%)
        await investmentManager.mockIncreasePresentValue((0.1e18).toString());

        await investmentManager.updateInvested(poolId);

        const investmentReturns = 7.5e18; // 75*10%

        expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.WETH.address])).to.deep.equal([
          BigNumber.from((100e18 + investmentReturns).toString()),
          BigNumber.from((100e18).toString()),
        ]);
      });

      it('should revert if you attempt to divest while underutilized', async () => {
        const reversionMsg = 'under investment amount - cannot divest';
        const divestmentAmount = BigNumber.from((10e18).toString());
        expect(
          vault.divestPoolBalance(poolId, tokens.DAI.address, investmentManager.address, divestmentAmount)
        ).to.be.revertedWith(reversionMsg);
      });
    });

    describe('with assets overinvested', () => {
      beforeEach(async () => {
        // Invest 80% of assets
        const amount = (80e18).toString();
        await vault.investPoolBalance(poolId, tokens.DAI.address, investmentManager.address, amount);

        // Decrease investablePercentage to 30%
        const lowInvestablePercentage = (0.3e18).toString();
        await tokenizer.connect(owner).setInvestablePercentage(tokens.DAI.address, lowInvestablePercentage);
      });

      it('should let anyone trigger divestment when assets are overutilized', async () => {
        expect(await tokens.DAI.balanceOf(vault.address)).to.equal(BigNumber.from((20e18).toString()));

        const divestmentAmount = BigNumber.from((50e18).toString());
        await vault.divestPoolBalance(poolId, tokens.DAI.address, investmentManager.address, divestmentAmount);

        expect(await tokens.DAI.balanceOf(vault.address)).to.equal(BigNumber.from((70e18).toString()));
      });
    });

    describe('when investment matches investable percent', () => {
      beforeEach(async () => {
        const amount = (80e18).toString();
        await vault.investPoolBalance(poolId, tokens.DAI.address, investmentManager.address, amount);
      });

      it('should update the vault with any gains', async () => {
        // Vault:             20
        // InvestmentManager: 80 = 96
        // Total:             100
        // Utilizaton: 80/100 = 80%

        await investmentManager.mockIncreasePresentValue((0.2e18).toString());
        await investmentManager.updateInvested(poolId);

        // Vault:             20
        // InvestmentManager: 16 + 80 = 96
        // Total:             116
        // Utilizaton: 96/116 = 82.759%

        const divestmentAmount = BigNumber.from((3.2e18).toString());
        await vault.divestPoolBalance(poolId, tokens.DAI.address, investmentManager.address, divestmentAmount);

        // Vault:             23.2
        // InvestmentManager: 92.8
        // Total:             116
        // Utilizaton:        80%

        expect(await tokens.DAI.balanceOf(vault.address)).to.equal(BigNumber.from((23.2e18).toString()));

        // There is now an arbitrage opportunity because the ratio DAI:WETH has changed
        expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.WETH.address])).to.deep.equal([
          BigNumber.from((116e18).toString()),
          BigNumber.from((100e18).toString()),
        ]);
      });
    });
  });
});
