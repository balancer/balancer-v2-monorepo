import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('Authorizer', () => {
  let authorizer: Contract;
  let admin: SignerWithAddress, grantee: SignerWithAddress, other: SignerWithAddress;

  const ANYWHERE = ZERO_ADDRESS;

  before('setup signers', async () => {
    [, admin, grantee, other] = await ethers.getSigners();
  });

  const PERMISSION_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const PERMISSION_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';

  const PERMISSIONS = [PERMISSION_1, PERMISSION_2];
  const WHERE = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
  const NOT_WHERE = ethers.Wallet.createRandom().address;

  sharedBeforeEach('deploy authorizer', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
  });

  describe('grantPermissions', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
      });

      it('grants a list of permissions globally', async () => {
        await authorizer.grantPermissionsGlobally(PERMISSIONS, grantee.address);

        for (const permission of PERMISSIONS) {
          expect(await authorizer.canPerform(permission, grantee.address, ANYWHERE)).to.be.true;
          expect(await authorizer.canPerform(permission, grantee.address, NOT_WHERE)).to.be.true;
        }
      });

      it('grants a list of permissions for a list of contracts', async () => {
        await authorizer.grantPermissions(PERMISSIONS, grantee.address, WHERE);

        for (const permission of PERMISSIONS) {
          for (const where of WHERE) {
            expect(await authorizer.canPerform(permission, grantee.address, where)).to.be.true;
            expect(await authorizer.canPerform(permission, grantee.address, NOT_WHERE)).to.be.false;
          }
        }
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(grantee);
      });

      it('reverts globally', async () => {
        await expect(authorizer.grantPermissionsGlobally(PERMISSIONS, grantee.address)).to.be.revertedWith(
          'GRANT_SENDER_NOT_ADMIN'
        );
      });
      it('reverts for specific permissions', async () => {
        await expect(authorizer.grantPermissions(PERMISSIONS, grantee.address, WHERE)).to.be.revertedWith(
          'GRANT_SENDER_NOT_ADMIN'
        );
      });
    });
  });

  describe('grantPermissionsToMany', () => {
    context('when the sender is the admin', () => {
      let randomAddress: string;
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
        randomAddress = ethers.Wallet.createRandom().address;
      });

      it('grants a list of permissions globally', async () => {
        await authorizer.grantPermissionsGloballyToMany(PERMISSIONS, [grantee.address, other.address]);

        expect(await authorizer.canPerform(PERMISSION_1, grantee.address, ANYWHERE)).to.be.true;
        expect(await authorizer.canPerform(PERMISSION_2, other.address, ANYWHERE)).to.be.true;

        expect(await authorizer.canPerform(PERMISSION_1, grantee.address, randomAddress)).to.be.true;
        expect(await authorizer.canPerform(PERMISSION_2, other.address, randomAddress)).to.be.true;

        expect(await authorizer.canPerform(PERMISSION_2, grantee.address, ANYWHERE)).to.be.false;
        expect(await authorizer.canPerform(PERMISSION_1, other.address, ANYWHERE)).to.be.false;
      });

      it('grants a list of permissions to a specific set of contracts', async () => {
        await authorizer.grantPermissionsToMany(PERMISSIONS, [grantee.address, other.address], WHERE);
        for (const where of WHERE) {
          expect(await authorizer.canPerform(PERMISSION_1, grantee.address, where)).to.be.true;
          expect(await authorizer.canPerform(PERMISSION_2, other.address, where)).to.be.true;

          expect(await authorizer.canPerform(PERMISSION_1, grantee.address, randomAddress)).to.be.false;
          expect(await authorizer.canPerform(PERMISSION_2, other.address, randomAddress)).to.be.false;

          expect(await authorizer.canPerform(PERMISSION_2, grantee.address, where)).to.be.false;
          expect(await authorizer.canPerform(PERMISSION_1, other.address, where)).to.be.false;
        }
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(grantee);
      });

      it('reverts globally', async () => {
        await expect(
          authorizer.grantPermissionsGloballyToMany(PERMISSIONS, [grantee.address, other.address])
        ).to.be.revertedWith('GRANT_SENDER_NOT_ADMIN');
      });

      it('reverts for specific wheres', async () => {
        await expect(
          authorizer.grantPermissionsToMany(PERMISSIONS, [grantee.address, other.address], WHERE)
        ).to.be.revertedWith('GRANT_SENDER_NOT_ADMIN');
      });
    });
  });

  describe('revokePermissions', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
      });

      context('when the permissions ANYWHERE granted to a set of contracts', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissions(PERMISSIONS, grantee.address, WHERE);
        });

        it('revokes a list of permissions', async () => {
          await authorizer.revokePermissions(PERMISSIONS, grantee.address, WHERE);

          for (const permission of PERMISSIONS) {
            for (const where of WHERE) {
              expect(await authorizer.canPerform(permission, grantee.address, where)).to.be.false;
            }
          }
        });
      });

      context('when the permissions granted globally', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissionsGlobally(PERMISSIONS, grantee.address);
        });

        it('revokes a list of permissions', async () => {
          await authorizer.revokePermissionsGlobally(PERMISSIONS, grantee.address);

          for (const permission of PERMISSIONS) {
            expect(await authorizer.canPerform(permission, grantee.address, ANYWHERE)).to.be.false;
          }
        });
      });

      context('when one of the permissions was not granted for a set of contracts', () => {
        sharedBeforeEach('grant one permission', async () => {
          await authorizer.grantPermission(PERMISSION_1, grantee.address, WHERE);
        });

        it('ignores the request', async () => {
          await authorizer.revokePermissions(PERMISSIONS, grantee.address, WHERE);

          for (const permission of PERMISSIONS) {
            for (const where of WHERE) {
              expect(await authorizer.canPerform(permission, grantee.address, where)).to.be.false;
            }
          }
        });
      });

      context('when one of the permissions was not granted globally', () => {
        sharedBeforeEach('grant one permission', async () => {
          await authorizer.grantPermissionGlobally(PERMISSION_1, grantee.address);
        });

        it('ignores the request', async () => {
          await authorizer.revokePermissionsGlobally(PERMISSIONS, grantee.address);

          for (const permission of PERMISSIONS) {
            expect(await authorizer.canPerform(permission, grantee.address, ANYWHERE)).to.be.false;
          }
        });
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(grantee);
      });

      it('reverts globally', async () => {
        await expect(authorizer.revokePermissionsGlobally(PERMISSIONS, grantee.address)).to.be.revertedWith(
          'REVOKE_SENDER_NOT_ADMIN'
        );
      });

      it('reverts for a set of contracts', async () => {
        await expect(authorizer.revokePermissions(PERMISSIONS, grantee.address, WHERE)).to.be.revertedWith(
          'REVOKE_SENDER_NOT_ADMIN'
        );
      });
    });
  });

  describe('revokePermissionsFromMany', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
      });

      context('when the permissions ANYWHERE granted globally', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissionsGloballyToMany(PERMISSIONS, [grantee.address, other.address]);
        });

        it('revokes a list of permissions', async () => {
          await authorizer.revokePermissionsGloballyFromMany(PERMISSIONS, [grantee.address, other.address]);

          for (const permission of PERMISSIONS) {
            expect(await authorizer.canPerform(permission, grantee.address, ANYWHERE)).to.be.false;
            expect(await authorizer.canPerform(permission, other.address, ANYWHERE)).to.be.false;
          }
        });
      });

      context('when the permissions ANYWHERE granted to a set of contracts', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissionsToMany(PERMISSIONS, [grantee.address, other.address], WHERE);
        });

        it('revokes a list of permissions', async () => {
          await authorizer.revokePermissionsFromMany(PERMISSIONS, [grantee.address, other.address], WHERE);

          for (const permission of PERMISSIONS) {
            for (const where of WHERE) {
              expect(await authorizer.canPerform(permission, grantee.address, where)).to.be.false;
              expect(await authorizer.canPerform(permission, other.address, where)).to.be.false;
            }
          }
        });
      });

      context('when one of the permissions was not granted globally', () => {
        sharedBeforeEach('grant one permission', async () => {
          await authorizer.grantPermissionsGlobally([PERMISSION_1], grantee.address);
        });

        it('ignores the request', async () => {
          await authorizer.revokePermissionsGloballyFromMany(PERMISSIONS, [grantee.address, other.address]);

          for (const permission of PERMISSIONS) {
            expect(await authorizer.canPerform(permission, grantee.address, ANYWHERE)).to.be.false;
            expect(await authorizer.canPerform(permission, other.address, ANYWHERE)).to.be.false;
          }
        });
      });

      context('when one of the permissions was not granted for a set of contracts', () => {
        sharedBeforeEach('grant one permission', async () => {
          await authorizer.grantPermissions([PERMISSION_1], grantee.address, WHERE);
        });

        it('ignores the request', async () => {
          await authorizer.revokePermissionsFromMany(PERMISSIONS, [grantee.address, other.address], WHERE);

          for (const permission of PERMISSIONS) {
            for (const where of WHERE) {
              expect(await authorizer.canPerform(permission, grantee.address, where)).to.be.false;
              expect(await authorizer.canPerform(permission, other.address, where)).to.be.false;
            }
          }
        });
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(grantee);
      });

      it('reverts globally', async () => {
        await expect(
          authorizer.revokePermissionsGloballyFromMany(PERMISSIONS, [grantee.address, other.address])
        ).to.be.revertedWith('REVOKE_SENDER_NOT_ADMIN');
      });
      it('reverts for a set of contracts', async () => {
        await expect(
          authorizer.revokePermissionsFromMany(PERMISSIONS, [grantee.address, other.address], WHERE)
        ).to.be.revertedWith('REVOKE_SENDER_NOT_ADMIN');
      });
    });
  });
});
