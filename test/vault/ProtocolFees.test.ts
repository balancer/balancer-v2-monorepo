import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '../helpers/models/tokens/TokenList';
import { sharedBeforeEach } from '../helpers/lib/sharedBeforeEach';
import { expectBalanceChange } from '../helpers/tokenBalance';

import { bn } from '../../lib/helpers/numbers';
import { roleId } from '../../lib/helpers/roles';
import { deploy } from '../../lib/helpers/deploy';

describe('Vault - protocol fees', () => {
  let admin: SignerWithAddress;
  let user: SignerWithAddress;
  let feeSetter: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let other: SignerWithAddress;

  let authorizer: Contract;
  let vault: Contract;
  let tokens: TokenList;

  before('setup', async () => {
    [, admin, user, feeSetter, feeCollector, other] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });

    tokens = await TokenList.create(['DAI', 'MKR']);
    await tokens.mint({ to: user, amount: bn(100e18) });
    await tokens.approve({ to: vault, from: user });
  });

  it('fees are initially zero', async () => {
    expect(await vault.getCollectedFees([tokens.DAI.address])).to.deep.equal([bn(0)]);
  });

  context('with collected protocol fees', () => {
    sharedBeforeEach(async () => {
      // Set a non-zero withdraw fee
      const role = roleId(vault, 'setProtocolFees');
      await authorizer.connect(admin).grantRole(role, feeSetter.address);
      await vault.connect(feeSetter).setProtocolFees(0, bn(0.01e18), 0);

      const transfersIn = [
        { token: tokens.DAI.address, amount: bn(20e18), sender: user.address, recipient: user.address },
        { token: tokens.MKR.address, amount: bn(20e18), sender: user.address, recipient: user.address },
      ];

      await vault.connect(user).depositToInternalBalance(transfersIn);

      const transfersOut = [
        { token: tokens.DAI.address, amount: bn(5e18), sender: user.address, recipient: user.address },
        { token: tokens.MKR.address, amount: bn(10e18), sender: user.address, recipient: user.address },
      ];

      // Withdraw internal balance - this will cause withdraw fees to be charged
      await vault.connect(user).withdrawFromInternalBalance(transfersOut);
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
