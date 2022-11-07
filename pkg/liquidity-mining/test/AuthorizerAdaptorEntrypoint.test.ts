import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { expect } from 'chai';
import { defaultAbiCoder } from 'ethers/lib/utils';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

describe('AuthorizerAdaptorEntrypoint', () => {
  let vault: Contract;
  let authorizer: Contract;
  let adaptor: Contract;
  let entrypoint: Contract;
  let paymentReceiver: Contract;
  let admin: SignerWithAddress, grantee: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, grantee, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault with entrypoint', async () => {
    ({
      instance: vault,
      authorizer,
      authorizerAdaptor: adaptor,
      authorizerAdaptorEntrypoint: entrypoint,
    } = await Vault.create({ admin }));
  });

  sharedBeforeEach('deploy mock to receive payments', async () => {
    paymentReceiver = await deploy('MockPaymentReceiver');
  });

  describe('constructor', () => {
    it('sets the vault address', async () => {
      expect(await entrypoint.getVault()).to.be.eq(vault.address);
    });

    it('sets the adaptor address', async () => {
      expect(await entrypoint.getAuthorizerAdaptor()).to.equal(adaptor.address);
    });

    it('uses the authorizer of the vault', async () => {
      expect(await entrypoint.getAuthorizer()).to.equal(authorizer.address);
    });

    it('returns the same action ID as the adaptor', async () => {
      expect(await entrypoint.getActionId('0xaabbccdd')).to.equal(await adaptor.getActionId('0xaabbccdd'));
    });

    it('tracks authorizer changes in the vault', async () => {
      const action = await actionId(vault, 'setAuthorizer');
      await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);

      await vault.connect(admin).setAuthorizer(other.address);

      expect(await entrypoint.getAuthorizer()).to.equal(other.address);
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
      calldata = vault.interface.encodeFunctionData('getProtocolFeesCollector');

      expectedResult = defaultAbiCoder.encode(['address'], [await vault.getProtocolFeesCollector()]);
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
        const value = await entrypoint.connect(grantee).callStatic.performAction(target, calldata);
        expect(value).to.be.eq(expectedResult);
      });

      it('sends value to target contract correctly', async () => {
        const value = await entrypoint
          .connect(grantee)
          .callStatic.performAction(payableTarget, payableCalldata, { value: payment });
        expect(value).to.be.eq(payableExpectedResult);
      });

      it('rejects direct calls from the adaptor', async () => {
        // The authorizer will reject calls that are not initiated in the adaptor entrypoint.
        await expect(adaptor.connect(grantee).performAction(target, calldata)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    }

    context('when caller is authorized globally', () => {
      sharedBeforeEach('authorize caller globally', async () => {
        await authorizer.connect(admin).grantPermissions([action], grantee.address, [ANY_ADDRESS]);
        await authorizer.connect(admin).grantPermissions([payableAction], grantee.address, [ANY_ADDRESS]);
      });

      itHandlesFunctionCallsCorrectly();
    });

    context('when caller is authorized locally on target', () => {
      sharedBeforeEach('authorize caller on target locally', async () => {
        await authorizer.connect(admin).grantPermissions([action], grantee.address, [vault.address]);
        await authorizer.connect(admin).grantPermissions([payableAction], grantee.address, [paymentReceiver.address]);
      });

      itHandlesFunctionCallsCorrectly();
    });

    context('when caller is authorized locally on a different target', () => {
      sharedBeforeEach('authorize caller on different target locally', async () => {
        await authorizer.connect(admin).grantPermissions([action], grantee.address, [other.address]);
      });

      it('reverts', async () => {
        await expect(entrypoint.connect(grantee).performAction(target, calldata)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(entrypoint.connect(other).performAction(target, calldata)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('when calldata is invalid', () => {
      it('reverts', async () => {
        await expect(entrypoint.connect(other).performAction(target, '0x')).to.be.reverted;
      });
    });
  });
});
