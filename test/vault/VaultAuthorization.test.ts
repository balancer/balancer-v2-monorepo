import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import * as expectEvent from '../helpers/expectEvent';
import { deploy } from '../../lib/helpers/deploy';
import { roleId } from '../../lib/helpers/roles';
import { ZERO_ADDRESS } from '../../lib/helpers/constants';

describe('VaultAuthorization', function () {
  let authorizer: Contract, vault: Contract;
  let admin: SignerWithAddress, other: SignerWithAddress;
  let relayer: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, other, relayer] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
  });

  async function deployVault(authorizer: string): Promise<Contract> {
    return deploy('Vault', { args: [authorizer, ZERO_ADDRESS, 0, 0] });
  }

  describe('authorizer', () => {
    it('has an initial authorizer', async () => {
      const vault = await deployVault(authorizer.address);

      expect(await vault.getAuthorizer()).to.equal(authorizer.address);
    });

    it('can be initialized to the zero address', async () => {
      const vault = await deployVault(ZERO_ADDRESS);

      expect(await vault.getAuthorizer()).to.equal(ZERO_ADDRESS);
    });
  });

  describe('with relayer', () => {
    sharedBeforeEach('deploy vault', async () => {
      vault = await deployVault(authorizer.address);
    });

    context('change relayer allowance', () => {
      sharedBeforeEach('grant permission', async () => {
        const role = roleId(vault, 'manageUserBalance');
        await authorizer.connect(admin).grantRole(role, relayer.address);
        // User has to allow relayer
        await vault.connect(other).changeRelayerAllowance(other.address, relayer.address, true);
      });

      it('should emit an event when changing relayer allowance', async () => {
        const receipt = await (
          await vault.connect(other).changeRelayerAllowance(other.address, relayer.address, false)
        ).wait();
        expectEvent.inReceipt(receipt, 'RelayerAllowanceChanged', {
          relayer: relayer.address,
          sender: other.address,
          allowed: false,
        });
      });
    });
  });

  describe('change authorizer', () => {
    sharedBeforeEach('deploy vault', async () => {
      vault = await deployVault(authorizer.address);
    });

    context('when the sender is has the role to do it', () => {
      let role: string;

      sharedBeforeEach('grant permission', async () => {
        role = roleId(vault, 'changeAuthorizer');
        await authorizer.connect(admin).grantRole(role, admin.address);
      });

      it('can change the authorizer to another address', async () => {
        expect(await authorizer.hasRole(role, admin.address)).to.be.true;

        await vault.connect(admin).changeAuthorizer(other.address);

        expect(await vault.getAuthorizer()).to.equal(other.address);
      });

      it('emits an event when authorizer changed', async () => {
        expect(await authorizer.hasRole(role, admin.address)).to.be.true;

        const receipt = await (await vault.connect(admin).changeAuthorizer(other.address)).wait();
        expectEvent.inReceipt(receipt, 'AuthorizerChanged', {
          oldAuthorizer: authorizer.address,
          newAuthorizer: other.address,
        });
      });

      it('can change the authorizer to the zero address', async () => {
        expect(await authorizer.hasRole(role, admin.address)).to.be.true;

        await vault.connect(admin).changeAuthorizer(ZERO_ADDRESS);

        expect(await vault.getAuthorizer()).to.equal(ZERO_ADDRESS);
      });

      it('can not change the authorizer if the role was revoked', async () => {
        await authorizer.connect(admin).revokeRole(role, admin.address);

        expect(await authorizer.hasRole(role, admin.address)).to.be.false;

        await expect(vault.connect(admin).changeAuthorizer(other.address)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the sender does not have the role to do it', () => {
      it('reverts', async () => {
        await expect(vault.connect(other).changeAuthorizer(other.address)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });
});
