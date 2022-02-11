import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import Authorizer from '@balancer-labs/v2-helpers/src/models/authorizer/Authorizer';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { advanceTime, currentTimestamp, DAY } from '@balancer-labs/v2-helpers/src/time';

describe('Authorizer', () => {
  let authorizer: Authorizer;
  let admin: SignerWithAddress, grantee: SignerWithAddress, from: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, grantee] = await ethers.getSigners();
  });

  const ACTION_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ACTION_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';
  const ACTIONS = [ACTION_1, ACTION_2];

  const EVERYWHERE = Authorizer.EVERYWHERE;
  const WHERE = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
  const NOT_WHERE = ethers.Wallet.createRandom().address;

  sharedBeforeEach('deploy authorizer', async () => {
    authorizer = await Authorizer.create({ admin });
  });

  describe('admin', () => {
    let GRANT_PERMISSION: string, REVOKE_PERMISSION: string;

    sharedBeforeEach('set constants', async () => {
      GRANT_PERMISSION = await authorizer.GRANT_PERMISSION();
      REVOKE_PERMISSION = await authorizer.REVOKE_PERMISSION();
    });

    it('defines its permissions correctly', async () => {
      expect(GRANT_PERMISSION).to.be.equal(ethers.utils.solidityKeccak256(['string'], ['GRANT_PERMISSION']));
      expect(REVOKE_PERMISSION).to.be.equal(ethers.utils.solidityKeccak256(['string'], ['REVOKE_PERMISSION']));

      const expectedGrantId = ethers.utils.solidityKeccak256(
        ['bytes32', 'address', 'address'],
        [GRANT_PERMISSION, admin.address, EVERYWHERE]
      );
      expect(await authorizer.permissionId(GRANT_PERMISSION, admin, EVERYWHERE)).to.be.equal(expectedGrantId);

      const expectedRevokeId = ethers.utils.solidityKeccak256(
        ['bytes32', 'address', 'address'],
        [REVOKE_PERMISSION, admin.address, EVERYWHERE]
      );
      expect(await authorizer.permissionId(REVOKE_PERMISSION, admin, EVERYWHERE)).to.be.equal(expectedRevokeId);
    });

    it('can grant permissions everywhere', async () => {
      expect(await authorizer.canPerform(GRANT_PERMISSION, admin, WHERE)).to.be.true;
      expect(await authorizer.canPerform(GRANT_PERMISSION, admin, EVERYWHERE)).to.be.true;
    });

    it('can revoke permissions everywhere', async () => {
      expect(await authorizer.canPerform(REVOKE_PERMISSION, admin, WHERE)).to.be.true;
      expect(await authorizer.canPerform(REVOKE_PERMISSION, admin, EVERYWHERE)).to.be.true;
    });

    it('can grant permission to other address to grant permissions for a custom contract', async () => {
      await authorizer.grantPermissions(GRANT_PERMISSION, grantee, WHERE[0], { from: admin });

      expect(await authorizer.canPerform(GRANT_PERMISSION, grantee, WHERE[0])).to.be.true;
      expect(await authorizer.canPerform(GRANT_PERMISSION, grantee, EVERYWHERE)).to.be.false;
    });

    it('can grant permission to other address to grant permissions everywhere', async () => {
      await authorizer.grantPermissionsGlobally(GRANT_PERMISSION, grantee, { from: admin });

      expect(await authorizer.canPerform(GRANT_PERMISSION, grantee, WHERE)).to.be.true;
      expect(await authorizer.canPerform(GRANT_PERMISSION, grantee, EVERYWHERE)).to.be.true;
    });

    it('can grant permission to other address to revoke permissions for a custom contract', async () => {
      await authorizer.grantPermissions(REVOKE_PERMISSION, grantee, WHERE[0], { from: admin });

      expect(await authorizer.canPerform(REVOKE_PERMISSION, grantee, WHERE[0])).to.be.true;
      expect(await authorizer.canPerform(REVOKE_PERMISSION, grantee, EVERYWHERE)).to.be.false;
    });

    it('can grant permission to other address to revoke permissions everywhere', async () => {
      await authorizer.grantPermissionsGlobally(REVOKE_PERMISSION, grantee, { from: admin });

      expect(await authorizer.canPerform(REVOKE_PERMISSION, grantee, WHERE)).to.be.true;
      expect(await authorizer.canPerform(REVOKE_PERMISSION, grantee, EVERYWHERE)).to.be.true;
    });

    it('can have their global permissions revoked by an authorized address for any contract', async () => {
      await authorizer.grantPermissions(REVOKE_PERMISSION, grantee, EVERYWHERE, { from: admin });

      await authorizer.revokePermissions(GRANT_PERMISSION, admin, EVERYWHERE, { from: grantee });
      expect(await authorizer.canPerform(GRANT_PERMISSION, admin, WHERE)).to.be.false;
      expect(await authorizer.canPerform(GRANT_PERMISSION, admin, EVERYWHERE)).to.be.false;

      await authorizer.revokePermissions(REVOKE_PERMISSION, admin, EVERYWHERE, { from: grantee });
      expect(await authorizer.canPerform(REVOKE_PERMISSION, admin, WHERE)).to.be.false;
      expect(await authorizer.canPerform(REVOKE_PERMISSION, admin, EVERYWHERE)).to.be.false;
    });

    it('cannot have their global permissions revoked by an authorized address for a specific contract', async () => {
      await authorizer.grantPermissions(REVOKE_PERMISSION, grantee, WHERE[0], { from: admin });
      await authorizer.grantPermissions(REVOKE_PERMISSION, grantee, WHERE[1], { from: admin });

      await expect(
        authorizer.revokePermissions(GRANT_PERMISSION, admin, EVERYWHERE, { from: grantee })
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');

      await expect(
        authorizer.revokePermissions(REVOKE_PERMISSION, admin, EVERYWHERE, { from: grantee })
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });

  describe('grantPermissions', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        from = admin;
      });

      context('when the target does not have the permission granted', () => {
        it('grants permission to perform the requested actions for the requested contracts', async () => {
          await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

          expect(await authorizer.canPerform(ACTIONS[0], grantee, WHERE[0])).to.be.true;
          expect(await authorizer.canPerform(ACTIONS[1], grantee, WHERE[1])).to.be.true;
        });

        it('does not grant permission to perform the requested actions everywhere', async () => {
          await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.false;
        });

        it('does not grant permission to perform the requested actions for other contracts', async () => {
          await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.false;
        });

        it('emits an event', async () => {
          const receipt = await (await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).wait();

          ACTIONS.forEach((action, i) => {
            expectEvent.inReceipt(receipt, 'PermissionGranted', {
              action,
              account: grantee.address,
              where: WHERE[i],
            });
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

            expect(await authorizer.canPerform(ACTIONS[0], grantee, WHERE[0])).to.be.true;
            expect(await authorizer.canPerform(ACTIONS[1], grantee, WHERE[1])).to.be.true;
          });

          it('does not grant permission to perform the requested actions everywhere', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.false;
          });

          it('does not grant permission to perform the requested actions for other contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.false;
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

            expect(await authorizer.canPerform(ACTIONS, grantee, WHERE)).to.be.true;
          });

          it('still can perform the requested actions everywhere', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.true;
          });

          it('still can perform the requested actions for other contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).wait();

            ACTIONS.forEach((action, i) => {
              expectEvent.inReceipt(receipt, 'PermissionGranted', {
                action,
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

          expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.true;
        });

        it('grants permission to perform the requested actions in any specific contract', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.true;
        });

        it('emits an event', async () => {
          const receipt = await (await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).wait();

          for (const action of ACTIONS) {
            expectEvent.inReceipt(receipt, 'PermissionGranted', {
              action,
              account: grantee.address,
              where: Authorizer.EVERYWHERE,
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

            expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.true;
          });

          it('still can perform the requested actions for the previously granted contracts', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, WHERE)).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).wait();

            for (const action of ACTIONS) {
              expectEvent.inReceipt(receipt, 'PermissionGranted', {
                action,
                account: grantee.address,
                where: Authorizer.EVERYWHERE,
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

            expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.true;
          });

          it('ignores the request and can still perform the requested actions in any specific contract', async () => {
            await expect(authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

            expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.true;
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

          expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.false;
        });

        it('ignores the request and cannot perform the requested actions in any specific contract', async () => {
          await expect(authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.false;
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

          it('revokes the requested permission for the requested contracts', async () => {
            await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, WHERE)).to.be.false;
          });

          it('still cannot perform the requested actions everywhere', async () => {
            await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.false;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from })).wait();

            ACTIONS.forEach((action, i) => {
              expectEvent.inReceipt(receipt, 'PermissionRevoked', {
                action,
                account: grantee.address,
                where: WHERE[i],
              });
            });
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
          });

          it('still can perform the requested actions for the requested contracts', async () => {
            await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, WHERE)).to.be.true;
          });

          it('still can perform the requested actions everywhere', async () => {
            await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.true;
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

          expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.false;
        });

        it('ignores the request and cannot perform the requested actions in any specific contract', async () => {
          await expect(authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.false;
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

            expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.false;
          });

          it('still can perform the requested actions for the previously granted permissions', async () => {
            await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTIONS[0], grantee, WHERE[0])).to.be.true;
            expect(await authorizer.canPerform(ACTIONS[1], grantee, WHERE[1])).to.be.true;
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

            expect(await authorizer.canPerform(ACTIONS, grantee, WHERE)).to.be.false;
          });

          it('cannot perform the requested actions in any specific contract', async () => {
            await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.false;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from })).wait();

            for (const action of ACTIONS) {
              expectEvent.inReceipt(receipt, 'PermissionRevoked', {
                action,
                account: grantee.address,
                where: Authorizer.EVERYWHERE,
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

        expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.false;
      });

      it('ignores the request and still cannot perform the requested actions in any specific contract', async () => {
        await expect(authorizer.renouncePermissions(ACTIONS, WHERE, { from })).not.to.be.reverted;

        expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.false;
      });
    });

    context('when the sender has the permission granted', () => {
      context('when the sender has the permission granted for a specific contract', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from: admin });
        });

        it('revokes the requested permission for the requested contracts', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, WHERE)).to.be.false;
        });

        it('still cannot perform the requested actions everywhere', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.false;
        });
      });

      context('when the sender has the permission granted globally', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from: admin });
        });

        it('still can perform the requested actions for the requested contracts', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, WHERE)).to.be.true;
        });

        it('still can perform the requested actions everywhere', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.true;
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

        expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.false;
      });

      it('ignores the request and still cannot perform the requested actions in any specific contract', async () => {
        await expect(authorizer.renouncePermissionsGlobally(ACTIONS, { from })).not.to.be.reverted;

        expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.false;
      });
    });

    context('when the sender has the permission granted', () => {
      context('when the sender has the permission granted for a specific contract', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from: admin });
        });

        it('still can perform the requested actions for the requested contracts', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTIONS[0], grantee, WHERE[0])).to.be.true;
          expect(await authorizer.canPerform(ACTIONS[1], grantee, WHERE[1])).to.be.true;
        });

        it('still cannot perform the requested actions everywhere', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.false;
        });
      });

      context('when the sender has the permission granted globally', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from: admin });
        });

        it('revokes the requested permissions everywhere', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, EVERYWHERE)).to.be.false;
        });

        it('still cannot perform the requested actions in any specific contract', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.false;
        });
      });
    });
  });

  describe('setDelay', () => {
    const action = ACTION_1;
    const SET_DELAY_PERMISSION = ethers.utils.solidityKeccak256(['string'], ['SET_DELAY_PERMISSION']);

    const grantPermission = async (actionId: string) => {
      const setDelayAction = ethers.utils.solidityKeccak256(['bytes32', 'bytes32'], [SET_DELAY_PERMISSION, actionId]);
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

          context('when there was no previous delay', () => {
            it('schedules a delay change', async () => {
              const id = await authorizer.scheduleDelayChange(action, delay, [], { from: admin });

              const scheduledAction = await authorizer.scheduledActions(id);
              expect(scheduledAction.executed).to.be.false;
              expect(scheduledAction.data).to.be.equal(expectedData);
              expect(scheduledAction.where).to.be.equal(authorizer.address);
              expect(scheduledAction.protected).to.be.false;
              expect(scheduledAction.executableAt).to.be.at.most(await currentTimestamp());
            });

            it('can be executed immediately', async () => {
              const id = await authorizer.scheduleDelayChange(action, delay, [], { from: admin });

              await authorizer.execute(id);
              expect(await authorizer.delay(action)).to.be.equal(delay);
            });

            it('emits an event', async () => {
              const id = await authorizer.scheduleDelayChange(action, delay, [], { from: admin });

              const receipt = await authorizer.execute(id);
              expectEvent.inReceipt(await receipt.wait(), 'ActionDelaySet', { action, delay });
            });
          });

          context('when there was a previous delay set', () => {
            const previousDelay = delay * 2;

            sharedBeforeEach('set previous delay', async () => {
              const id = await authorizer.scheduleDelayChange(action, previousDelay, [], { from: admin });
              await authorizer.execute(id);
            });

            it('schedules a delay change', async () => {
              const id = await authorizer.scheduleDelayChange(action, delay, [], { from: admin });

              const scheduledAction = await authorizer.scheduledActions(id);
              expect(scheduledAction.executed).to.be.false;
              expect(scheduledAction.data).to.be.equal(expectedData);
              expect(scheduledAction.where).to.be.equal(authorizer.address);
              expect(scheduledAction.protected).to.be.false;
              expect(scheduledAction.executableAt).to.be.at.most((await currentTimestamp()).add(previousDelay));
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
              expectEvent.inReceipt(await receipt.wait(), 'ActionDelaySet', { action, delay });
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
    let vault: Contract, anotherVault: Contract, newAuthorizer: Authorizer;

    const SET_DELAY_PERMISSION = ethers.utils.solidityKeccak256(['string'], ['SET_DELAY_PERMISSION']);

    sharedBeforeEach('deploy sample instances', async () => {
      newAuthorizer = await Authorizer.create({ admin });
      vault = await deploy('Vault', { args: [authorizer.address, ZERO_ADDRESS, 0, 0] });
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
            action = await vault.getActionId(vault.interface.getSighash('setAuthorizer'));
          });

          context('when the sender has permission for the requested contract', () => {
            sharedBeforeEach('grant permission', async () => {
              await authorizer.grantPermissions(action, grantee, vault, { from: admin });
            });

            context('when there is a delay set', () => {
              const delay = DAY * 5;

              sharedBeforeEach('set delay', async () => {
                const args = [SET_DELAY_PERMISSION, action];
                const setDelayAction = ethers.utils.solidityKeccak256(['bytes32', 'bytes32'], args);
                await authorizer.grantPermissions(setDelayAction, admin, authorizer, { from: admin });
                const id = await authorizer.scheduleDelayChange(action, delay, [], { from: admin });
                await authorizer.execute(id);
              });

              context('when no executors are specified', () => {
                sharedBeforeEach('set executors', async () => {
                  executors = [];
                });

                it('schedules a non-protected action', async () => {
                  const id = await schedule();

                  const scheduledAction = await authorizer.scheduledActions(id);
                  expect(scheduledAction.executed).to.be.false;
                  expect(scheduledAction.data).to.be.equal(data);
                  expect(scheduledAction.where).to.be.equal(where.address);
                  expect(scheduledAction.protected).to.be.false;
                  expect(scheduledAction.executableAt).to.be.at.most((await currentTimestamp()).add(delay));
                });

                it('cannot execute the action immediately', async () => {
                  const id = await schedule();
                  await expect(authorizer.execute(id)).to.be.revertedWith('ACTION_NOT_EXECUTABLE');
                });

                it('can be executed by anyone', async () => {
                  const id = await schedule();
                  await advanceTime(delay);

                  const receipt = await authorizer.execute(id);
                  expectEvent.inReceipt(await receipt.wait(), 'ActionExecuted', { id });

                  const scheduledAction = await authorizer.scheduledActions(id);
                  expect(scheduledAction.executed).to.be.true;

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

                it('schedules the requested action', async () => {
                  const id = await schedule();

                  const scheduledAction = await authorizer.scheduledActions(id);
                  expect(scheduledAction.executed).to.be.false;
                  expect(scheduledAction.data).to.be.equal(data);
                  expect(scheduledAction.where).to.be.equal(where.address);
                  expect(scheduledAction.protected).to.be.true;
                  expect(scheduledAction.executableAt).to.be.at.most((await currentTimestamp()).add(delay));
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
                  expectEvent.inReceipt(await receipt.wait(), 'ActionExecuted', { id });

                  const scheduledAction = await authorizer.scheduledActions(id);
                  expect(scheduledAction.executed).to.be.true;

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
            action = await vault.getActionId(vault.interface.getSighash('setRelayerApproval'));
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
    let executors: SignerWithAddress[], vault: Contract, newAuthorizer: Authorizer;

    const SET_DELAY_PERMISSION = ethers.utils.solidityKeccak256(['string'], ['SET_DELAY_PERMISSION']);

    sharedBeforeEach('deploy sample instances', async () => {
      newAuthorizer = await Authorizer.create({ admin });
      vault = await deploy('Vault', { args: [authorizer.address, ZERO_ADDRESS, 0, 0] });
    });

    sharedBeforeEach('grant set authorizer permission with delay', async () => {
      const setAuthorizerAction = await vault.getActionId(vault.interface.getSighash('setAuthorizer'));
      const args = [SET_DELAY_PERMISSION, setAuthorizerAction];
      const setDelayAction = ethers.utils.solidityKeccak256(['bytes32', 'bytes32'], args);
      await authorizer.grantPermissions(setDelayAction, admin, authorizer, { from: admin });
      const id = await authorizer.scheduleDelayChange(setAuthorizerAction, delay, [], { from: admin });
      await authorizer.execute(id);
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
            sharedBeforeEach('schedule action', async () => {
              id = await schedule();
            });

            context('when the delay has passed', () => {
              sharedBeforeEach('set sender', async () => {
                await advanceTime(delay);
              });

              it('executes the action', async () => {
                await authorizer.execute(id, { from });

                const scheduledAction = await authorizer.scheduledActions(id);
                expect(scheduledAction.executed).to.be.true;

                expect(await vault.getAuthorizer()).to.be.equal(newAuthorizer.address);
              });

              it('emits an event', async () => {
                const receipt = await authorizer.execute(id, { from });

                expectEvent.inReceipt(await receipt.wait(), 'ActionExecuted', { id });
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

          const scheduledAction = await authorizer.scheduledActions(id);
          expect(scheduledAction.executed).to.be.true;

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
    let executors: SignerWithAddress[], vault: Contract, newAuthorizer: Authorizer;

    const SET_DELAY_PERMISSION = ethers.utils.solidityKeccak256(['string'], ['SET_DELAY_PERMISSION']);

    sharedBeforeEach('deploy sample instances', async () => {
      newAuthorizer = await Authorizer.create({ admin });
      vault = await deploy('Vault', { args: [authorizer.address, ZERO_ADDRESS, 0, 0] });
    });

    sharedBeforeEach('grant set authorizer permission with delay', async () => {
      const setAuthorizerAction = await vault.getActionId(vault.interface.getSighash('setAuthorizer'));
      const args = [SET_DELAY_PERMISSION, setAuthorizerAction];
      const setDelayAction = ethers.utils.solidityKeccak256(['bytes32', 'bytes32'], args);
      await authorizer.grantPermissions(setDelayAction, admin, authorizer, { from: admin });
      const id = await authorizer.scheduleDelayChange(setAuthorizerAction, delay, [], { from: admin });
      await authorizer.execute(id);
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
          sharedBeforeEach('schedule action', async () => {
            id = await schedule();
          });

          it('cancels the action', async () => {
            await authorizer.cancel(id, { from });

            const scheduledAction = await authorizer.scheduledActions(id);
            expect(scheduledAction.cancelled).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await authorizer.cancel(id, { from });

            expectEvent.inReceipt(await receipt.wait(), 'ActionCancelled', { id });
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
});
