import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { DAY, advanceTime, advanceToTimestamp } from '@balancer-labs/v2-helpers/src/time';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

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

      describe('delayed permissions', () => {
        const shortDelay = DAY;
        const longDelay = DAY * 2;
        const grantActionIds: string[] = new Array<string>();
        const delayedRolesData: RoleData[] = new Array<RoleData>();

        async function setDelay(actionId: string, delay: number) {
          const receipt = await newAuthorizer.connect(root).scheduleDelayChange(actionId, delay, []);
          const event = expectEvent.inReceipt(await receipt.wait(), 'ExecutionScheduled');
          const scheduledExecutionId = event.args.scheduledExecutionId;
          await advanceToTimestamp((await newAuthorizer.getScheduledExecution(scheduledExecutionId)).executableAt);
          await newAuthorizer.execute(scheduledExecutionId);
        }

        sharedBeforeEach('set delay', async () => {
          // `setAuthorizer` delay must be the longest; any value works as long as it is longer than the others.
          const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
          await setDelay(setAuthorizerAction, longDelay * 3);

          delayedRolesData.push(rolesData[0]);
          delayedRolesData.push(rolesData[1]);

          grantActionIds.push(await newAuthorizer.getGrantPermissionActionId(delayedRolesData[0].role));
          grantActionIds.push(await newAuthorizer.getGrantPermissionActionId(delayedRolesData[1].role));
          await setDelay(grantActionIds[0], shortDelay);
          await setDelay(grantActionIds[1], longDelay);
        });

        context('when executing scheduled permissions before migrating', () => {
          it('reverts', async () => {
            await expect(transitionMigrator.executeDelays()).to.be.revertedWith('MIGRATION_INCOMPLETE');
          });
        });

        context('when migrating before executing scheduled permissions', () => {
          let migrationReceipt: ContractReceipt;
          const scheduledExecutionIds: BigNumber[] = new Array<BigNumber>();

          sharedBeforeEach('migrate permissions and store scheduled execution ID', async () => {
            migrationReceipt = await (await transitionMigrator.migratePermissions()).wait();
            scheduledExecutionIds.push(await transitionMigrator.scheduledExecutionIds(0));
            scheduledExecutionIds.push(await transitionMigrator.scheduledExecutionIds(1));
          });

          it('migrates all non-delayed permissions', async () => {
            for (const roleData of rolesData) {
              if (delayedRolesData.includes(roleData)) {
                expect(await newAuthorizer.canPerform(roleData.role, roleData.grantee, roleData.target)).to.be.false;
              } else {
                expect(await newAuthorizer.canPerform(roleData.role, roleData.grantee, roleData.target)).to.be.true;
              }
            }
          });

          it('stores scheduled execution IDs', async () => {
            expectEvent.inIndirectReceipt(
              migrationReceipt,
              newAuthorizer.interface,
              'ExecutionScheduled',
              {
                actionId: grantActionIds[0],
                scheduledExecutionId: scheduledExecutionIds[0],
              },
              newAuthorizer.address
            );

            expectEvent.inIndirectReceipt(
              migrationReceipt,
              newAuthorizer.interface,
              'ExecutionScheduled',
              {
                actionId: grantActionIds[1],
                scheduledExecutionId: scheduledExecutionIds[1],
              },
              newAuthorizer.address
            );

            await expect(transitionMigrator.scheduledExecutionIds(delayedRolesData.length)).to.be.reverted;
          });

          context('when the delay is due for some (but not all) permissions', () => {
            let receipt: ContractReceipt;

            sharedBeforeEach(async () => {
              await advanceTime(shortDelay);
              receipt = await (await transitionMigrator.executeDelays()).wait();
            });

            it('grants scheduled permissions whose delays are due', async () => {
              expectEvent.inIndirectReceipt(receipt, newAuthorizer.interface, 'ExecutionExecuted', {
                scheduledExecutionId: scheduledExecutionIds[0],
              });

              const dueRoleData = delayedRolesData[0];
              expect(await newAuthorizer.canPerform(dueRoleData.role, dueRoleData.grantee, dueRoleData.target)).to.be
                .true;
            });

            it('skips scheduled permissions whose delays are not due', async () => {
              const notDueRoleData = delayedRolesData[1];
              expect(await newAuthorizer.canPerform(notDueRoleData.role, notDueRoleData.grantee, notDueRoleData.target))
                .to.be.false;
            });
          });

          context('when the delay is due for all permissions', () => {
            let receipt: ContractReceipt;

            sharedBeforeEach(async () => {
              await advanceTime(longDelay);
              receipt = await (await transitionMigrator.executeDelays()).wait();
            });

            it('grants all scheduled permissions', async () => {
              expectEvent.inIndirectReceipt(receipt, newAuthorizer.interface, 'ExecutionExecuted', {
                scheduledExecutionId: scheduledExecutionIds[0],
              });
              expectEvent.inIndirectReceipt(receipt, newAuthorizer.interface, 'ExecutionExecuted', {
                scheduledExecutionId: scheduledExecutionIds[1],
              });

              const dueRoleData0 = delayedRolesData[0];
              const dueRoleData1 = delayedRolesData[1];
              expect(await newAuthorizer.canPerform(dueRoleData0.role, dueRoleData0.grantee, dueRoleData0.target)).to.be
                .true;
              expect(await newAuthorizer.canPerform(dueRoleData1.role, dueRoleData1.grantee, dueRoleData1.target)).to.be
                .true;
            });
          });

          context('when the delayed permissions are canceled before they are executed', () => {
            sharedBeforeEach(async () => {
              await newAuthorizer.connect(root).cancel(scheduledExecutionIds[0]);
              await newAuthorizer.connect(root).cancel(scheduledExecutionIds[1]);
              await advanceTime(longDelay);
            });

            itDoesNotExecuteExecutions();
          });

          context('when the delay is not due', () => {
            itDoesNotExecuteExecutions();
          });

          function itDoesNotExecuteExecutions() {
            it('does not execute executions', async () => {
              const receipt = await (await transitionMigrator.executeDelays()).wait();
              expectEvent.notEmitted(receipt, 'ExecutionExecuted');
            });
          }
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
