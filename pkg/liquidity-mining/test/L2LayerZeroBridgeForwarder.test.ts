import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { expect } from 'chai';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('L2LayerZeroBridgeForwarder', () => {
  let vault: Vault;
  let delegationImplementation: Contract;
  let forwarder: Contract;
  let admin: SignerWithAddress, user: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, user, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy forwarder', async () => {
    vault = await Vault.create();
    delegationImplementation = await deploy('MockL2LayerZeroDelegation');
    forwarder = await deploy('L2LayerZeroBridgeForwarder', { args: [vault.address] });
  });

  sharedBeforeEach(async () => {
    await vault.grantPermissionGlobally(await actionId(forwarder, 'setDelegation'), admin);
  });

  describe('setDelegation', () => {
    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(forwarder.connect(other).setDelegation(delegationImplementation.address)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('when caller is authorized', () => {
      it('sets delegation implementation', async () => {
        await forwarder.connect(admin).setDelegation(delegationImplementation.address);
        expect(await forwarder.getDelegationImplementation()).to.be.eq(delegationImplementation.address);
      });

      it('emits an event', async () => {
        const tx = await forwarder.connect(admin).setDelegation(delegationImplementation.address);
        expectEvent.inReceipt(await tx.wait(), 'DelegationImplementationUpdated', {
          newImplementation: delegationImplementation.address,
        });
      });
    });
  });

  describe('onVeBalBridged', () => {
    context('without delegation implementation', () => {
      it('does nothing', async () => {
        const receipt = await (await forwarder.onVeBalBridged(user.address)).wait();
        expect(receipt.events).to.be.empty; // This covers direct and indirect logs.
      });
    });

    context('with delegation implementation', () => {
      sharedBeforeEach(async () => {
        await forwarder.connect(admin).setDelegation(delegationImplementation.address);
      });

      it('calls the implementation hook', async () => {
        const tx = await forwarder.onVeBalBridged(user.address);
        expectEvent.inIndirectReceipt(await tx.wait(), delegationImplementation.interface, 'OnVeBalBridged', {
          user: user.address,
        });
      });
    });
  });

  describe('onVeBalSupplyUpdate', () => {
    context('without delegation implementation', () => {
      it('does nothing', async () => {
        const receipt = await (await forwarder.onVeBalSupplyUpdate()).wait();
        expect(receipt.events).to.be.empty; // This covers direct and indirect logs.
      });
    });

    context('with delegation implementation', () => {
      sharedBeforeEach(async () => {
        await forwarder.connect(admin).setDelegation(delegationImplementation.address);
      });

      it('calls the implementation hook', async () => {
        const tx = await forwarder.onVeBalSupplyUpdate();
        expectEvent.inIndirectReceipt(await tx.wait(), delegationImplementation.interface, 'OnVeBalSupplyUpdate');
      });
    });
  });
});
