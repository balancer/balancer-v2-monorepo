import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { expect } from 'chai';
import { defaultAbiCoder } from 'ethers/lib/utils';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

describe('AuthorizerAdaptorEntrypoint', () => {
  let vault: Vault;
  let authorizer: Contract;
  let adaptor: Contract;
  let adaptorEntrypoint: Contract;
  let paymentReceiver: Contract;
  let admin: SignerWithAddress, grantee: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, grantee, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault with adaptorEntrypoint', async () => {
    vault = await Vault.create({ admin });
    authorizer = vault.authorizer;
    adaptor = vault.authorizerAdaptor;
    adaptorEntrypoint = vault.authorizerAdaptorEntrypoint;
  });

  sharedBeforeEach('deploy mock to receive payments', async () => {
    paymentReceiver = await deploy('MockPaymentReceiver');
  });

  describe('constructor', () => {
    it('sets the vault address', async () => {
      expect(await adaptorEntrypoint.getVault()).to.be.eq(vault.address);
    });

    it('sets the adaptor address', async () => {
      expect(await adaptorEntrypoint.getAuthorizerAdaptor()).to.equal(adaptor.address);
    });

    it('uses the authorizer of the vault', async () => {
      expect(await adaptorEntrypoint.getAuthorizer()).to.equal(authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      await vault.setAuthorizer(other);

      expect(await adaptorEntrypoint.getAuthorizer()).to.equal(other.address);
    });

    it('returns the same action ID as the adaptor', async () => {
      expect(await adaptorEntrypoint.getActionId('0xaabbccdd')).to.equal(await adaptor.getActionId('0xaabbccdd'));
    });
  });

  describe('performAction', () => {
    let action: string, payableAction: string;
    let target: string, payableTarget: string;
    let calldata: string, payableCalldata: string;
    let expectedResult: string, payableExpectedResult: string;
    const payment = fp(0.3141516);

    sharedBeforeEach('prepare action', async () => {
      action = await actionId(adaptor, 'getProtocolFeesCollector', vault.interface);

      target = vault.address;
      // Function selector and some random extra info as calldata.
      // The extra bytes are not required to perform the call, but for testing purposes it's better if the selector
      // does not match the entire calldata.
      calldata = vault.interface.encodeFunctionData('getProtocolFeesCollector').concat('aabbccddeeff');

      expectedResult = defaultAbiCoder.encode(['address'], [await vault.instance.getProtocolFeesCollector()]);
    });

    sharedBeforeEach('prepare payable action', async () => {
      payableAction = await actionId(adaptor, 'receivePayment', paymentReceiver.interface);

      payableTarget = paymentReceiver.address;
      payableCalldata = paymentReceiver.interface.encodeFunctionData('receivePayment');

      payableExpectedResult = defaultAbiCoder.encode(
        ['uint256'],
        [await paymentReceiver.callStatic.receivePayment({ value: payment })]
      );
    });

    function itHandlesFunctionCallsCorrectly() {
      it('performs the expected function call', async () => {
        const value = await adaptorEntrypoint.connect(grantee).callStatic.performAction(target, calldata);
        expect(value).to.be.eq(expectedResult);
      });

      it('sends value to target contract correctly', async () => {
        const value = await adaptorEntrypoint
          .connect(grantee)
          .callStatic.performAction(payableTarget, payableCalldata, { value: payment });
        expect(value).to.be.eq(payableExpectedResult);
      });

      it('rejects direct calls from the adaptor', async () => {
        // The authorizer will reject calls that are not initiated in the adaptor adaptorEntrypoint.
        await expect(adaptor.connect(grantee).performAction(target, calldata)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });

      it('emits an event describing the performed action', async () => {
        const tx = await adaptorEntrypoint.connect(grantee).performAction(target, calldata);
        expectEvent.inReceipt(await tx.wait(), 'ActionPerformed', {
          selector: vault.interface.getSighash('getProtocolFeesCollector'),
          caller: grantee.address,
          target,
          data: calldata,
        });
      });
    }

    context('when caller is authorized globally', () => {
      sharedBeforeEach('authorize caller globally', async () => {
        await authorizer.connect(admin).grantPermission(action, grantee.address, ANY_ADDRESS);
        await authorizer.connect(admin).grantPermission(payableAction, grantee.address, ANY_ADDRESS);
      });

      itHandlesFunctionCallsCorrectly();
    });

    context('when caller is authorized locally on target', () => {
      sharedBeforeEach('authorize caller on target locally', async () => {
        await authorizer.connect(admin).grantPermission(action, grantee.address, vault.address);
        await authorizer.connect(admin).grantPermission(payableAction, grantee.address, paymentReceiver.address);
      });

      itHandlesFunctionCallsCorrectly();
    });

    context('when caller is authorized locally on a different target', () => {
      sharedBeforeEach('authorize caller on different target locally', async () => {
        await authorizer.connect(admin).grantPermission(action, grantee.address, other.address);
      });

      it('reverts', async () => {
        await expect(adaptorEntrypoint.connect(grantee).performAction(target, calldata)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(adaptorEntrypoint.connect(other).performAction(target, calldata)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('when calldata is invalid', () => {
      it('reverts', async () => {
        await expect(adaptorEntrypoint.connect(other).performAction(target, '0x')).to.be.revertedWith(
          'INSUFFICIENT_DATA'
        );
      });
    });
  });
});
