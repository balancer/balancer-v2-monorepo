import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expect } from 'chai';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('SmartWalletChecker', () => {
  let vault: Vault;
  let smartWalletChecker: Contract;

  let admin: SignerWithAddress, caller: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, caller] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy SmartWalletChecker', async () => {
    vault = await Vault.create({ admin });

    smartWalletChecker = await deploy('SmartWalletChecker', { args: [vault.address, []] });
  });

  sharedBeforeEach('set up permissions', async () => {
    const allowAction = await actionId(smartWalletChecker, 'allowlistAddress');
    const denyAction = await actionId(smartWalletChecker, 'denylistAddress');
    await vault.grantPermissionsGlobally([allowAction, denyAction], admin);
  });

  describe('constructor', () => {
    context('when provided with an array of addresses', () => {
      it('adds them all to the allowlist', async () => {
        const initialAllowlistedAddresses = [ZERO_ADDRESS, ANY_ADDRESS];
        const smartWalletChecker = await deploy('SmartWalletChecker', {
          args: [vault.address, initialAllowlistedAddresses],
        });

        for (const address of initialAllowlistedAddresses) {
          expect(await smartWalletChecker.check(address)).to.be.true;
        }
      });
    });
  });

  describe('allowlistAddress', () => {
    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(smartWalletChecker.connect(caller).allowlistAddress(ANY_ADDRESS)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('when caller is authorized', () => {
      sharedBeforeEach('authorize caller', async () => {
        const action = await actionId(smartWalletChecker, 'allowlistAddress');
        await vault.grantPermissionsGlobally([action], caller);
      });

      context('when address is already allowlisted', () => {
        sharedBeforeEach('allowlist address', async () => {
          await smartWalletChecker.connect(caller).allowlistAddress(ANY_ADDRESS);
        });

        it('reverts', async () => {
          await expect(smartWalletChecker.connect(caller).allowlistAddress(ANY_ADDRESS)).to.be.revertedWith(
            'Address already allowlisted'
          );
        });
      });

      context('when address is not currently allowlisted', () => {
        it('updates the mapping of allowlisted addresses', async () => {
          expect(await smartWalletChecker.check(ANY_ADDRESS)).to.be.false;

          await smartWalletChecker.connect(caller).allowlistAddress(ANY_ADDRESS);

          expect(await smartWalletChecker.check(ANY_ADDRESS)).to.be.true;
        });

        it('emits a ContractAddressAdded event', async () => {
          const tx = await smartWalletChecker.connect(caller).allowlistAddress(ANY_ADDRESS);
          const receipt = await tx.wait();
          expectEvent.inReceipt(receipt, 'ContractAddressAdded', { contractAddress: ANY_ADDRESS });
        });
      });
    });
  });

  describe('denylistAddress', () => {
    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(smartWalletChecker.connect(caller).denylistAddress(ANY_ADDRESS)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('when caller is authorized', () => {
      sharedBeforeEach('authorize caller', async () => {
        const action = await actionId(smartWalletChecker, 'denylistAddress');
        await vault.grantPermissionsGlobally([action], caller);
      });

      context('when address is already denylisted', () => {
        it('reverts', async () => {
          await expect(smartWalletChecker.connect(caller).denylistAddress(ANY_ADDRESS)).to.be.revertedWith(
            'Address is not allowlisted'
          );
        });
      });

      context('when address is not currently denylisted', () => {
        sharedBeforeEach('allowlist address', async () => {
          await smartWalletChecker.connect(admin).allowlistAddress(ANY_ADDRESS);
        });

        it('updates the mapping of allowlisted addresses', async () => {
          expect(await smartWalletChecker.check(ANY_ADDRESS)).to.be.true;

          await smartWalletChecker.connect(caller).denylistAddress(ANY_ADDRESS);

          expect(await smartWalletChecker.check(ANY_ADDRESS)).to.be.false;
        });

        it('emits a ContractAddressRemoved event', async () => {
          const tx = await smartWalletChecker.connect(caller).denylistAddress(ANY_ADDRESS);
          const receipt = await tx.wait();
          expectEvent.inReceipt(receipt, 'ContractAddressRemoved', { contractAddress: ANY_ADDRESS });
        });
      });
    });
  });
});
