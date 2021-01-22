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
  let feeSetter: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let other: SignerWithAddress;

  let authorizer: Contract;
  let vault: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, admin, lp, feeSetter, feeCollector, other] = await ethers.getSigners();
  });

  beforeEach(async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });
    tokens = await deployTokens(['DAI', 'MKR'], [18, 18]);

    for (const symbol in tokens) {
      await mintTokens(tokens, symbol, lp, 100e18);
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);
    }
  });

  it('fees are initially zero', async () => {
    expect(await vault.getCollectedFeesByToken(tokens.DAI.address)).to.equal(0);
  });

  describe('protocol fee charged', () => {
    beforeEach(async () => {
      const pool = await deploy('MockPool', { args: [vault.address, SimplifiedQuotePool] });
      await vault.connect(lp).addUserAgent(pool.address);

      await pool.connect(lp).registerTokens([tokens.DAI.address, tokens.MKR.address], [ZERO_ADDRESS, ZERO_ADDRESS]);

      await pool
        .connect(lp)
        .addLiquidity([tokens.DAI.address, tokens.MKR.address], [(5e18).toString(), (10e18).toString()]);

      // Set a non-zero withdraw fee
      await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_WITHDRAW_FEE_ROLE(), feeSetter.address);
      await vault.connect(feeSetter).setProtocolWithdrawFee((0.01e18).toString());

      // Remove liquidity - withdraw fees will be charged
      await pool.connect(lp).removeLiquidity([tokens.DAI.address], [(5e18).toString()]);
      await pool.connect(lp).removeLiquidity([tokens.MKR.address], [(10e18).toString()]);
    });

    it('reports collected fee correctly', async () => {
      expect(await vault.getCollectedFeesByToken(tokens.DAI.address)).to.equal((0.05e18).toString());
      expect(await vault.getCollectedFeesByToken(tokens.MKR.address)).to.equal((0.1e18).toString());
    });

    it('authorized accounts can withdraw protocol fees to any recipient', async () => {
      await authorizer
        .connect(admin)
        .grantRole(await authorizer.WITHDRAW_PROTOCOL_FEES_ALL_TOKENS_ROLE(), feeCollector.address);

      await expectBalanceChange(
        () =>
          vault
            .connect(feeCollector)
            .withdrawProtocolFees(
              [tokens.DAI.address, tokens.MKR.address],
              [(0.02e18).toString(), (0.04e18).toString()],
              other.address
            ),
        tokens,
        { account: other, changes: { DAI: (0.02e18).toString(), MKR: (0.04e18).toString() } }
      );

      expect(await vault.getCollectedFeesByToken(tokens.DAI.address)).to.equal((0.03e18).toString());
      expect(await vault.getCollectedFeesByToken(tokens.MKR.address)).to.equal((0.06e18).toString());
    });

    it('protocol fees cannot be over-withdrawn', async () => {
      await authorizer
        .connect(admin)
        .grantRole(await authorizer.WITHDRAW_PROTOCOL_FEES_ALL_TOKENS_ROLE(), feeCollector.address);

      await expect(
        vault
          .connect(feeCollector)
          .withdrawProtocolFees([tokens.DAI.address], [BigNumber.from((0.05e18).toString()).add(1)], other.address)
      ).to.be.revertedWith('Insufficient protocol fees');
    });

    it('unauthorized accounts cannot withdraw protocol fees', async () => {
      await expect(
        vault.connect(other).withdrawProtocolFees([tokens.DAI.address], [0], other.address)
      ).to.be.revertedWith('Caller cannot withdraw protocol fees');
    });
  });
});
