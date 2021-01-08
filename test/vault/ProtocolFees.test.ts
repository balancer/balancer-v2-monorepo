import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { SimplifiedQuotePool } from '../../scripts/helpers/pools';
import { MAX_UINT256, ZERO_ADDRESS } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';

describe('Vault - protocol fees', () => {
  let admin: SignerWithAddress;
  let lp: SignerWithAddress;
  let collector: SignerWithAddress;
  let other: SignerWithAddress;

  let vault: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, admin, lp, collector, other] = await ethers.getSigners();
  });

  beforeEach(async () => {
    vault = await deploy('Vault', { from: admin, args: [admin.address] });
    tokens = await deployTokens(['DAI', 'MKR'], [18, 18]);

    for (const symbol in tokens) {
      await mintTokens(tokens, symbol, lp, 100e18);
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);
    }
  });

  it('initially is zero', async () => {
    expect(await vault.getCollectedFeesByToken(tokens.DAI.address)).to.equal(0);
  });

  it('admin can set protocol fee collector', async () => {
    await vault.connect(admin).setProtocolFeeCollector(collector.address);
    expect(await vault.protocolFeeCollector()).to.equal(collector.address);
  });

  it('can set protocol fee collector to zero address', async () => {
    await vault.connect(admin).setProtocolFeeCollector(ZERO_ADDRESS);
    expect(await vault.protocolFeeCollector()).to.equal(ZERO_ADDRESS);
  });

  it('non-admin cannot set protocol fee collector', async () => {
    await expect(vault.connect(other).setProtocolFeeCollector(collector.address)).to.be.revertedWith(
      'Caller is not the admin'
    );
  });

  describe('protocol fee charged', () => {
    beforeEach(async () => {
      const pool = await deploy('MockPool', { args: [vault.address, SimplifiedQuotePool] });
      await vault.connect(lp).addUserAgent(pool.address);

      await pool.connect(lp).registerTokens([tokens.DAI.address, tokens.MKR.address]);

      await pool
        .connect(lp)
        .addLiquidity([tokens.DAI.address, tokens.MKR.address], [(5e18).toString(), (10e18).toString()]);

      // Set a non-zero withdraw fee
      await vault.connect(admin).setProtocolWithdrawFee((0.01e18).toString());

      // Remove liquidity - exit fees will be charged
      await pool.connect(lp).removeLiquidity([tokens.DAI.address], [(5e18).toString()]);
      await pool.connect(lp).removeLiquidity([tokens.MKR.address], [(10e18).toString()]);
    });

    it('reports collected fee correctly', async () => {
      expect((await vault.getCollectedFeesByToken(tokens.DAI.address)).toString()).to.equal((0.05e18).toString());
      expect((await vault.getCollectedFeesByToken(tokens.MKR.address)).toString()).to.equal((0.1e18).toString());
    });

    it('anybody can withdraw protocol fees to the collector address', async () => {
      await vault.connect(admin).setProtocolFeeCollector(collector.address);
      await expectBalanceChange(
        () =>
          vault
            .connect(other)
            .withdrawProtocolFees(
              [tokens.DAI.address, tokens.MKR.address],
              [(0.02e18).toString(), (0.04e18).toString()]
            ),
        tokens,
        { account: collector, changes: { DAI: (0.02e18).toString(), MKR: (0.04e18).toString() } }
      );

      expect((await vault.getCollectedFeesByToken(tokens.DAI.address)).toString()).to.equal((0.03e18).toString());
      expect((await vault.getCollectedFeesByToken(tokens.MKR.address)).toString()).to.equal((0.06e18).toString());
    });

    it('protocol fees cannot be withdrawn if collector is not set', async () => {
      await expect(
        vault.connect(admin).withdrawProtocolFees([tokens.DAI.address], [BigNumber.from((0.03e18).toString()).add(1)])
      ).to.be.revertedWith('Protocol fee collector recipient is not set');
    });

    it('protocol fees cannot be over-withdrawn', async () => {
      await vault.connect(admin).setProtocolFeeCollector(collector.address);
      await expect(
        vault.connect(other).withdrawProtocolFees([tokens.DAI.address], [BigNumber.from((1e18).toString()).add(1)])
      ).to.be.revertedWith('Insufficient protocol fees');
    });
  });
});
