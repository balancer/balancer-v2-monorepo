import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { TokenList, deployTokens, mintTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { bn } from '../helpers/numbers';

describe('Vault - protocol fees', () => {
  let admin: SignerWithAddress;
  let user: SignerWithAddress;
  let feeSetter: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let other: SignerWithAddress;

  let authorizer: Contract;
  let vault: Contract;
  let tokens: TokenList = {};

  before('setup', async () => {
    [, admin, user, feeSetter, feeCollector, other] = await ethers.getSigners();
  });

  beforeEach(async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });
    tokens = await deployTokens(['DAI', 'MKR'], [18, 18]);

    for (const symbol in tokens) {
      await mintTokens(tokens, symbol, user, 100e18);
      await tokens[symbol].connect(user).approve(vault.address, MAX_UINT256);
    }
  });

  it('fees are initially zero', async () => {
    expect(await vault.getCollectedFeesByToken(tokens.DAI.address)).to.equal(0);
  });

  context('with collected protocol fees', () => {
    beforeEach(async () => {
      // Set a non-zero withdraw fee
      await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_WITHDRAW_FEE_ROLE(), feeSetter.address);
      await vault.connect(feeSetter).setProtocolWithdrawFee((0.01e18).toString());

      await vault.connect(user).depositToInternalBalance(tokens.DAI.address, bn(20e18), user.address);
      await vault.connect(user).depositToInternalBalance(tokens.MKR.address, bn(20e18), user.address);

      // Withdraw internal balance - this will cause withdraw fees to be charged
      await vault.connect(user).withdrawFromInternalBalance(tokens.DAI.address, bn(5e18), user.address);
      await vault.connect(user).withdrawFromInternalBalance(tokens.MKR.address, bn(10e18), user.address);
    });

    it('reports collected fee', async () => {
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
