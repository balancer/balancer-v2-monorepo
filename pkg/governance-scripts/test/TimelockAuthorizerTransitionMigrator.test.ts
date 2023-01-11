import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('TimelockAuthorizerTransitionMigrator', () => {
  let root: SignerWithAddress, oldRoot: SignerWithAddress;
  let user1: SignerWithAddress, user2: SignerWithAddress, user3: SignerWithAddress;
  let vault: Contract, oldAuthorizer: Contract, newAuthorizer: Contract, transitionMigrator: Contract;
  let adaptorEntrypoint: Contract;

  before('set up signers', async () => {
    [, user1, user2, user3, oldRoot, root] = await ethers.getSigners();
  });

  interface RoleData {
    grantee: string;
    role: string;
    target: string;
  }

  let rolesData: RoleData[];
  const ROLE_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ROLE_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';
  const ROLE_3 = '0x0000000000000000000000000000000000000000000000000000000000000003';

  sharedBeforeEach('set up vault', async () => {
    oldAuthorizer = await deploy('v2-vault/MockBasicAuthorizer', { from: oldRoot });
    vault = await deploy('v2-vault/Vault', { args: [oldAuthorizer.address, ZERO_ADDRESS, 0, 0] });

    const authorizerAdaptor = await deploy('v2-liquidity-mining/AuthorizerAdaptor', { args: [vault.address] });
    adaptorEntrypoint = await deploy('v2-liquidity-mining/AuthorizerAdaptorEntrypoint', {
      args: [authorizerAdaptor.address],
    });
  });

  sharedBeforeEach('set up permissions', async () => {
    const target = await deploy('v2-vault/MockAuthenticatedContract', { args: [vault.address] });
    rolesData = [
      { grantee: user1.address, role: ROLE_1, target: target.address },
      { grantee: user2.address, role: ROLE_2, target: target.address },
      { grantee: user3.address, role: ROLE_3, target: ZERO_ADDRESS },
    ];
  });

  sharedBeforeEach('grant roles on old Authorizer', async () => {
    await oldAuthorizer
      .connect(oldRoot)
      .grantRolesToMany([ROLE_1, ROLE_2, ROLE_3], [user1.address, user2.address, user3.address]);
  });

  sharedBeforeEach('deploy new authorizer', async () => {
    newAuthorizer = await deploy('TimelockAuthorizer', { args: [root.address, adaptorEntrypoint.address, 0] });
  });

  sharedBeforeEach('deploy migrator', async () => {
    const args = [oldAuthorizer.address, newAuthorizer.address, rolesData];
    transitionMigrator = await deploy('TimelockAuthorizerTransitionMigrator', { args });
  });

  describe('constructor', () => {
    context('when attempting to migrate a role which does not exist on previous Authorizer', () => {
      let tempAuthorizer: Contract;

      sharedBeforeEach('set up vault', async () => {
        tempAuthorizer = await deploy('v2-vault/MockBasicAuthorizer');
      });

      it('reverts', async () => {
        const args = [tempAuthorizer.address, newAuthorizer.address, rolesData];
        await expect(deploy('TimelockAuthorizerTransitionMigrator', { args })).to.be.revertedWith('UNEXPECTED_ROLE');
      });
    });
  });

  describe('migrate permissions', () => {
    context('when the migrator is not a granter', () => {
      it('reverts', async () => {
        await expect(transitionMigrator.migratePermissions()).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the migrator is a granter', () => {
      sharedBeforeEach(async () => {
        await newAuthorizer
          .connect(root)
          .manageGranter(
            newAuthorizer.GENERAL_PERMISSION_SPECIFIER(),
            transitionMigrator.address,
            newAuthorizer.EVERYWHERE(),
            true
          );
        expect(
          await newAuthorizer.canGrant(
            newAuthorizer.GENERAL_PERMISSION_SPECIFIER(),
            transitionMigrator.address,
            newAuthorizer.EVERYWHERE()
          )
        ).to.be.true;
      });

      it('migrates all roles properly', async () => {
        await transitionMigrator.migratePermissions();
        for (const roleData of rolesData) {
          expect(await newAuthorizer.hasPermission(roleData.role, roleData.grantee, roleData.target)).to.be.true;
        }
      });

      it('reverts when trying to migrate more than once', async () => {
        await expect(transitionMigrator.migratePermissions()).to.not.be.reverted;
        await expect(transitionMigrator.migratePermissions()).to.be.revertedWith('ALREADY_MIGRATED');
      });

      it('renounces its granter permissions after migrating permissions', async () => {
        await expect(transitionMigrator.migratePermissions()).to.not.be.reverted;
        expect(
          await newAuthorizer.canGrant(
            newAuthorizer.GENERAL_PERMISSION_SPECIFIER(),
            transitionMigrator.address,
            newAuthorizer.EVERYWHERE()
          )
        ).to.be.false;
      });

      context('when a permission is revoked after contract creation time', () => {
        let roleRevokedData: RoleData;

        sharedBeforeEach('revoke one permission', async () => {
          roleRevokedData = rolesData[1];
          await oldAuthorizer.connect(oldRoot).revokeRole(roleRevokedData.role, roleRevokedData.grantee);
        });

        it('migrates all non-revoked permissions', async () => {
          await transitionMigrator.migratePermissions();
          for (const roleData of rolesData) {
            if (roleData === roleRevokedData) {
              expect(await newAuthorizer.hasPermission(roleData.role, roleData.grantee, roleData.target)).to.be.false;
            } else {
              expect(await newAuthorizer.hasPermission(roleData.role, roleData.grantee, roleData.target)).to.be.true;
            }
          }
        });

        it('emits an event for the revoked role', async () => {
          const tx = await transitionMigrator.migratePermissions();
          expectEvent.inReceipt(await tx.wait(), 'PermissionSkipped', { ...roleRevokedData });
        });
      });
    });
  });

  describe('roles data getter', () => {
    it('returns stored role data', async () => {
      for (let i = 0; i < rolesData.length; ++i) {
        const roleData = await transitionMigrator.rolesData(i);
        expect({ grantee: roleData.grantee, role: roleData.role, target: roleData.target }).to.be.deep.eq(rolesData[i]);
      }
    });

    it('does not hold any extra role data', async () => {
      await expect(transitionMigrator.rolesData(rolesData.length)).to.be.reverted;
    });
  });
});
