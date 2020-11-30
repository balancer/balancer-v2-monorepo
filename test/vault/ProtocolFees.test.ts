import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PairTS, setupPool } from '../../scripts/helpers/pools';
import { MAX_UINT256 } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';

describe('Vault - protocol fees', () => {
  let admin: SignerWithAddress;
  let controller: SignerWithAddress;
  let recipient: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, admin, controller, recipient, other] = await ethers.getSigners();
  });

  beforeEach(async () => {
    vault = await deploy('Vault', { from: admin, args: [admin.address] });
    tokens = await deployTokens(['DAI', 'MKR'], [18, 18]);

    for (const symbol in tokens) {
      await mintTokens(tokens, symbol, controller, 100e18);
      await tokens[symbol].connect(controller).approve(vault.address, MAX_UINT256);
    }
  });

  it('initially is zero', async () => {
    expect(await vault.getCollectedFeesByToken(tokens.DAI.address)).to.equal(0);
  });

  describe('protocol fee charged', () => {
    let poolId: string;

    beforeEach(async () => {
      const strategy = await deploy('MockTradingStrategy', { args: [] });
      poolId = await setupPool(vault, strategy, PairTS, tokens, controller, [
        ['DAI', (5e18).toString()],
        ['MKR', (10e18).toString()],
      ]);
      await vault.connect(admin).setProtocolWithdrawFee((0.01e18).toString());

      await vault
        .connect(controller)
        .removeLiquidity(poolId, controller.address, [tokens.DAI.address], [(5e18).toString()], false);
      await vault
        .connect(controller)
        .removeLiquidity(poolId, controller.address, [tokens.MKR.address], [(10e18).toString()], false);
    });

    it('reports collected fee correctly', async () => {
      expect((await vault.getCollectedFeesByToken(tokens.DAI.address)).toString()).to.equal((0.05e18).toString());
      expect((await vault.getCollectedFeesByToken(tokens.MKR.address)).toString()).to.equal((0.1e18).toString());
    });

    it('protocol fees can be withdraw by admin', async () => {
      await expectBalanceChange(
        () =>
          vault
            .connect(admin)
            .withdrawProtocolFees(
              [tokens.DAI.address, tokens.MKR.address],
              [(0.02e18).toString(), (0.04e18).toString()],
              recipient.address
            ),
        recipient,
        tokens,
        { DAI: (0.02e18).toString(), MKR: (0.04e18).toString() }
      );

      expect((await vault.getCollectedFeesByToken(tokens.DAI.address)).toString()).to.equal((0.03e18).toString());
      expect((await vault.getCollectedFeesByToken(tokens.MKR.address)).toString()).to.equal((0.06e18).toString());
    });

    it('non-admin cannot withdraw protocol fees', async () => {
      await expect(
        vault.connect(other).withdrawProtocolFees([tokens.DAI.address], [(0.02e18).toString()], recipient.address)
      ).to.be.revertedWith('Caller is not the admin');
    });

    it('protocol fees cannot be over-withdrawn', async () => {
      await expect(
        vault
          .connect(admin)
          .withdrawProtocolFees([tokens.DAI.address], [BigNumber.from((1e18).toString()).add(1)], recipient.address)
      ).to.be.revertedWith('Insufficient protocol fees');
    });
  });
});
