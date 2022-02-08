import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expect } from 'chai';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { defaultAbiCoder } from 'ethers/lib/utils';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('AuthorizerAdaptor', () => {
  let vault: Vault;
  let authorizer: Contract;
  let adaptor: Contract;
  let admin: SignerWithAddress, grantee: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, grantee, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    vault = await Vault.create({ admin });
    if (!vault.authorizer) throw Error('Vault has no Authorizer');
    authorizer = vault.authorizer;
    adaptor = await deploy('AuthorizerAdaptor', { args: [vault.address] });
  });

  describe('constructor', () => {
    it('sets the vault address', async () => {
      expect(await adaptor.getVault()).to.be.eq(vault.address);
    });

    it('uses the authorizer of the vault', async () => {
      expect(await adaptor.getAuthorizer()).to.equal(authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      const action = await actionId(vault.instance, 'setAuthorizer');
      await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);

      await vault.instance.connect(admin).setAuthorizer(other.address);

      expect(await adaptor.getAuthorizer()).to.equal(other.address);
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

      expectedResult = defaultAbiCoder.encode(['address'], [await vault.instance.getProtocolFeesCollector()]);
    });

    context('when caller is authorized globally', () => {
      sharedBeforeEach('authorize caller globally', async () => {
        await authorizer.connect(admin).grantPermissions([action], grantee.address, [ANY_ADDRESS]);
      });

      it('performs the expected function call', async () => {
        const value = await adaptor.connect(grantee).callStatic.performAction(target, calldata);
        expect(value).to.be.eq(expectedResult);
      });
    });

    context('when caller is authorized locally on target', () => {
      sharedBeforeEach('authorize caller on target locally', async () => {
        await authorizer.connect(admin).grantPermissions([action], grantee.address, [vault.address]);
      });

      it('performs the expected function call', async () => {
        const value = await adaptor.connect(grantee).callStatic.performAction(target, calldata);

        expect(value).to.be.eq(expectedResult);
      });
    });

    context('when caller is authorized locally on a different target', () => {
      sharedBeforeEach('authorize caller on different target locally', async () => {
        await authorizer.connect(admin).grantPermissions([action], grantee.address, [other.address]);
      });

      it('reverts', async () => {
        await expect(adaptor.connect(grantee).performAction(target, calldata)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(adaptor.connect(other).performAction(target, calldata)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });
});
