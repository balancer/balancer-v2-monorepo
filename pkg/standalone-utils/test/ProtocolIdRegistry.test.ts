import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('ProtocolIdRegistry', () => {
  let admin: SignerWithAddress, authorizedUser: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let registry: Contract;

  before(async () => {
    [, admin, authorizedUser, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault and ProtocolIdRegistry', async () => {
    ({ instance: vault, authorizer } = await Vault.create({ admin }));
    registry = await deploy('ProtocolIdRegistry', {
      args: [vault.address],
    });
  });

  sharedBeforeEach('grant permissions', async () => {
    await authorizer
      .connect(admin)
      .grantPermission(actionId(registry, 'registerProtocolId'), authorizedUser.address, registry.address);
    await authorizer
      .connect(admin)
      .grantPermission(actionId(registry, 'renameProtocolId'), authorizedUser.address, registry.address);
  });

  describe('Constructor', () => {
    it('events are emitted for protocols initialized in the constructor', async () => {
      expect(
        await deploy('ProtocolIdRegistry', {
          args: [vault.address],
        })
      ).to.emit('ProtocolIdRegistry', 'ProtocolIdRegistered');
    });

    context('Aave v1 protocol is registered with protocol id 0', async () => {
      it('Protocol Id is valid', async () => {
        expect(await registry.isValidProtocolId(0)).to.equal(true);
      });

      it('Protocol name is correct', async () => {
        expect(await registry.getProtocolName(0)).to.equal('Aave v1');
      });
    });
  });

  describe('Registration', () => {
    const newProtocolId = 1000000000;
    const newProtocolName = 'Test Protocol';
    let transactionReceipt: ContractReceipt;

    context('authorized user', async () => {
      sharedBeforeEach('register protocol', async () => {
        transactionReceipt = await (
          await registry.connect(authorizedUser).registerProtocolId(newProtocolId, newProtocolName)
        ).wait();
      });

      it('event emitted', async () => {
        expectEvent.inReceipt(transactionReceipt, 'ProtocolIdRegistered', {
          protocolId: newProtocolId,
          name: newProtocolName,
        });
      });

      it('new ID is valid', async () => {
        expect(await registry.isValidProtocolId(newProtocolId)).to.equal(true);
      });

      it('name matches ID', async () => {
        expect(await registry.getProtocolName(newProtocolId)).to.equal(newProtocolName);
      });

      it('reverts when registering existing ID', async () => {
        await expect(registry.connect(authorizedUser).registerProtocolId(0, 'Test Protocol')).to.be.revertedWith(
          'Protocol ID already registered'
        );
      });
    });

    context('non-authorized user', async () => {
      it('registration gets reverted', async () => {
        await expect(registry.connect(other).registerProtocolId(newProtocolId, newProtocolName)).to.be.revertedWith(
          'BAL#401'
        );
      });
    });
  });

  describe('Unregistered queries', () => {
    it('searching for name in non-existent protocol ID', async () => {
      await expect(registry.getProtocolName(MAX_UINT256)).to.be.revertedWith('Non-existent protocol ID');
    });

    it('check non-valid ID', async () => {
      expect(await registry.isValidProtocolId(MAX_UINT256)).to.equal(false);
    });
  });

  describe('rename protocol IDs', async () => {
    const targetProtocolId = 0;
    const newProtocolName = 'Test Protocol';
    let transactionReceipt: ContractReceipt;

    context('when the user is authorized to rename', async () => {
      sharedBeforeEach('rename protocol', async () => {
        await expect(registry.getProtocolName(targetProtocolId)).to.not.equal(newProtocolName);
        transactionReceipt = await (
          await registry.connect(authorizedUser).renameProtocolId(targetProtocolId, newProtocolName)
        ).wait();
      });

      it('emits an event', async () => {
        expectEvent.inReceipt(transactionReceipt, 'ProtocolIdRenamed', {
          protocolId: targetProtocolId,
          name: newProtocolName,
        });
      });

      it('renames existing protocol ID', async () => {
        expect(await registry.getProtocolName(targetProtocolId)).is.equal(newProtocolName);
      });

      it('reverts renaming non-existing protocol ID', async () => {
        await expect(
          registry.connect(authorizedUser).renameProtocolId(MAX_UINT256, newProtocolName)
        ).to.be.revertedWith('Protocol ID not registered');
      });
    });

    context('when the user is not authorized to rename', async () => {
      it('reverts', async () => {
        await expect(registry.connect(other).renameProtocolId(targetProtocolId, newProtocolName)).to.be.revertedWith(
          'BAL#401'
        );
      });
    });
  });
});
