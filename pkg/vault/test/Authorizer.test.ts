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

  const ROLE_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ROLE_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';

  const ROLES = [ROLE_1, ROLE_2];
  const WHERE = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
  const NOT_WHERE = ethers.Wallet.createRandom().address;

  sharedBeforeEach('deploy authorizer', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
  });

  describe('grantRoles', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
      });

      it('grants a list of roles globally', async () => {
        await authorizer.grantRolesGlobally(ROLES, grantee.address);

        for (const role of ROLES) {
          expect(await authorizer.canPerform(role, grantee.address, ANYWHERE)).to.be.true;
          expect(await authorizer.canPerform(role, grantee.address, NOT_WHERE)).to.be.true;
        }
      });

      it('grants a list of roles for a list of contracts', async () => {
        await authorizer.grantRoles(ROLES, grantee.address, WHERE);

        for (const role of ROLES) {
          for (const where of WHERE) {
            expect(await authorizer.canPerform(role, grantee.address, where)).to.be.true;
            expect(await authorizer.canPerform(role, grantee.address, NOT_WHERE)).to.be.false;
          }
        }
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(grantee);
      });

      it('reverts globally', async () => {
        await expect(authorizer.grantRolesGlobally(ROLES, grantee.address)).to.be.revertedWith(
          'GRANT_SENDER_NOT_ADMIN'
        );
      });
      it('reverts for specific roles', async () => {
        await expect(authorizer.grantRoles(ROLES, grantee.address, WHERE)).to.be.revertedWith('GRANT_SENDER_NOT_ADMIN');
      });
    });
  });

  describe('grantRolesToMany', () => {
    context('when the sender is the admin', () => {
      let randomAddress: string;
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
        randomAddress = ethers.Wallet.createRandom().address;
      });

      it('grants a list of roles globally', async () => {
        await authorizer.grantRolesGloballyToMany(ROLES, [grantee.address, other.address]);

        expect(await authorizer.canPerform(ROLE_1, grantee.address, ANYWHERE)).to.be.true;
        expect(await authorizer.canPerform(ROLE_2, other.address, ANYWHERE)).to.be.true;

        expect(await authorizer.canPerform(ROLE_1, grantee.address, randomAddress)).to.be.true;
        expect(await authorizer.canPerform(ROLE_2, other.address, randomAddress)).to.be.true;

        expect(await authorizer.canPerform(ROLE_2, grantee.address, ANYWHERE)).to.be.false;
        expect(await authorizer.canPerform(ROLE_1, other.address, ANYWHERE)).to.be.false;
      });

      it('grants a list of roles to a specific set of contracts', async () => {
        await authorizer.grantRolesToMany(ROLES, [grantee.address, other.address], WHERE);
        for (const where of WHERE) {
          expect(await authorizer.canPerform(ROLE_1, grantee.address, where)).to.be.true;
          expect(await authorizer.canPerform(ROLE_2, other.address, where)).to.be.true;

          expect(await authorizer.canPerform(ROLE_1, grantee.address, randomAddress)).to.be.false;
          expect(await authorizer.canPerform(ROLE_2, other.address, randomAddress)).to.be.false;

          expect(await authorizer.canPerform(ROLE_2, grantee.address, where)).to.be.false;
          expect(await authorizer.canPerform(ROLE_1, other.address, where)).to.be.false;
        }
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(grantee);
      });

      it('reverts globally', async () => {
        await expect(authorizer.grantRolesGloballyToMany(ROLES, [grantee.address, other.address])).to.be.revertedWith(
          'GRANT_SENDER_NOT_ADMIN'
        );
      });

      it('reverts for specific wheres', async () => {
        await expect(authorizer.grantRolesToMany(ROLES, [grantee.address, other.address], WHERE)).to.be.revertedWith(
          'GRANT_SENDER_NOT_ADMIN'
        );
      });
    });
  });

  describe('revokeRoles', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
      });

      context('when the roles ANYWHERE granted to a set of contracts', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantRoles(ROLES, grantee.address, WHERE);
        });

        it('revokes a list of roles', async () => {
          await authorizer.revokeRoles(ROLES, grantee.address, WHERE);

          for (const role of ROLES) {
            for (const where of WHERE) {
              expect(await authorizer.canPerform(role, grantee.address, where)).to.be.false;
            }
          }
        });
      });

      context('when the roles granted globally', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantRolesGlobally(ROLES, grantee.address);
        });

        it('revokes a list of roles', async () => {
          await authorizer.revokeRolesGlobally(ROLES, grantee.address);

          for (const role of ROLES) {
            expect(await authorizer.canPerform(role, grantee.address, ANYWHERE)).to.be.false;
          }
        });
      });

      context('when one of the roles was not granted for a set of contracts', () => {
        sharedBeforeEach('grant one role', async () => {
          await authorizer.grantRole(ROLE_1, grantee.address, WHERE);
        });

        it('ignores the request', async () => {
          await authorizer.revokeRoles(ROLES, grantee.address, WHERE);

          for (const role of ROLES) {
            for (const where of WHERE) {
              expect(await authorizer.canPerform(role, grantee.address, where)).to.be.false;
            }
          }
        });
      });

      context('when one of the roles was not granted globally', () => {
        sharedBeforeEach('grant one role', async () => {
          await authorizer.grantRoleGlobally(ROLE_1, grantee.address);
        });

        it('ignores the request', async () => {
          await authorizer.revokeRolesGlobally(ROLES, grantee.address);

          for (const role of ROLES) {
            expect(await authorizer.canPerform(role, grantee.address, ANYWHERE)).to.be.false;
          }
        });
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(grantee);
      });

      it('reverts globally', async () => {
        await expect(authorizer.revokeRolesGlobally(ROLES, grantee.address)).to.be.revertedWith(
          'REVOKE_SENDER_NOT_ADMIN'
        );
      });

      it('reverts for a set of contracts', async () => {
        await expect(authorizer.revokeRoles(ROLES, grantee.address, WHERE)).to.be.revertedWith(
          'REVOKE_SENDER_NOT_ADMIN'
        );
      });
    });
  });

  describe('revokeRolesFromMany', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
      });

      context('when the roles ANYWHERE granted globally', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantRolesGloballyToMany(ROLES, [grantee.address, other.address]);
        });

        it('revokes a list of roles', async () => {
          await authorizer.revokeRolesGloballyFromMany(ROLES, [grantee.address, other.address]);

          for (const role of ROLES) {
            expect(await authorizer.canPerform(role, grantee.address, ANYWHERE)).to.be.false;
            expect(await authorizer.canPerform(role, other.address, ANYWHERE)).to.be.false;
          }
        });
      });

      context('when the roles ANYWHERE granted to a set of contracts', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantRolesToMany(ROLES, [grantee.address, other.address], WHERE);
        });

        it('revokes a list of roles', async () => {
          await authorizer.revokeRolesFromMany(ROLES, [grantee.address, other.address], WHERE);

          for (const role of ROLES) {
            for (const where of WHERE) {
              expect(await authorizer.canPerform(role, grantee.address, where)).to.be.false;
              expect(await authorizer.canPerform(role, other.address, where)).to.be.false;
            }
          }
        });
      });

      context('when one of the roles was not granted globally', () => {
        sharedBeforeEach('grant one role', async () => {
          await authorizer.grantRolesGlobally([ROLE_1], grantee.address);
        });

        it('ignores the request', async () => {
          await authorizer.revokeRolesGloballyFromMany(ROLES, [grantee.address, other.address]);

          for (const role of ROLES) {
            expect(await authorizer.canPerform(role, grantee.address, ANYWHERE)).to.be.false;
            expect(await authorizer.canPerform(role, other.address, ANYWHERE)).to.be.false;
          }
        });
      });

      context('when one of the roles was not granted for a set of contracts', () => {
        sharedBeforeEach('grant one role', async () => {
          await authorizer.grantRoles([ROLE_1], grantee.address, WHERE);
        });

        it('ignores the request', async () => {
          await authorizer.revokeRolesFromMany(ROLES, [grantee.address, other.address], WHERE);

          for (const role of ROLES) {
            for (const where of WHERE) {
              expect(await authorizer.canPerform(role, grantee.address, where)).to.be.false;
              expect(await authorizer.canPerform(role, other.address, where)).to.be.false;
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
          authorizer.revokeRolesGloballyFromMany(ROLES, [grantee.address, other.address])
        ).to.be.revertedWith('REVOKE_SENDER_NOT_ADMIN');
      });
      it('reverts for a set of contracts', async () => {
        await expect(authorizer.revokeRolesFromMany(ROLES, [grantee.address, other.address], WHERE)).to.be.revertedWith(
          'REVOKE_SENDER_NOT_ADMIN'
        );
      });
    });
  });
});
