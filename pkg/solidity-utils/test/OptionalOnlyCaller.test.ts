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

  context('when the only caller check is disabled', () => {
    it('allows the user to call', async () => {
      const tx = await optionalOnlyCaller.connect(user).testFunction(user.address);
      const receipt = await tx.wait();
      expectEvent.inReceipt(receipt, 'TestFunctionCalled', { user: user.address });
    });

    it('allows other accounts to call', async () => {
      const tx = await optionalOnlyCaller.connect(other).testFunction(user.address);
      const receipt = await tx.wait();
      expectEvent.inReceipt(receipt, 'TestFunctionCalled', { user: user.address });
    });

    it('emits an event when enabling only caller check', async () => {
      const txOn = await optionalOnlyCaller.connect(user).setOnlyCallerCheck(true);
      const receiptOn = await txOn.wait();
      expectEvent.inReceipt(receiptOn, 'OnlyCallerOptIn', { user: user.address, enabled: true });
    });

    it('returns false when only caller check is queried for user', async () => {
      expect(await optionalOnlyCaller.isOnlyCallerEnabled(user.address)).to.be.false;
    });
  });

  context('when the only caller check is enabled', () => {
    beforeEach('deploy optional only caller mock and enable only caller checks', async () => {
      await optionalOnlyCaller.connect(user).setOnlyCallerCheck(true);
    });

    it('allows the user to call', async () => {
      const tx = await optionalOnlyCaller.connect(user).testFunction(user.address);
      const receipt = await tx.wait();
      expectEvent.inReceipt(receipt, 'TestFunctionCalled', { user: user.address });
    });

    it('reverts when the caller is other account', async () => {
      await expect(optionalOnlyCaller.connect(other).testFunction(user.address)).to.be.revertedWith(
        'SENDER_NOT_ALLOWED'
      );
    });

    it('allows other accounts to call after user disables checks', async () => {
      await optionalOnlyCaller.connect(user).setOnlyCallerCheck(false);
      const tx = await optionalOnlyCaller.connect(other).testFunction(user.address);
      const receipt = await tx.wait();
      expectEvent.inReceipt(receipt, 'TestFunctionCalled', { user: user.address });
    });

    it('emits an event when disabling only caller check', async () => {
      const txOff = await optionalOnlyCaller.connect(user).setOnlyCallerCheck(false);
      const receiptOff = await txOff.wait();
      expectEvent.inReceipt(receiptOff, 'OnlyCallerOptIn', { user: user.address, enabled: false });
    });

    it('returns true when only caller check is queried for user', async () => {
      expect(await optionalOnlyCaller.isOnlyCallerEnabled(user.address)).to.be.true;
    });
  });
});
