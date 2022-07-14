import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { advanceTime, DAY } from '@balancer-labs/v2-helpers/src/time';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('TimelockAuthorizerMigrator', () => {
  let root: SignerWithAddress;
  let user1: SignerWithAddress, user2: SignerWithAddress, user3: SignerWithAddress;
  let granter1: SignerWithAddress, granter2: SignerWithAddress, granter3: SignerWithAddress;
  let vault: Contract, oldAuthorizer: Contract, newAuthorizer: Contract, migrator: Contract;

  before('set up signers', async () => {
    [, user1, user2, user3, granter1, granter2, granter3, root] = await ethers.getSigners();
  });

  interface RoleData {
    grantee: string;
    role: string;
    target: string;
  }

  interface DelayData {
    actionId: string;
    newDelay: BigNumberish;
  }

  let rolesData: RoleData[];
  let grantersData: RoleData[];
  let revokersData: RoleData[];
  let executeDelaysData: DelayData[];
  let grantDelaysData: DelayData[];
  const ROLE_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ROLE_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';
  const ROLE_3 = '0x0000000000000000000000000000000000000000000000000000000000000003';

  sharedBeforeEach('set up vault', async () => {
    oldAuthorizer = await deploy('MockBasicAuthorizer');
    vault = await deploy('Vault', { args: [oldAuthorizer.address, ZERO_ADDRESS, 0, 0] });
  });

  sharedBeforeEach('set up permissions', async () => {
    const target = await deploy('MockAuthenticatedContract', { args: [vault.address] });
    rolesData = [
      { grantee: user1.address, role: ROLE_1, target: target.address },
      { grantee: user2.address, role: ROLE_2, target: target.address },
      { grantee: user3.address, role: ROLE_3, target: ZERO_ADDRESS },
    ];
    grantersData = [
      { grantee: granter1.address, role: ROLE_1, target: target.address },
      { grantee: granter2.address, role: ROLE_2, target: ZERO_ADDRESS },
      { grantee: granter3.address, role: ROLE_3, target: target.address },
    ];
    revokersData = [
      { grantee: user1.address, role: ROLE_1, target: target.address },
      { grantee: granter1.address, role: ROLE_2, target: target.address },
      { grantee: user3.address, role: ROLE_3, target: ZERO_ADDRESS },
    ];
    executeDelaysData = [
      // We must set this delay first to satisfy the `DELAY_EXCEEDS_SET_AUTHORIZER` check.
      { actionId: await actionId(vault, 'setAuthorizer'), newDelay: 30 * DAY },
      { actionId: ROLE_1, newDelay: 14 * DAY },
      { actionId: ROLE_2, newDelay: 7 * DAY },
    ];
    grantDelaysData = [
      { actionId: ROLE_2, newDelay: 30 * DAY },
      { actionId: ROLE_3, newDelay: 30 * DAY },
    ];
  });

  sharedBeforeEach('grant roles on old Authorizer', async () => {
    await oldAuthorizer.grantRolesToMany([ROLE_1, ROLE_2, ROLE_3], [user1.address, user2.address, user3.address]);
  });

  sharedBeforeEach('deploy migrator', async () => {
    const args = [
      vault.address,
      root.address,
      oldAuthorizer.address,
      rolesData,
      grantersData,
      revokersData,
      executeDelaysData,
      grantDelaysData,
    ];
    migrator = await deploy('TimelockAuthorizerMigrator', { args });
    newAuthorizer = await deployedAt('TimelockAuthorizer', await migrator.newAuthorizer());
    const setAuthorizerActionId = await actionId(vault, 'setAuthorizer');
    await oldAuthorizer.grantRolesToMany([setAuthorizerActionId], [migrator.address]);
  });

  context('constructor', () => {
    context('when attempting to migrate a role which does not exist on previous Authorizer', () => {
      let tempAuthorizer: Contract;

      sharedBeforeEach('set up vault', async () => {
        tempAuthorizer = await deploy('MockBasicAuthorizer');
      });

      it('reverts', async () => {
        const args = [
          vault.address,
          root.address,
          tempAuthorizer.address,
          rolesData,
          grantersData,
          revokersData,
          executeDelaysData,
          grantDelaysData,
        ];
        await expect(deploy('TimelockAuthorizerMigrator', { args })).to.be.revertedWith('UNEXPECTED_ROLE');
      });
    });

    it('migrates all roles properly', async () => {
      for (const roleData of rolesData) {
        expect(await newAuthorizer.hasPermission(roleData.role, roleData.grantee, roleData.target)).to.be.true;
      }
    });

    it('sets up granters properly', async () => {
      for (const granterData of grantersData) {
        expect(await newAuthorizer.isGranter(granterData.role, granterData.grantee, granterData.target)).to.be.true;
      }
    });

    it('sets up revokers properly', async () => {
      for (const revokerData of revokersData) {
        expect(await newAuthorizer.isRevoker(revokerData.role, revokerData.grantee, revokerData.target)).to.be.true;
      }
    });

    it('does not set the new authorizer immediately', async () => {
      expect(await newAuthorizer.isRoot(migrator.address)).to.be.true;
      expect(await vault.getAuthorizer()).to.be.equal(oldAuthorizer.address);
    });
  });

  context('executeDelays', () => {
    context("when MIN_DELAY hasn't passed", () => {
      it('reverts', async () => {
        await expect(migrator.executeDelays()).to.be.revertedWith('CANNOT_TRIGGER_DELAYS_MIGRATION_YET');
      });
    });

    context('when MIN_DELAY has passed', () => {
      sharedBeforeEach('advance time', async () => {
        const MIN_DELAY = await newAuthorizer.MIN_DELAY();
        await advanceTime(MIN_DELAY);
      });

      it('sets up delays properly', async () => {
        await migrator.executeDelays();

        for (const delayData of executeDelaysData) {
          expect(await newAuthorizer.getActionIdDelay(delayData.actionId)).to.be.eq(delayData.newDelay);
        }
      });

      it('sets up granter delays properly', async () => {
        await migrator.executeDelays();

        for (const delayData of grantDelaysData) {
          const grantActionId = await newAuthorizer.getGrantPermissionActionId(delayData.actionId);
          expect(await newAuthorizer.getActionIdDelay(grantActionId)).to.be.eq(delayData.newDelay);
        }
      });
    });
  });

  context('startRootTransfer', () => {
    context("when delays haven't been migrated", () => {
      it('reverts', async () => {
        await expect(migrator.startRootTransfer()).to.be.revertedWith('DELAYS_NOT_MIGRATED_YET');
      });
    });

    context('when delays have been migrated', () => {
      sharedBeforeEach('advance time', async () => {
        const MIN_DELAY = await newAuthorizer.MIN_DELAY();
        await advanceTime(MIN_DELAY);
        await migrator.executeDelays();
      });

      context("when the ROOT_CHANGE_DELAY hasn't passed", () => {
        it('reverts', async () => {
          await expect(migrator.startRootTransfer()).to.be.revertedWith('CANNOT_TRIGGER_ROOT_CHANGE_YET');
        });
      });

      context('when the ROOT_CHANGE_DELAY has passed', () => {
        sharedBeforeEach('advance time', async () => {
          const MIN_DELAY = await newAuthorizer.MIN_DELAY();
          const ROOT_CHANGE_DELAY = await newAuthorizer.getRootTransferDelay();
          await advanceTime(ROOT_CHANGE_DELAY.sub(MIN_DELAY));
        });

        it('executes the first step of the root transfer', async () => {
          const scheduledExecutionId = await migrator.rootChangeExecutionId();

          const tx = await migrator.startRootTransfer();
          expectEvent.inIndirectReceipt(await tx.wait(), newAuthorizer.interface, 'ExecutionExecuted', {
            scheduledExecutionId,
          });

          expect(await newAuthorizer.getPendingRoot()).to.be.eq(root.address);
        });

        it('does not complete setting the root transfer', async () => {
          await migrator.startRootTransfer();
          expect(await newAuthorizer.isRoot(migrator.address)).to.be.true;
        });

        it('does not set the new authorizer on the vault', async () => {
          await migrator.startRootTransfer();
          expect(await vault.getAuthorizer()).to.be.equal(oldAuthorizer.address);
        });
      });
    });
  });

  context('finalizeMigration', () => {
    context('when root transfer has been started', () => {
      sharedBeforeEach('advance time', async () => {
        const MIN_DELAY = await newAuthorizer.MIN_DELAY();
        await advanceTime(MIN_DELAY);
        await migrator.executeDelays();
      });

      sharedBeforeEach('start root transfer', async () => {
        const MIN_DELAY = await newAuthorizer.MIN_DELAY();
        const ROOT_CHANGE_DELAY = await newAuthorizer.getRootTransferDelay();
        await advanceTime(ROOT_CHANGE_DELAY.sub(MIN_DELAY));
        await migrator.startRootTransfer();
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
  });
});
