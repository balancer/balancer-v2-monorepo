import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('TimelockAuthorizerMigrator', () => {
  let root: SignerWithAddress;
  let user1: SignerWithAddress, user2: SignerWithAddress, user3: SignerWithAddress;
  let granter1: SignerWithAddress, granter2: SignerWithAddress, granter3: SignerWithAddress;
  let vault: Contract, oldAuthorizer: Contract, newAuthorizer: Contract, migrator: Contract;

  before('set up signers', async () => {
    [, user1, user2, user3, granter1, granter2, granter3, root] = await ethers.getSigners();
  });

  let rolesData: Array<{ grantee: string; role: string; target: string }>;
  let grantersData: Array<{ grantee: string; role: string; target: string }>;
  let revokersData: Array<{ grantee: string; role: string; target: string }>;
  const ROLE_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ROLE_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';
  const ROLE_3 = '0x0000000000000000000000000000000000000000000000000000000000000003';

  sharedBeforeEach('set up vault', async () => {
    oldAuthorizer = await deploy('MockBasicAuthorizer');
    vault = await deploy('Vault', { args: [oldAuthorizer.address, ZERO_ADDRESS, 0, 0] });
  });

  sharedBeforeEach('set up permissions', async () => {
    const target = await deploy('MockBasicAuthorizer'); // any contract
    rolesData = [
      { grantee: user1.address, role: ROLE_1, target: target.address },
      { grantee: user2.address, role: ROLE_2, target: target.address },
      { grantee: user3.address, role: ROLE_3, target: target.address },
    ];
    grantersData = [
      { grantee: granter1.address, role: ROLE_1, target: target.address },
      { grantee: granter2.address, role: ROLE_2, target: target.address },
      { grantee: granter3.address, role: ROLE_3, target: target.address },
    ];
    revokersData = [
      { grantee: user1.address, role: ROLE_1, target: target.address },
      { grantee: granter1.address, role: ROLE_2, target: target.address },
      { grantee: user3.address, role: ROLE_3, target: target.address },
    ];
  });

  context('constructor', () => {
    context('when attempting to migrate a role which does not exist on previous Authorizer', () => {
      it('reverts', async () => {
        const args = [vault.address, root.address, oldAuthorizer.address, rolesData, grantersData, revokersData];
        await expect(deploy('TimelockAuthorizerMigrator', { args })).to.be.revertedWith('UNEXPECTED_ROLE');
      });
    });
  });

  context('migrate', () => {
    sharedBeforeEach('grant roles on old Authorizer', async () => {
      await oldAuthorizer.grantRolesToMany([ROLE_1, ROLE_2, ROLE_3], [user1.address, user2.address, user3.address]);
    });

    sharedBeforeEach('set up migrator', async () => {
      const args = [vault.address, root.address, oldAuthorizer.address, rolesData, grantersData, revokersData];
      migrator = await deploy('TimelockAuthorizerMigrator', { args });
      newAuthorizer = await deployedAt('TimelockAuthorizer', await migrator.newAuthorizer());
      const setAuthorizerActionId = await actionId(vault, 'setAuthorizer');
      await oldAuthorizer.grantRolesToMany([setAuthorizerActionId], [migrator.address]);

      const CHANGE_ROOT_DELAY = await newAuthorizer.getRootTransferDelay();
      await advanceTime(CHANGE_ROOT_DELAY);
    });

    const itMigratesPermissionsProperly = (migrate: () => Promise<unknown>) => {
      it('runs the migration properly', async () => {
        expect(await migrator.existingRolesMigrated()).to.be.equal(0);

        await migrate();

        expect(await migrator.existingRolesMigrated()).to.be.equal(rolesData.length);
        expect(await migrator.isComplete()).to.be.true;
      });

      it('migrates all roles properly', async () => {
        await migrate();

        for (const roleData of rolesData) {
          expect(await newAuthorizer.hasPermission(roleData.role, roleData.grantee, roleData.target)).to.be.true;
        }
      });

      it('sets up granters properly', async () => {
        await migrate();

        for (const granterData of grantersData) {
          expect(await newAuthorizer.isGranter(granterData.role, granterData.grantee, granterData.target)).to.be.true;
        }
      });

      it('sets up revokers properly', async () => {
        await migrate();

        for (const revokerData of revokersData) {
          expect(await newAuthorizer.isGranter(revokerData.role, revokerData.grantee, revokerData.target)).to.be.true;
        }
      });

      it('does not set the new authorizer immediately', async () => {
        await migrate();

        expect(await newAuthorizer.isRoot(migrator.address)).to.be.true;
        expect(await vault.getAuthorizer()).to.be.equal(oldAuthorizer.address);
      });

      context('finalization', () => {
        sharedBeforeEach('migrate all roles', async () => {
          await migrate();
        });

        context('when new root has not claimed ownership over TimelockAuthorizer', () => {
          it('reverts', async () => {
            await expect(migrator.finalizeMigration()).to.be.revertedWith('ROOT_NOT_CLAIMED_YET');
          });
        });

        context('when new root has claimed ownership over TimelockAuthorizer', () => {
          sharedBeforeEach('claim root', async () => {
            await newAuthorizer.connect(root).claimRoot();
          });

          it('sets the new Authorizer on the Vault', async () => {
            await migrator.finalizeMigration();

            expect(await vault.getAuthorizer()).to.be.equal(newAuthorizer.address);
          });
        });
      });
    };

    context('with a partial migration', () => {
      itMigratesPermissionsProperly(() =>
        Promise.all([migrator.migrate(MAX_UINT256), migrator.migrate(MAX_UINT256), migrator.migrate(MAX_UINT256)])
      );
    });

    context('with a full migration', () => {
      itMigratesPermissionsProperly(() =>
        Promise.all(
          Array.from({ length: rolesData.length + grantersData.length + revokersData.length }).map(() =>
            migrator.migrate(1)
          )
        )
      );
    });
  });
});
