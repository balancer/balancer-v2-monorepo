import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('OmniVotingEscrowAdaptor', function () {
  let vault: Vault;
  let omniVotingEscrow: Contract, omniVotingEscrowAdaptor: Contract;

  let admin: SignerWithAddress, user: SignerWithAddress, refunded: SignerWithAddress;

  before(async () => {
    [, admin, user, refunded] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    vault = await Vault.create({ admin });

    omniVotingEscrowAdaptor = await deploy('OmniVotingEscrowAdaptor', { args: [vault.address] });
    omniVotingEscrow = await deploy('MockOmniVotingEscrow');
  });

  describe('default getters', () => {
    it('omni voting escrow is zero address', async () => {
      expect(await omniVotingEscrowAdaptor.getOmniVotingEscrow()).to.be.eq(ZERO_ADDRESS);
    });

    it('use zero is false', async () => {
      expect(await omniVotingEscrowAdaptor.getUseZero()).to.be.false;
    });

    it('adapter params is empty', async () => {
      expect(await omniVotingEscrowAdaptor.getAdapterParams()).to.be.eq('0x');
    });

    it('zero payment address is zero address', async () => {
      expect(await omniVotingEscrowAdaptor.getZeroPaymentAddress()).to.be.eq(ZERO_ADDRESS);
    });
  });

  describe('setOmniVotingEscrow', () => {
    context('without permissions', () => {
      it('reverts', async () => {
        await expect(omniVotingEscrowAdaptor.setOmniVotingEscrow(omniVotingEscrow.address)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('with permissions', () => {
      sharedBeforeEach(async () => {
        await vault.grantPermissionGlobally(await actionId(omniVotingEscrowAdaptor, 'setOmniVotingEscrow'), admin);
      });

      it('sets omni voting escrow', async () => {
        await omniVotingEscrowAdaptor.connect(admin).setOmniVotingEscrow(omniVotingEscrow.address);
        expect(await omniVotingEscrowAdaptor.getOmniVotingEscrow()).to.be.eq(omniVotingEscrow.address);
      });

      it('emits an event', async () => {
        const tx = await omniVotingEscrowAdaptor.connect(admin).setOmniVotingEscrow(omniVotingEscrow.address);
        expectEvent.inReceipt(await tx.wait(), 'OmniVotingEscrowUpdated', {
          newOmniVotingEscrow: omniVotingEscrow.address,
        });
      });
    });
  });

  describe('setUseZero', () => {
    context('without permissions', () => {
      it('reverts', async () => {
        await expect(omniVotingEscrowAdaptor.setUseZero(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('with permissions', () => {
      sharedBeforeEach(async () => {
        await vault.grantPermissionGlobally(await actionId(omniVotingEscrowAdaptor, 'setUseZero'), admin);
      });

      it('sets useZero', async () => {
        await omniVotingEscrowAdaptor.connect(admin).setUseZero(true);
        expect(await omniVotingEscrowAdaptor.getUseZero()).to.be.true;
      });

      it('emits an event', async () => {
        const tx = await omniVotingEscrowAdaptor.connect(admin).setUseZero(true);
        expectEvent.inReceipt(await tx.wait(), 'UseZeroUpdated', {
          newUseZero: true,
        });
      });
    });
  });

  describe('setAdapterParams', () => {
    const newAdapterParams = '0x1234abcd';

    context('without permissions', () => {
      it('reverts', async () => {
        await expect(omniVotingEscrowAdaptor.setAdapterParams(newAdapterParams)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('with permissions', () => {
      sharedBeforeEach(async () => {
        await vault.grantPermissionGlobally(await actionId(omniVotingEscrowAdaptor, 'setAdapterParams'), admin);
      });

      it('sets adapterParams', async () => {
        await omniVotingEscrowAdaptor.connect(admin).setAdapterParams(newAdapterParams);
        expect(await omniVotingEscrowAdaptor.getAdapterParams()).to.be.eq(newAdapterParams);
      });

      it('emits an event', async () => {
        const tx = await omniVotingEscrowAdaptor.connect(admin).setAdapterParams(newAdapterParams);
        expectEvent.inReceipt(await tx.wait(), 'AdapterParamsUpdated', {
          newAdapterParams,
        });
      });
    });
  });

  describe('setZeroPaymentAddress', () => {
    const newZeroPaymentAddress = ANY_ADDRESS;

    context('without permissions', () => {
      it('reverts', async () => {
        await expect(omniVotingEscrowAdaptor.setZeroPaymentAddress(newZeroPaymentAddress)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('with permissions', () => {
      sharedBeforeEach(async () => {
        await vault.grantPermissionGlobally(await actionId(omniVotingEscrowAdaptor, 'setZeroPaymentAddress'), admin);
      });

      it('sets zeroPaymentAddress', async () => {
        await omniVotingEscrowAdaptor.connect(admin).setZeroPaymentAddress(newZeroPaymentAddress);
        expect(await omniVotingEscrowAdaptor.getZeroPaymentAddress()).to.be.eq(newZeroPaymentAddress);
      });

      it('emits an event', async () => {
        const tx = await omniVotingEscrowAdaptor.connect(admin).setZeroPaymentAddress(newZeroPaymentAddress);
        expectEvent.inReceipt(await tx.wait(), 'ZeroPaymentAddressUpdated', {
          newZeroPaymentAddress,
        });
      });
    });
  });

  // `estimateSendUserBalance` is a view function, so we can't emit an event and inspect the arguments received by the
  // omni voting escrow.
  describe('estimateSendUserBalance', () => {
    const mockOmniVotingEscrowNativeFee = 4321;
    const chainId = 157;

    context('when omni voting escrow is not set', () => {
      it('reverts', async () => {
        await expect(omniVotingEscrowAdaptor.estimateSendUserBalance(chainId)).to.be.revertedWith(
          'Omni voting escrow not set'
        );
      });
    });

    context('when omni voting escrow is set', () => {
      sharedBeforeEach(async () => {
        await vault.grantPermissionGlobally(await actionId(omniVotingEscrowAdaptor, 'setOmniVotingEscrow'), admin);
        await omniVotingEscrowAdaptor.connect(admin).setOmniVotingEscrow(omniVotingEscrow.address);
        await omniVotingEscrow.setNativeFee(mockOmniVotingEscrowNativeFee, chainId);
      });

      it('returns native fee from omni voting escrow', async () => {
        expect(await omniVotingEscrowAdaptor.estimateSendUserBalance(chainId)).to.be.deep.eq([
          mockOmniVotingEscrowNativeFee,
          0,
        ]);
      });
    });
  });

  describe('sendUserBalance', () => {
    const chainId = 157;
    const zeroPaymentAddress = ANY_ADDRESS;
    const adapterParams = '0xada01234';
    const value = 8432;

    context('when omni voting escrow is not set', () => {
      it('reverts', async () => {
        await expect(
          omniVotingEscrowAdaptor.sendUserBalance(user.address, chainId, refunded.address, { value })
        ).to.be.revertedWith('Omni voting escrow not set');
      });
    });

    context('when omni voting escrow is set', () => {
      sharedBeforeEach(async () => {
        await vault.grantPermissionGlobally(await actionId(omniVotingEscrowAdaptor, 'setOmniVotingEscrow'), admin);
        await vault.grantPermissionGlobally(await actionId(omniVotingEscrowAdaptor, 'setZeroPaymentAddress'), admin);
        await vault.grantPermissionGlobally(await actionId(omniVotingEscrowAdaptor, 'setAdapterParams'), admin);
        await omniVotingEscrowAdaptor.connect(admin).setOmniVotingEscrow(omniVotingEscrow.address);
        await omniVotingEscrowAdaptor.connect(admin).setZeroPaymentAddress(zeroPaymentAddress);
        await omniVotingEscrowAdaptor.connect(admin).setAdapterParams(adapterParams);
      });

      it('calls sendUserBalance in omni voting escrow', async () => {
        const tx = await omniVotingEscrowAdaptor.sendUserBalance(user.address, chainId, refunded.address, { value });
        expectEvent.inIndirectReceipt(await tx.wait(), omniVotingEscrow.interface, 'SendUserBalance', {
          user: user.address,
          chainId,
          refundAddress: refunded.address,
          zroPaymentAddress: zeroPaymentAddress,
          adapterParams,
          value,
        });
      });
    });
  });
});
