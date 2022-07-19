import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract, ContractReceipt } from 'ethers';
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

  describe('enable/disable', () => {
    function itEnablesAndDisablesTheCheck(set: (enable: boolean) => Promise<ContractReceipt>) {
      context('when disabled', () => {
        it('isOnlyCallerEnabled returns false', async () => {
          expect(await optionalOnlyCaller.isOnlyCallerEnabled(user.address)).to.be.false;
        });

        it('emits an event when enabling only caller check', async () => {
          const receipt = await set(true);
          expectEvent.inReceipt(receipt, 'OnlyCallerOptIn', { user: user.address, enabled: true });
        });
      });

      context('when enabled', () => {
        sharedBeforeEach('enable check', async () => {
          await set(true);
        });

        it('isOnlyCallerEnabled returns true', async () => {
          expect(await optionalOnlyCaller.isOnlyCallerEnabled(user.address)).to.be.true;
        });

        it('emits an event when disabling only caller check', async () => {
          const receipt = await set(false);
          expectEvent.inReceipt(receipt, 'OnlyCallerOptIn', { user: user.address, enabled: false });
        });
      });
    }

    describe('without signature', () => {
      itEnablesAndDisablesTheCheck(async (enabled: boolean) =>
        (await optionalOnlyCaller.connect(user).setOnlyCallerCheck(enabled)).wait()
      );
    });

    describe('with signature', () => {
      async function getSignature(enabled: boolean, user: SignerWithAddress): Promise<string> {
        const { chainId } = await optionalOnlyCaller.provider.getNetwork();

        const domain = {
          name: 'OptionalOnlyCallerMock',
          version: '1',
          chainId,
          verifyingContract: optionalOnlyCaller.address,
        };

        const types = {
          SetOnlyCallerCheck: [
            { name: 'user', type: 'address' },
            { name: 'enabled', type: 'bool' },
            { name: 'nonce', type: 'uint256' },
          ],
        };

        const values = {
          user: user.address,
          enabled,
          nonce: (await optionalOnlyCaller.getNextNonce(user.address)).toString(),
        };

        return user._signTypedData(domain, types, values);
      }

      itEnablesAndDisablesTheCheck(async (enabled: boolean) =>
        (
          await optionalOnlyCaller.setOnlyCallerCheckWithSignature(
            user.address,
            enabled,
            await getSignature(enabled, user)
          )
        ).wait()
      );
    });
  });

  describe('optionalOnlyCaller modifier', () => {
    context('when the only caller check is disabled', () => {
      it('allows the user to call', async () => {
        const tx = await optionalOnlyCaller.connect(user).testFunction(user.address);
        const receipt = await tx.wait();
        expectEvent.inReceipt(receipt, 'TestFunctionCalled');
      });

      it('allows other accounts to call', async () => {
        const tx = await optionalOnlyCaller.connect(other).testFunction(user.address);
        const receipt = await tx.wait();
        expectEvent.inReceipt(receipt, 'TestFunctionCalled');
      });
    });

    context('when the only caller check is enabled', () => {
      beforeEach('enable only caller checks', async () => {
        await optionalOnlyCaller.connect(user).setOnlyCallerCheck(true);
      });

      it('allows the user to call', async () => {
        const tx = await optionalOnlyCaller.connect(user).testFunction(user.address);
        const receipt = await tx.wait();
        expectEvent.inReceipt(receipt, 'TestFunctionCalled');
      });

      it('reverts when the caller is other account', async () => {
        await expect(optionalOnlyCaller.connect(other).testFunction(user.address)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });
  });
});
