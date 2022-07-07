import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('OptionalOnlyCaller', function () {
  let optionalOnlyCaller: Contract;
  let user: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, user, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy optional only caller mock', async () => {
    optionalOnlyCaller = await deploy('OptionalOnlyCallerMock');
  });

  context('when verification is disabled', () => {
    it('works when the caller is the user', async () => {
      const tx = await optionalOnlyCaller.connect(user).claimTokens(user.address);
      const receipt = await tx.wait();
      expectEvent.inReceipt(receipt, 'TokensClaimed', { user: user.address });
    });

    it('works when the caller is other', async () => {
      const tx = await optionalOnlyCaller.connect(other).claimTokens(user.address);
      const receipt = await tx.wait();
      expectEvent.inReceipt(receipt, 'TokensClaimed', { user: user.address });
    });

    it('emits events when enabling and disabling only caller feature', async () => {
      const txOn = await optionalOnlyCaller.connect(user).enableOnlyCaller(true);
      const receiptOn = await txOn.wait();
      expectEvent.inReceipt(receiptOn, 'OnlyCallerOptIn', { user: user.address, enabled: true });

      const txOff = await optionalOnlyCaller.connect(user).enableOnlyCaller(false);
      const receiptOff = await txOff.wait();
      expectEvent.inReceipt(receiptOff, 'OnlyCallerOptIn', { user: user.address, enabled: false });
    });
  });

  context('when verification is enabled', () => {
    beforeEach('deploy verifier mock and enable only caller verifications', async () => {
      await optionalOnlyCaller.connect(user).enableOnlyCaller(true);
    });

    it('works when the caller is the user', async () => {
      const tx = await optionalOnlyCaller.connect(user).claimTokens(user.address);
      const receipt = await tx.wait();
      expectEvent.inReceipt(receipt, 'TokensClaimed', { user: user.address });
    });

    it('reverts when the caller is the user', async () => {
      await expect(optionalOnlyCaller.connect(other).claimTokens(user.address)).to.be.revertedWith(
        'SENDER_NOT_ALLOWED'
      );
    });

    it('works when the caller is other after user disables verifications', async () => {
      await optionalOnlyCaller.connect(user).enableOnlyCaller(false);
      const tx = await optionalOnlyCaller.connect(other).claimTokens(user.address);
      const receipt = await tx.wait();
      expectEvent.inReceipt(receipt, 'TokensClaimed', { user: user.address });
    });
  });
});
