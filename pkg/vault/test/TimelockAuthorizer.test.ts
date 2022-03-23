import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TimelockAuthorizer from '@balancer-labs/v2-helpers/src/models/authorizer/TimelockAuthorizer';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { advanceTime, currentTimestamp, DAY } from '@balancer-labs/v2-helpers/src/time';

describe('TimelockAuthorizer', () => {
  let authorizer: TimelockAuthorizer, vault: Contract;
  let admin: SignerWithAddress, grantee: SignerWithAddress, from: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, grantee] = await ethers.getSigners();
  });

  const ACTION_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ACTION_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';
  const ACTIONS = [ACTION_1, ACTION_2];

  const WHERE_1 = ethers.Wallet.createRandom().address;
  const WHERE_2 = ethers.Wallet.createRandom().address;
  const WHERE = [WHERE_1, WHERE_2];

  const WHATEVER = TimelockAuthorizer.WHATEVER;
  const EVERYWHERE = TimelockAuthorizer.EVERYWHERE;
  const NOT_WHERE = ethers.Wallet.createRandom().address;

  sharedBeforeEach('deploy authorizer', async () => {
    const oldAuthorizer = await TimelockAuthorizer.create({ admin });

    vault = await deploy('Vault', { args: [oldAuthorizer.address, ZERO_ADDRESS, 0, 0] });
    authorizer = await TimelockAuthorizer.create({ admin, vault });

    const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
    await oldAuthorizer.grantPermissions(setAuthorizerAction, admin, vault, { from: admin });
    await vault.connect(admin).setAuthorizer(authorizer.address);
  });

  describe('admin', () => {
    let GRANT_ACTION_ID: string, REVOKE_ACTION_ID: string;

    sharedBeforeEach('set constants', async () => {
      GRANT_ACTION_ID = await authorizer.GRANT_ACTION_ID();
      REVOKE_ACTION_ID = await authorizer.REVOKE_ACTION_ID();
    });

    it('is root', async () => {
      expect(await authorizer.isRoot(admin)).to.be.true;
    });

    it('defines its permissions correctly', async () => {
      const expectedGrantId = ethers.utils.solidityKeccak256(
        ['bytes32', 'address', 'address'],
        [GRANT_ACTION_ID, admin.address, EVERYWHERE]
      );
      expect(await authorizer.permissionId(GRANT_ACTION_ID, admin, EVERYWHERE)).to.be.equal(expectedGrantId);

      const expectedRevokeId = ethers.utils.solidityKeccak256(
        ['bytes32', 'address', 'address'],
        [REVOKE_ACTION_ID, admin.address, EVERYWHERE]
      );
      expect(await authorizer.permissionId(REVOKE_ACTION_ID, admin, EVERYWHERE)).to.be.equal(expectedRevokeId);
    });

    it('can grant permissions everywhere', async () => {
      expect(await authorizer.canPerform(GRANT_ACTION_ID, admin, WHERE_1, WHATEVER)).to.be.true;
      expect(await authorizer.canPerform(GRANT_ACTION_ID, admin, WHERE_2, WHATEVER)).to.be.true;
      expect(await authorizer.canPerform(GRANT_ACTION_ID, admin, EVERYWHERE, WHATEVER)).to.be.true;
    });

    it('can revoke permissions everywhere', async () => {
      expect(await authorizer.canPerform(REVOKE_ACTION_ID, admin, WHERE_1, WHATEVER)).to.be.true;
      expect(await authorizer.canPerform(REVOKE_ACTION_ID, admin, WHERE_2, WHATEVER)).to.be.true;
      expect(await authorizer.canPerform(REVOKE_ACTION_ID, admin, EVERYWHERE, WHATEVER)).to.be.true;
    });

    it('does not hold plain grant permissions', async () => {
      expect(await authorizer.canPerform(REVOKE_ACTION_ID, admin, EVERYWHERE)).to.be.false;
      expect(await authorizer.canPerform(REVOKE_ACTION_ID, admin, EVERYWHERE)).to.be.false;
    });

    it('does not hold plain revoke permissions', async () => {
      expect(await authorizer.canPerform(GRANT_ACTION_ID, admin, EVERYWHERE)).to.be.false;
      expect(await authorizer.canPerform(GRANT_ACTION_ID, admin, EVERYWHERE)).to.be.false;
    });

    it('can manage other addresses to grant permissions for a custom contract', async () => {
      await authorizer.addGrantPermissionsManager(WHATEVER, grantee, WHERE_1, { from: admin });

      expect(await authorizer.canPerform(GRANT_ACTION_ID, grantee, WHERE_1, WHATEVER)).to.be.true;
      expect(await authorizer.canPerform(GRANT_ACTION_ID, grantee, EVERYWHERE, WHATEVER)).to.be.false;

      await authorizer.removeGrantPermissionsManager(WHATEVER, grantee, WHERE_1, { from: admin });

      expect(await authorizer.canPerform(GRANT_ACTION_ID, grantee, WHERE_1, WHATEVER)).to.be.false;
      expect(await authorizer.canPerform(GRANT_ACTION_ID, grantee, EVERYWHERE, WHATEVER)).to.be.false;
    });

    it('can manage other addresses to grant permissions everywhere', async () => {
      await authorizer.addGrantPermissionsManager(WHATEVER, grantee, EVERYWHERE, { from: admin });

      expect(await authorizer.canPerform(GRANT_ACTION_ID, grantee, WHERE_1, WHATEVER)).to.be.true;
      expect(await authorizer.canPerform(GRANT_ACTION_ID, grantee, EVERYWHERE, WHATEVER)).to.be.true;

      await authorizer.removeGrantPermissionsManager(WHATEVER, grantee, EVERYWHERE, { from: admin });

      expect(await authorizer.canPerform(GRANT_ACTION_ID, grantee, WHERE_1, WHATEVER)).to.be.false;
      expect(await authorizer.canPerform(GRANT_ACTION_ID, grantee, EVERYWHERE, WHATEVER)).to.be.false;
    });

    it('can manage other addresses to revoke permissions for a custom contract', async () => {
      await authorizer.addRevokePermissionsManager(WHATEVER, grantee, WHERE_1, { from: admin });

      expect(await authorizer.canPerform(REVOKE_ACTION_ID, grantee, WHERE_1, WHATEVER)).to.be.true;
      expect(await authorizer.canPerform(REVOKE_ACTION_ID, grantee, EVERYWHERE, WHATEVER)).to.be.false;

      await authorizer.removeRevokePermissionsManager(WHATEVER, grantee, WHERE_1, { from: admin });

      expect(await authorizer.canPerform(REVOKE_ACTION_ID, grantee, WHERE_1, WHATEVER)).to.be.false;
      expect(await authorizer.canPerform(REVOKE_ACTION_ID, grantee, EVERYWHERE, WHATEVER)).to.be.false;
    });

    it('can manage other addresses to revoke permissions everywhere', async () => {
      await authorizer.addRevokePermissionsManager(WHATEVER, grantee, EVERYWHERE, { from: admin });

      expect(await authorizer.canPerform(REVOKE_ACTION_ID, grantee, WHERE_1, WHATEVER)).to.be.true;
      expect(await authorizer.canPerform(REVOKE_ACTION_ID, grantee, EVERYWHERE, WHATEVER)).to.be.true;

      await authorizer.removeRevokePermissionsManager(WHATEVER, grantee, EVERYWHERE, { from: admin });

      expect(await authorizer.canPerform(REVOKE_ACTION_ID, grantee, WHERE_1, WHATEVER)).to.be.false;
      expect(await authorizer.canPerform(REVOKE_ACTION_ID, grantee, EVERYWHERE, WHATEVER)).to.be.false;
    });

    it('can have their global grant permissions revoked by an authorized address for any contract', async () => {
      await authorizer.addGrantPermissionsManager(WHATEVER, grantee, EVERYWHERE, { from: admin });

      await authorizer.removeGrantPermissionsManager(WHATEVER, admin, EVERYWHERE, { from: grantee });
      expect(await authorizer.canPerform(GRANT_ACTION_ID, admin, WHERE_1, WHATEVER)).to.be.false;
      expect(await authorizer.canPerform(GRANT_ACTION_ID, admin, EVERYWHERE, WHATEVER)).to.be.false;

      await authorizer.addGrantPermissionsManager(WHATEVER, admin, EVERYWHERE, { from: admin });
      expect(await authorizer.canPerform(GRANT_ACTION_ID, admin, WHERE_1, WHATEVER)).to.be.true;
      expect(await authorizer.canPerform(GRANT_ACTION_ID, admin, EVERYWHERE, WHATEVER)).to.be.true;
    });

    it('cannot have their global grant permissions revoked by an authorized address for a specific contract', async () => {
      await authorizer.addGrantPermissionsManager(WHATEVER, grantee, WHERE_1, { from: admin });

      await expect(
        authorizer.removeGrantPermissionsManager(WHATEVER, admin, EVERYWHERE, { from: grantee })
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    it('can have their global revoke permissions revoked by an authorized address for any contract', async () => {
      await authorizer.addRevokePermissionsManager(WHATEVER, grantee, EVERYWHERE, { from: admin });

      await authorizer.removeRevokePermissionsManager(WHATEVER, admin, EVERYWHERE, { from: grantee });
      expect(await authorizer.canPerform(REVOKE_ACTION_ID, admin, WHERE_1, WHATEVER)).to.be.false;
      expect(await authorizer.canPerform(REVOKE_ACTION_ID, admin, EVERYWHERE, WHATEVER)).to.be.false;

      await authorizer.addRevokePermissionsManager(WHATEVER, admin, EVERYWHERE, { from: admin });
      expect(await authorizer.canPerform(GRANT_ACTION_ID, admin, WHERE_1, WHATEVER)).to.be.true;
      expect(await authorizer.canPerform(GRANT_ACTION_ID, admin, EVERYWHERE, WHATEVER)).to.be.true;
    });

    it('cannot have their global revoke permissions revoked by an authorized address for a specific contract', async () => {
      await authorizer.addRevokePermissionsManager(WHATEVER, grantee, WHERE_1, { from: admin });

      await expect(
        authorizer.removeRevokePermissionsManager(WHATEVER, admin, EVERYWHERE, { from: grantee })
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });

  describe('grantPermissions', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        from = admin;
      });

      context('when the target does not have the permission granted', () => {
        context('when there is no delay set to grant permissions', () => {
          it('grants permission to perform the requested actions for the requested contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
          });

          it('does not grant permission to perform the requested actions everywhere', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
          });

          it('does not grant permission to perform the requested actions for other contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).wait();

            ACTIONS.forEach((action, i) => {
              expectEvent.inReceipt(receipt, 'PermissionGranted', {
                actionId: action,
                account: grantee.address,
                where: WHERE[i],
              });
            });
          });
        });

        context('when there is a delay set to grant permissions', () => {
          const delay = DAY;
          let grantActionId: string;

          sharedBeforeEach('set constants', async () => {
            grantActionId = await authorizer.getActionId(await authorizer.GRANT_ACTION_ID(), ACTION_1);
          });

          sharedBeforeEach('set delay', async () => {
            const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
            await authorizer.setDelay(setAuthorizerAction, delay * 2, { from: admin });
            await authorizer.setDelay(grantActionId, delay, { from: admin });
          });

          it('reverts', async () => {
            await expect(authorizer.grantPermissions(ACTION_1, grantee, WHERE_1, { from })).to.be.revertedWith(
              'SENDER_NOT_ALLOWED'
            );
          });

          it('can schedule a grant permission', async () => {
            const id = await authorizer.scheduleGrantPermission(ACTION_1, grantee, WHERE_1, [], { from });

            await advanceTime(delay);
            await authorizer.execute(id, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.false;
          });
        });
      });

      context('when the target has the permission granted', () => {
        context('when the permission was granted for a set of contracts', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          });

          it('ignores the request and can still perform those actions', async () => {
            await expect(authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).not.to.reverted;

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
          });

          it('does not grant permission to perform the requested actions everywhere', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
          });

          it('does not grant permission to perform the requested actions for other contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
            expectEvent.notEmitted(await tx.wait(), 'PermissionGranted');
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
          });

          it('grants permission to perform the requested actions for the requested contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
          });

          it('still can perform the requested actions everywhere', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.true;
          });

          it('still can perform the requested actions for other contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).wait();

            ACTIONS.forEach((action, i) => {
              expectEvent.inReceipt(receipt, 'PermissionGranted', {
                actionId: action,
                account: grantee.address,
                where: WHERE[i],
              });
            });
          });
        });
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        from = grantee;
      });

      it('reverts', async () => {
        await expect(authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });
  });

  describe('grantPermissionsGlobally', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        from = admin;
      });

      context('when the target does not have the permission granted', () => {
        it('grants permission to perform the requested actions everywhere', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.true;
        });

        it('grants permission to perform the requested actions in any specific contract', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.true;
        });

        it('emits an event', async () => {
          const receipt = await (await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).wait();

          for (const action of ACTIONS) {
            expectEvent.inReceipt(receipt, 'PermissionGranted', {
              actionId: action,
              account: grantee.address,
              where: TimelockAuthorizer.EVERYWHERE,
            });
          }
        });
      });

      context('when the target has the permission granted', () => {
        context('when the permission was granted for a set of contracts', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          });

          it('grants permission to perform the requested actions everywhere', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.true;
          });

          it('still can perform the requested actions for the previously granted contracts', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).wait();

            for (const action of ACTIONS) {
              expectEvent.inReceipt(receipt, 'PermissionGranted', {
                actionId: action,
                account: grantee.address,
                where: TimelockAuthorizer.EVERYWHERE,
              });
            }
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
          });

          it('ignores the request and can still perform the requested actions everywhere', async () => {
            await expect(authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.true;
          });

          it('ignores the request and can still perform the requested actions in any specific contract', async () => {
            await expect(authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

            expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.true;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
            expectEvent.notEmitted(await tx.wait(), 'PermissionGrantedGlobally');
          });
        });
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        from = grantee;
      });

      it('reverts', async () => {
        await expect(authorizer.grantPermissionsGlobally(ACTIONS, grantee)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });

  describe('revokePermissions', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        from = admin;
      });

      context('when the target does not have the permission granted', () => {
        it('ignores the request and cannot perform the requested actions everywhere', async () => {
          await expect(authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
        });

        it('ignores the request and cannot perform the requested actions in any specific contract', async () => {
          await expect(authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
        });

        it('does not emit an event', async () => {
          const tx = await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          expectEvent.notEmitted(await tx.wait(), 'PermissionRevoked');
        });
      });

      context('when the target has the permission granted', () => {
        context('when the permission was granted for a set of contracts', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          });

          context('when there is no delay set to revoke permissions', () => {
            it('revokes the requested permission for the requested contracts', async () => {
              await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

              expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.false;
            });

            it('still cannot perform the requested actions everywhere', async () => {
              await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

              expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
            });

            it('emits an event', async () => {
              const receipt = await (await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from })).wait();

              ACTIONS.forEach((action, i) => {
                expectEvent.inReceipt(receipt, 'PermissionRevoked', {
                  actionId: action,
                  account: grantee.address,
                  where: WHERE[i],
                });
              });
            });
          });

          context('when there is a delay set to revoke permissions', () => {
            const delay = DAY;
            let revokeActionId: string;

            sharedBeforeEach('set constants', async () => {
              revokeActionId = await authorizer.getActionId(await authorizer.REVOKE_ACTION_ID(), ACTION_1);
            });

            sharedBeforeEach('set delay', async () => {
              const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
              await authorizer.setDelay(setAuthorizerAction, delay * 2, { from: admin });
              await authorizer.setDelay(revokeActionId, delay, { from: admin });
            });

            it('reverts', async () => {
              await expect(authorizer.revokePermissions(ACTION_1, grantee, WHERE_1, { from })).to.be.revertedWith(
                'SENDER_NOT_ALLOWED'
              );
            });

            it('can schedule a revoke permission', async () => {
              const id = await authorizer.scheduleRevokePermission(ACTION_1, grantee, WHERE_1, [], { from });

              await advanceTime(delay);
              await authorizer.execute(id, { from });

              expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
            });
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
          });

          it('still can perform the requested actions for the requested contracts', async () => {
            await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
          });

          it('still can perform the requested actions everywhere', async () => {
            await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.true;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
            expectEvent.notEmitted(await tx.wait(), 'PermissionRevoked');
          });
        });
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        from = grantee;
      });

      it('reverts', async () => {
        await expect(authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from })).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });
  });

  describe('revokePermissionsGlobally', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        from = admin;
      });

      context('when the sender does not have the permission granted', () => {
        it('ignores the request and cannot perform the requested actions everywhere', async () => {
          await expect(authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
        });

        it('ignores the request and cannot perform the requested actions in any specific contract', async () => {
          await expect(authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
        });

        it('does not emit an event', async () => {
          const tx = await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });
          expectEvent.notEmitted(await tx.wait(), 'PermissionRevokedGlobally');
        });
      });

      context('when the grantee has the permission granted', () => {
        context('when the permission was granted for a set of contracts', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          });

          it('still cannot perform the requested actions everywhere', async () => {
            await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
          });

          it('still can perform the requested actions for the previously granted permissions', async () => {
            await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });
            expectEvent.notEmitted(await tx.wait(), 'PermissionRevokedGlobally');
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
          });

          it('revokes the requested global permission and cannot perform the requested actions everywhere', async () => {
            await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.false;
            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.false;
          });

          it('cannot perform the requested actions in any specific contract', async () => {
            await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from })).wait();

            for (const action of ACTIONS) {
              expectEvent.inReceipt(receipt, 'PermissionRevoked', {
                actionId: action,
                account: grantee.address,
                where: TimelockAuthorizer.EVERYWHERE,
              });
            }
          });
        });
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        from = grantee;
      });

      it('reverts', async () => {
        await expect(authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from })).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });
  });

  describe('renouncePermissions', () => {
    beforeEach('set sender', async () => {
      from = grantee;
    });

    context('when the sender does not have the permission granted', () => {
      it('ignores the request and still cannot perform the requested actions everywhere', async () => {
        await expect(authorizer.renouncePermissions(ACTIONS, WHERE, { from })).not.to.be.reverted;

        expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
        expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
      });

      it('ignores the request and still cannot perform the requested actions in any specific contract', async () => {
        await expect(authorizer.renouncePermissions(ACTIONS, WHERE, { from })).not.to.be.reverted;

        expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
        expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
      });
    });

    context('when the sender has the permission granted', () => {
      context('when the sender has the permission granted for a specific contract', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from: admin });
        });

        it('revokes the requested permission for the requested contracts', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.false;
        });

        it('still cannot perform the requested actions everywhere', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
        });
      });

      context('when the sender has the permission granted globally', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from: admin });
        });

        it('still can perform the requested actions for the requested contracts', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.true;
          expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
        });

        it('still can perform the requested actions everywhere', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.true;
        });
      });
    });
  });

  describe('renouncePermissionsGlobally', () => {
    beforeEach('set sender', async () => {
      from = grantee;
    });

    context('when the sender does not have the permission granted', () => {
      it('ignores the request and still cannot perform the requested actions everywhere', async () => {
        await expect(authorizer.renouncePermissionsGlobally(ACTIONS, { from })).not.to.be.reverted;

        expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
        expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
      });

      it('ignores the request and still cannot perform the requested actions in any specific contract', async () => {
        await expect(authorizer.renouncePermissionsGlobally(ACTIONS, { from })).not.to.be.reverted;

        expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
        expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
      });
    });

    context('when the sender has the permission granted', () => {
      context('when the sender has the permission granted for a specific contract', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from: admin });
        });

        it('still can perform the requested actions for the requested contracts', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
        });

        it('still cannot perform the requested actions everywhere', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
        });
      });

      context('when the sender has the permission granted globally', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from: admin });
        });

        it('revokes the requested permissions everywhere', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
        });

        it('still cannot perform the requested actions in any specific contract', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
        });
      });
    });
  });

  describe('setDelay', () => {
    const action = ACTION_1;

    const grantPermission = async (actionId: string) => {
      const SCHEDULE_DELAY_ACTION_ID = await authorizer.SCHEDULE_DELAY_ACTION_ID();
      const args = [SCHEDULE_DELAY_ACTION_ID, actionId];
      const setDelayAction = ethers.utils.solidityKeccak256(['bytes32', 'bytes32'], args);
      await authorizer.grantPermissions(setDelayAction, admin, authorizer, { from: admin });
    };

    context('when the sender has permission for the requested action', () => {
      sharedBeforeEach('grant permission', async () => {
        await grantPermission(action);
      });

      context('when the new delay is less than 2 years', () => {
        const delay = DAY;

        context('when the action is scheduled', () => {
          let expectedData: string;

          sharedBeforeEach('compute expected data', async () => {
            expectedData = authorizer.instance.interface.encodeFunctionData('setDelay', [action, delay]);
          });

          context('when the delay is greater than or equal to the delay to set the authorizer in the vault', () => {
            sharedBeforeEach('set delay to set authorizer', async () => {
              const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
              await authorizer.setDelay(setAuthorizerAction, delay, { from: admin });
            });

            context('when there was no previous delay', () => {
              it('schedules a delay change', async () => {
                const id = await authorizer.scheduleDelayChange(action, delay, [], { from: admin });

                const scheduledExecution = await authorizer.scheduledExecutions(id);
                expect(scheduledExecution.executed).to.be.false;
                expect(scheduledExecution.data).to.be.equal(expectedData);
                expect(scheduledExecution.where).to.be.equal(authorizer.address);
                expect(scheduledExecution.protected).to.be.false;
                expect(scheduledExecution.executableAt).to.be.at.most(await currentTimestamp());
              });

              it('can be executed immediately', async () => {
                const id = await authorizer.scheduleDelayChange(action, delay, [], { from: admin });

                await authorizer.execute(id);
                expect(await authorizer.delay(action)).to.be.equal(delay);
              });

              it('emits an event', async () => {
                const id = await authorizer.scheduleDelayChange(action, delay, [], { from: admin });

                const receipt = await authorizer.execute(id);
                expectEvent.inReceipt(await receipt.wait(), 'ActionDelaySet', { actionId: action, delay });
              });
            });

            context('when there was a previous delay set', () => {
              const previousDelay = delay / 2;

              sharedBeforeEach('set previous delay', async () => {
                const id = await authorizer.scheduleDelayChange(action, previousDelay, [], { from: admin });
                await authorizer.execute(id);
              });

              it('schedules a delay change', async () => {
                const id = await authorizer.scheduleDelayChange(action, delay, [], { from: admin });

                const scheduledExecution = await authorizer.scheduledExecutions(id);
                expect(scheduledExecution.executed).to.be.false;
                expect(scheduledExecution.data).to.be.equal(expectedData);
                expect(scheduledExecution.where).to.be.equal(authorizer.address);
                expect(scheduledExecution.protected).to.be.false;
                expect(scheduledExecution.executableAt).to.be.at.most((await currentTimestamp()).add(previousDelay));
              });

              it('cannot be executed immediately', async () => {
                const id = await authorizer.scheduleDelayChange(action, delay, [], { from: admin });

                await expect(authorizer.execute(id)).to.be.revertedWith('ACTION_NOT_EXECUTABLE');

                await advanceTime(previousDelay);
                await authorizer.execute(id);
                expect(await authorizer.delay(action)).to.be.equal(delay);
              });

              it('emits an event', async () => {
                const id = await authorizer.scheduleDelayChange(action, delay, [], { from: admin });

                await advanceTime(previousDelay);
                const receipt = await authorizer.execute(id);
                expectEvent.inReceipt(await receipt.wait(), 'ActionDelaySet', { actionId: action, delay });
              });
            });
          });

          context('when the delay is not greater than the delay to set the authorizer in the vault', () => {
            it('reverts on execution', async () => {
              const id = await authorizer.scheduleDelayChange(action, delay, [], { from: admin });
              await expect(authorizer.execute(id)).to.be.revertedWith('DELAY_EXCEEDS_SET_AUTHORIZER');
            });
          });
        });

        context('when the action is performed directly', () => {
          it('reverts', async () => {
            await expect(authorizer.instance.setDelay(action, delay)).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });

      context('when the new delay is more than 2 years', () => {
        const delay = DAY * 900;

        it('reverts', async () => {
          await expect(authorizer.scheduleDelayChange(action, delay, [])).to.be.revertedWith('DELAY_TOO_LARGE');
        });
      });
    });

    context('when the sender has permission for another action', () => {
      sharedBeforeEach('grant permission', async () => {
        await grantPermission(ACTION_2);
      });

      it('reverts', async () => {
        await expect(authorizer.scheduleDelayChange(action, DAY, [])).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the sender does not have permission', () => {
      it('reverts', async () => {
        await expect(authorizer.scheduleDelayChange(action, DAY, [])).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });

  describe('schedule', () => {
    let where: Contract, action: string, data: string, executors: SignerWithAddress[];
    let anotherVault: Contract, newAuthorizer: TimelockAuthorizer;

    sharedBeforeEach('deploy sample instances', async () => {
      newAuthorizer = await TimelockAuthorizer.create({ admin });
      anotherVault = await deploy('Vault', { args: [authorizer.address, ZERO_ADDRESS, 0, 0] });
    });

    const schedule = async (): Promise<number> => {
      data = vault.interface.encodeFunctionData('setAuthorizer', [newAuthorizer.address]);
      return authorizer.schedule(where, data, executors || [], { from: grantee });
    };

    context('when the target is not the authorizer', () => {
      sharedBeforeEach('set where', async () => {
        where = vault;
      });

      context('when the sender has permission', () => {
        context('when the sender has permission for the requested action', () => {
          sharedBeforeEach('set action', async () => {
            action = await actionId(vault, 'setAuthorizer');
          });

          context('when the sender has permission for the requested contract', () => {
            sharedBeforeEach('grant permission', async () => {
              await authorizer.grantPermissions(action, grantee, vault, { from: admin });
            });

            context('when there is a delay set', () => {
              const delay = DAY * 5;

              sharedBeforeEach('set delay', async () => {
                await authorizer.setDelay(action, delay, { from: admin });
              });

              context('when no executors are specified', () => {
                sharedBeforeEach('set executors', async () => {
                  executors = [];
                });

                it('schedules a non-protected execution', async () => {
                  const id = await schedule();

                  const scheduledExecution = await authorizer.scheduledExecutions(id);
                  expect(scheduledExecution.executed).to.be.false;
                  expect(scheduledExecution.data).to.be.equal(data);
                  expect(scheduledExecution.where).to.be.equal(where.address);
                  expect(scheduledExecution.protected).to.be.false;
                  expect(scheduledExecution.executableAt).to.be.at.most((await currentTimestamp()).add(delay));
                });

                it('cannot execute the action immediately', async () => {
                  const id = await schedule();
                  await expect(authorizer.execute(id)).to.be.revertedWith('ACTION_NOT_EXECUTABLE');
                });

                it('can be executed by anyone', async () => {
                  const id = await schedule();
                  await advanceTime(delay);

                  const receipt = await authorizer.execute(id);
                  expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', { scheduledExecutionId: id });

                  const scheduledExecution = await authorizer.scheduledExecutions(id);
                  expect(scheduledExecution.executed).to.be.true;

                  expect(await vault.getAuthorizer()).to.be.equal(newAuthorizer.address);
                });

                it('cannot be executed twice', async () => {
                  const id = await schedule();
                  await advanceTime(delay);

                  await authorizer.execute(id);
                  await expect(authorizer.execute(id)).to.be.revertedWith('ACTION_ALREADY_EXECUTED');
                });
              });

              context('when an executor is specified', () => {
                sharedBeforeEach('set executors', async () => {
                  executors = [admin];
                });

                it('schedules the requested execution', async () => {
                  const id = await schedule();

                  const scheduledExecution = await authorizer.scheduledExecutions(id);
                  expect(scheduledExecution.executed).to.be.false;
                  expect(scheduledExecution.data).to.be.equal(data);
                  expect(scheduledExecution.where).to.be.equal(where.address);
                  expect(scheduledExecution.protected).to.be.true;
                  expect(scheduledExecution.executableAt).to.be.at.most((await currentTimestamp()).add(delay));
                });

                it('cannot execute the action immediately', async () => {
                  const id = await schedule();
                  await expect(authorizer.execute(id, { from: executors[0] })).to.be.revertedWith(
                    'ACTION_NOT_EXECUTABLE'
                  );
                });

                it('can be executed by the executor only', async () => {
                  const id = await schedule();
                  await advanceTime(delay);

                  await expect(authorizer.execute(id, { from: grantee })).to.be.revertedWith('SENDER_NOT_ALLOWED');

                  const receipt = await authorizer.execute(id, { from: executors[0] });
                  expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', { scheduledExecutionId: id });

                  const scheduledExecution = await authorizer.scheduledExecutions(id);
                  expect(scheduledExecution.executed).to.be.true;

                  expect(await vault.getAuthorizer()).to.be.equal(newAuthorizer.address);
                });

                it('cannot be executed twice', async () => {
                  const id = await schedule();
                  await advanceTime(delay);

                  await authorizer.execute(id, { from: executors[0] });
                  await expect(authorizer.execute(id, { from: executors[0] })).to.be.revertedWith(
                    'ACTION_ALREADY_EXECUTED'
                  );
                });
              });
            });

            context('when there is no delay set', () => {
              it('reverts', async () => {
                await expect(schedule()).to.be.revertedWith('CANNOT_SCHEDULE_ACTION');
              });
            });
          });

          context('when the sender has permissions for another contract', () => {
            sharedBeforeEach('grant permission', async () => {
              await authorizer.grantPermissions(action, grantee, anotherVault, { from: admin });
            });

            it('reverts', async () => {
              await expect(schedule()).to.be.revertedWith('SENDER_NOT_ALLOWED');
            });
          });
        });

        context('when the sender has permissions for another action', () => {
          sharedBeforeEach('grant permission', async () => {
            action = await actionId(vault, 'setRelayerApproval');
            await authorizer.grantPermissions(action, grantee, vault, { from: admin });
          });

          it('reverts', async () => {
            await expect(schedule()).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });

      context('when the sender does not have permission', () => {
        it('reverts', async () => {
          await expect(schedule()).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });
    });

    context('when the target is the authorizer', () => {
      sharedBeforeEach('set where', async () => {
        where = authorizer.instance;
      });

      it('reverts', async () => {
        await expect(schedule()).to.be.revertedWith('CANNOT_SCHEDULE_AUTHORIZER_ACTIONS');
      });
    });
  });

  describe('execute', () => {
    const delay = DAY;
    let executors: SignerWithAddress[], newAuthorizer: TimelockAuthorizer;

    sharedBeforeEach('deploy sample instances', async () => {
      newAuthorizer = await TimelockAuthorizer.create({ admin });
    });

    sharedBeforeEach('grant set authorizer permission with delay', async () => {
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.setDelay(setAuthorizerAction, delay, { from: admin });
      await authorizer.grantPermissions(setAuthorizerAction, grantee, vault, { from: admin });
    });

    const schedule = async (): Promise<number> => {
      const data = vault.interface.encodeFunctionData('setAuthorizer', [newAuthorizer.address]);
      return authorizer.schedule(vault, data, executors || [], { from: grantee });
    };

    context('when the given id is valid', () => {
      let id: BigNumberish;

      context('when the action is protected', () => {
        sharedBeforeEach('set executors', async () => {
          executors = [admin];
        });

        context('when the sender is an allowed executor', () => {
          sharedBeforeEach('set sender', async () => {
            from = executors[0];
          });

          context('when the action was not cancelled', () => {
            sharedBeforeEach('schedule execution', async () => {
              id = await schedule();
            });

            context('when the delay has passed', () => {
              sharedBeforeEach('advance time', async () => {
                await advanceTime(delay);
              });

              it('executes the action', async () => {
                await authorizer.execute(id, { from });

                const scheduledExecution = await authorizer.scheduledExecutions(id);
                expect(scheduledExecution.executed).to.be.true;

                expect(await vault.getAuthorizer()).to.be.equal(newAuthorizer.address);
              });

              it('emits an event', async () => {
                const receipt = await authorizer.execute(id, { from });

                expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', { scheduledExecutionId: id });
              });

              it('cannot be executed twice', async () => {
                await authorizer.execute(id, { from });

                await expect(authorizer.execute(id, { from })).to.be.revertedWith('ACTION_ALREADY_EXECUTED');
              });
            });

            context('when the delay has not passed', () => {
              it('reverts', async () => {
                await expect(authorizer.execute(id, { from })).to.be.revertedWith('ACTION_NOT_EXECUTABLE');
              });
            });
          });

          context('when the action was cancelled', () => {
            sharedBeforeEach('schedule and cancel action', async () => {
              id = await schedule();
              await authorizer.cancel(id, { from: grantee });
            });

            it('reverts', async () => {
              await expect(authorizer.execute(id, { from })).to.be.revertedWith('ACTION_ALREADY_CANCELLED');
            });
          });
        });

        context('when the sender is not an allowed executor', () => {
          sharedBeforeEach('set sender', async () => {
            from = grantee;
          });

          it('reverts', async () => {
            id = await schedule();
            await advanceTime(delay);

            await expect(authorizer.execute(id, { from })).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });

      context('when the action is not protected', () => {
        sharedBeforeEach('set executors', async () => {
          executors = [];
        });

        it('can be executed by anyone', async () => {
          id = await schedule();
          await advanceTime(delay);

          await authorizer.execute(id);

          const scheduledExecution = await authorizer.scheduledExecutions(id);
          expect(scheduledExecution.executed).to.be.true;

          expect(await vault.getAuthorizer()).to.be.equal(newAuthorizer.address);
        });
      });
    });

    context('when the given id is not valid', () => {
      it('reverts', async () => {
        await expect(authorizer.execute(100)).to.be.revertedWith('ACTION_DOES_NOT_EXIST');
      });
    });
  });

  describe('cancel', () => {
    const delay = DAY;
    let executors: SignerWithAddress[], newAuthorizer: TimelockAuthorizer;

    sharedBeforeEach('deploy sample instances', async () => {
      newAuthorizer = await TimelockAuthorizer.create({ admin });
    });

    sharedBeforeEach('grant set authorizer permission with delay', async () => {
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.setDelay(setAuthorizerAction, delay, { from: admin });
      await authorizer.grantPermissions(setAuthorizerAction, grantee, vault, { from: admin });
    });

    const schedule = async (): Promise<number> => {
      const data = vault.interface.encodeFunctionData('setAuthorizer', [newAuthorizer.address]);
      return authorizer.schedule(vault, data, executors || [], { from: grantee });
    };

    context('when the given id is valid', () => {
      let id: BigNumberish;

      context('when the sender has permission for the requested action', () => {
        sharedBeforeEach('set sender', async () => {
          from = grantee;
        });

        context('when the action was not executed', () => {
          sharedBeforeEach('schedule execution', async () => {
            id = await schedule();
          });

          it('cancels the action', async () => {
            await authorizer.cancel(id, { from });

            const scheduledExecution = await authorizer.scheduledExecutions(id);
            expect(scheduledExecution.cancelled).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await authorizer.cancel(id, { from });

            expectEvent.inReceipt(await receipt.wait(), 'ExecutionCancelled', { scheduledExecutionId: id });
          });

          it('cannot be cancelled twice', async () => {
            await authorizer.cancel(id, { from });

            await expect(authorizer.cancel(id, { from })).to.be.revertedWith('ACTION_ALREADY_CANCELLED');
          });
        });

        context('when the action was executed', () => {
          sharedBeforeEach('schedule and execute action', async () => {
            id = await schedule();
            await advanceTime(delay);
            await authorizer.execute(id);
          });

          it('reverts', async () => {
            await expect(authorizer.cancel(id, { from })).to.be.revertedWith('ACTION_ALREADY_EXECUTED');
          });
        });
      });

      context('when the sender does not have permission for the requested action', () => {
        sharedBeforeEach('set sender', async () => {
          from = admin;
        });

        it('reverts', async () => {
          id = await schedule();

          await expect(authorizer.cancel(id, { from })).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });
    });

    context('when the given id is not valid', () => {
      it('reverts', async () => {
        await expect(authorizer.cancel(100)).to.be.revertedWith('ACTION_DOES_NOT_EXIST');
      });
    });
  });

  describe('setRoot', () => {
    const ROOT_CHANGE_DELAY = 7 * DAY;

    context('when trying to execute it directly', async () => {
      it('reverts', async () => {
        await expect(authorizer.instance.setRoot(grantee.address)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when trying to schedule a call', async () => {
      it('schedules a root change', async () => {
        const expectedData = authorizer.instance.interface.encodeFunctionData('setRoot', [grantee.address]);

        const id = await authorizer.scheduleRootChange(grantee, [], { from: admin });

        const scheduledExecution = await authorizer.scheduledExecutions(id);
        expect(scheduledExecution.executed).to.be.false;
        expect(scheduledExecution.data).to.be.equal(expectedData);
        expect(scheduledExecution.where).to.be.equal(authorizer.address);
        expect(scheduledExecution.protected).to.be.false;
        expect(scheduledExecution.executableAt).to.be.at.most((await currentTimestamp()).add(ROOT_CHANGE_DELAY));
      });

      it('can be executed after the delay', async () => {
        const id = await authorizer.scheduleRootChange(grantee, [], { from: admin });

        await expect(authorizer.execute(id)).to.be.revertedWith('ACTION_NOT_EXECUTABLE');

        await advanceTime(ROOT_CHANGE_DELAY);
        await authorizer.execute(id);

        expect(await authorizer.isRoot(admin)).to.be.false;
        expect(await authorizer.isRoot(grantee)).to.be.true;
      });

      it('emits an event', async () => {
        const id = await authorizer.scheduleRootChange(grantee, [], { from: admin });

        await advanceTime(ROOT_CHANGE_DELAY);
        const receipt = await authorizer.execute(id);
        expectEvent.inReceipt(await receipt.wait(), 'RootSet', { root: grantee.address });
      });
    });
  });
});
