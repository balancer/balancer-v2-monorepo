import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import Authorizer from '@balancer-labs/v2-helpers/src/models/authorizer/Authorizer';

describe('Authorizer', () => {
  let authorizer: Authorizer;
  let admin: SignerWithAddress, grantee: SignerWithAddress, from: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, grantee] = await ethers.getSigners();
  });

  const ROLE_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ROLE_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';
  const ACTIONS = [ROLE_1, ROLE_2];

  const ANYWHERE = ZERO_ADDRESS;
  const WHERE = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
  const NOT_WHERE = ethers.Wallet.createRandom().address;

  sharedBeforeEach('deploy authorizer', async () => {
    authorizer = await Authorizer.create({ admin });
  });

  describe('grantRoles', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        from = admin;
      });

      context('when the target does not have the permission granted', () => {
        it('grants permission to perform the requested actions for the requested contracts', async () => {
          await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, WHERE)).to.be.true;
        });

        it('does not grant permission to perform the requested actions anywhere', async () => {
          await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.false;
        });

        it('does not grant permission to perform the requested actions for other contracts', async () => {
          await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.false;
        });

        it('emits an event', async () => {
          const receipt = await (await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).wait();

          for (const [action, where] of authorizer.permissionsFor(ACTIONS, WHERE)) {
            expectEvent.inReceipt(receipt, 'RoleGranted', {
              role: action,
              account: grantee.address,
              where: where,
              sender: admin.address,
            });
          }
        });
      });

      context('when the target has the permission granted', () => {
        context('when the permission was granted for a set of contracts', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          });

          it('ignores the request and can still perform those actions', async () => {
            await expect(authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).not.to.reverted;

            expect(await authorizer.canPerform(ACTIONS, grantee, WHERE)).to.be.true;
          });

          it('does not grant permission to perform the requested actions anywhere', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.false;
          });

          it('does not grant permission to perform the requested actions for other contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.false;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
            expectEvent.notEmitted(await tx.wait(), 'RoleGranted');
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

          it('still can perform the requested actions anywhere', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.true;
          });

          it('still can perform the requested actions for other contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).wait();

            for (const [action, where] of authorizer.permissionsFor(ACTIONS, WHERE)) {
              expectEvent.inReceipt(receipt, 'RoleGranted', {
                role: action,
                account: grantee.address,
                where: where,
                sender: admin.address,
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
        await expect(authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).to.be.revertedWith(
          'GRANT_SENDER_NOT_ADMIN'
        );
      });
    });
  });

  describe('grantRolesGlobally', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        from = admin;
      });

      context('when the target does not have the permission granted', () => {
        it('grants permission to perform the requested actions anywhere', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.true;
        });

        it('grants permission to perform the requested actions in any specific contract', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.true;
        });

        it('emits an event', async () => {
          const receipt = await (await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).wait();

          for (const action of ACTIONS) {
            expectEvent.inReceipt(receipt, 'RoleGrantedGlobally', {
              role: action,
              account: grantee.address,
              sender: admin.address,
            });
          }
        });
      });

      context('when the target has the permission granted', () => {
        context('when the permission was granted for a set of contracts', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          });

          it('grants permission to perform the requested actions anywhere', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.true;
          });

          it('still can perform the requested actions for the previously granted contracts', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, WHERE)).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).wait();

            for (const action of ACTIONS) {
              expectEvent.inReceipt(receipt, 'RoleGrantedGlobally', {
                role: action,
                account: grantee.address,
                sender: admin.address,
              });
            }
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
          });

          it('ignores the request and can still perform the requested actions anywhere', async () => {
            await expect(authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

            expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.true;
          });

          it('ignores the request and can still perform the requested actions in any specific contract', async () => {
            await expect(authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

            expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.true;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
            expectEvent.notEmitted(await tx.wait(), 'RoleGrantedGlobally');
          });
        });
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        from = grantee;
      });

      it('reverts', async () => {
        await expect(authorizer.grantPermissionsGlobally(ACTIONS, grantee)).to.be.revertedWith(
          'GRANT_SENDER_NOT_ADMIN'
        );
      });
    });
  });

  describe('revokeRoles', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        from = admin;
      });

      context('when the target does not have the permission granted', () => {
        it('ignores the request and cannot perform the requested actions anywhere', async () => {
          await expect(authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.false;
        });

        it('ignores the request and cannot perform the requested actions in any specific contract', async () => {
          await expect(authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.false;
        });

        it('does not emit an event', async () => {
          const tx = await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          expectEvent.notEmitted(await tx.wait(), 'RoleRevoked');
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

          it('still cannot perform the requested actions anywhere', async () => {
            await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.false;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from })).wait();

            for (const [action, where] of authorizer.permissionsFor(ACTIONS, WHERE)) {
              expectEvent.inReceipt(receipt, 'RoleRevoked', {
                role: action,
                account: grantee.address,
                where: where,
                sender: admin.address,
              });
            }
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

          it('still can perform the requested actions anywhere', async () => {
            await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.true;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
            expectEvent.notEmitted(await tx.wait(), 'RoleRevoked');
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
          'REVOKE_SENDER_NOT_ADMIN'
        );
      });
    });
  });

  describe('revokeRolesGlobally', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        from = admin;
      });

      context('when the sender does not have the permission granted', () => {
        it('ignores the request and cannot perform the requested actions anywhere', async () => {
          await expect(authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.false;
        });

        it('ignores the request and cannot perform the requested actions in any specific contract', async () => {
          await expect(authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.false;
        });

        it('does not emit an event', async () => {
          const tx = await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });
          expectEvent.notEmitted(await tx.wait(), 'RoleRevokedGlobally');
        });
      });

      context('when the grantee has the permission granted', () => {
        context('when the permission was granted for a set of contracts', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          });

          it('still cannot perform the requested actions anywhere', async () => {
            await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.false;
          });

          it('still can perform the requested actions for the previously granted permissions', async () => {
            await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTIONS, grantee, WHERE)).to.be.true;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });
            expectEvent.notEmitted(await tx.wait(), 'RoleRevokedGlobally');
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
          });

          it('revokes the requested global permission and cannot perform the requested actions anywhere', async () => {
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
              expectEvent.inReceipt(receipt, 'RoleRevokedGlobally', {
                role: action,
                account: grantee.address,
                sender: admin.address,
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
          'REVOKE_SENDER_NOT_ADMIN'
        );
      });
    });
  });

  describe('renounceRoles', () => {
    beforeEach('set sender', async () => {
      from = grantee;
    });

    context('when the sender does not have the permission granted', () => {
      it('ignores the request and still cannot perform the requested actions anywhere', async () => {
        await expect(authorizer.renouncePermissions(ACTIONS, WHERE, { from })).not.to.be.reverted;

        expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.false;
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

        it('still cannot perform the requested actions anywhere', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.false;
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

        it('still can perform the requested actions anywhere', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.true;
        });
      });
    });
  });

  describe('renounceRolesGlobally', () => {
    beforeEach('set sender', async () => {
      from = grantee;
    });

    context('when the sender does not have the permission granted', () => {
      it('ignores the request and still cannot perform the requested actions anywhere', async () => {
        await expect(authorizer.renouncePermissionsGlobally(ACTIONS, { from })).not.to.be.reverted;

        expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.false;
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

          expect(await authorizer.canPerform(ACTIONS, grantee, WHERE)).to.be.true;
        });

        it('still cannot perform the requested actions anywhere', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.false;
        });
      });

      context('when the sender has the permission granted globally', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from: admin });
        });

        it('revokes the requested permissions anywhere', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, ANYWHERE)).to.be.false;
        });

        it('still cannot perform the requested actions in any specific contract', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTIONS, grantee, NOT_WHERE)).to.be.false;
        });
      });
    });
  });
});
