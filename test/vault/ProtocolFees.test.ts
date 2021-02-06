import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { bn } from '../../lib/helpers/numbers';
import { MAX_UINT256 } from '../../lib/helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deployTokens, mintTokens } from '../../lib/helpers/tokens';
import { roleId } from '../../lib/helpers/roles';

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
    expect(await vault.getCollectedFees([tokens.DAI.address])).to.deep.equal([bn(0)]);
  });

  context('with collected protocol fees', () => {
    beforeEach(async () => {
      // Set a non-zero withdraw fee
      const role = roleId(vault, 'setProtocolFees');
      await authorizer.connect(admin).grantRole(role, feeSetter.address);
      await vault.connect(feeSetter).setProtocolFees(0, bn(0.01e18), 0);

      await vault.connect(user).depositToInternalBalance(user.address, [tokens.DAI.address], [bn(20e18)], user.address);
      await vault.connect(user).depositToInternalBalance(user.address, [tokens.MKR.address], [bn(20e18)], user.address);

      // Withdraw internal balance - this will cause withdraw fees to be charged
      await vault
        .connect(user)
        .withdrawFromInternalBalance(user.address, [tokens.DAI.address], [bn(5e18)], user.address);
      await vault
        .connect(user)
        .withdrawFromInternalBalance(user.address, [tokens.MKR.address], [bn(10e18)], user.address);
    });

    it('reports collected fee', async () => {
      expect(await vault.getCollectedFees([tokens.DAI.address])).to.deep.equal([bn(0.05e18)]);
      expect(await vault.getCollectedFees([tokens.MKR.address])).to.deep.equal([bn(0.1e18)]);
    });

    it('authorized accounts can withdraw protocol fees to any recipient', async () => {
      const role = roleId(vault, 'withdrawCollectedFees');
      await authorizer.connect(admin).grantRole(role, feeCollector.address);

      await expectBalanceChange(
        () =>
          vault
            .connect(feeCollector)
            .withdrawCollectedFees([tokens.DAI.address, tokens.MKR.address], [bn(0.02e18), bn(0.04e18)], other.address),
        tokens,
        { account: other, changes: { DAI: bn(0.02e18), MKR: bn(0.04e18) } }
      );

      expect(await vault.getCollectedFees([tokens.DAI.address])).to.deep.equal([bn(0.03e18)]);
      expect(await vault.getCollectedFees([tokens.MKR.address])).to.deep.equal([bn(0.06e18)]);
    });

    it('protocol fees cannot be over-withdrawn', async () => {
      const role = roleId(vault, 'withdrawCollectedFees');

      await authorizer.connect(admin).grantRole(role, feeCollector.address);

      await expect(
        vault.connect(feeCollector).withdrawCollectedFees([tokens.DAI.address], [bn(0.05e18).add(1)], other.address)
      ).to.be.revertedWith('INSUFFICIENT_COLLECTED_FEES');
    });

    it('unauthorized accounts cannot withdraw collected fees', async () => {
      await expect(
        vault.connect(other).withdrawCollectedFees([tokens.DAI.address], [0], other.address)
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });
});
