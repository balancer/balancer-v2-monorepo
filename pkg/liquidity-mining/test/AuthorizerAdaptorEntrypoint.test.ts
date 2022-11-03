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

describe('AuthorizerAdaptorEntrypoint', () => {
  let vault: Contract;
  let authorizer: Contract;
  let adaptor: Contract;
  let entrypoint: Contract;
  let admin: SignerWithAddress, grantee: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, grantee, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault with entrypoint', async () => {
    ({ instance: vault, authorizer, authorizerAdaptor: adaptor } = await Vault.create({ admin }));

    // TODO(@jubeira): initialize entrypoint and adaptor inside helpers.
    entrypoint = await deploy('AuthorizerAdaptorEntrypoint', { args: [adaptor.address] });
    await authorizer.setAdaptorEntrypoint(entrypoint.address);
  });

  describe('constructor', () => {
    it('sets the vault address', async () => {
      expect(await entrypoint.getVault()).to.be.eq(vault.address);
    });

    it('uses the authorizer of the vault', async () => {
      expect(await entrypoint.getAuthorizer()).to.equal(authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      const action = await actionId(vault, 'setAuthorizer');
      await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);

      await vault.connect(admin).setAuthorizer(other.address);

      expect(await entrypoint.getAuthorizer()).to.equal(other.address);
    });
  });

  describe('performAction', () => {
    let action: string;
    let target: string;
    let calldata: string;
    let expectedResult: string;

    sharedBeforeEach('prepare action', async () => {
      action = await actionId(adaptor, 'getProtocolFeesCollector', vault.interface);

      target = vault.address;
      calldata = vault.interface.encodeFunctionData('getProtocolFeesCollector');

      expectedResult = defaultAbiCoder.encode(['address'], [await vault.getProtocolFeesCollector()]);
    });

    context('when caller is authorized globally', () => {
      sharedBeforeEach('authorize caller globally', async () => {
        await authorizer.connect(admin).grantPermissions([action], grantee.address, [ANY_ADDRESS]);
      });

      it('performs the expected function call', async () => {
        const value = await entrypoint.connect(grantee).callStatic.performAction(target, calldata);
        expect(value).to.be.eq(expectedResult);
      });
    });

    context('when caller is authorized locally on target', () => {
      sharedBeforeEach('authorize caller on target locally', async () => {
        await authorizer.connect(admin).grantPermissions([action], grantee.address, [vault.address]);
      });

      it('performs the expected function call', async () => {
        const value = await entrypoint.connect(grantee).callStatic.performAction(target, calldata);

        expect(value).to.be.eq(expectedResult);
      });
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
