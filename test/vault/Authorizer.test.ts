import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { expect } from 'chai';
import { ZERO_ADDRESS } from '../../lib/helpers/constants';

describe('Authorizer', () => {
  let authorizer: Contract;
  let admin: SignerWithAddress, grantee: SignerWithAddress, other: SignerWithAddress;

  const WHERE = ZERO_ADDRESS;

  before('setup signers', async () => {
    [, admin, grantee, other] = await ethers.getSigners();
  });

  const ROLE_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ROLE_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';

  const ROLES = [ROLE_1, ROLE_2];

  sharedBeforeEach('deploy authorizer', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
  });

  describe('grantRoles', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
      });

      it('grants a list of roles', async () => {
        await authorizer.grantRoles(ROLES, grantee.address);

        for (const role of ROLES) {
          expect(await authorizer.canPerform(role, grantee.address, WHERE)).to.be.true;
        }
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(grantee);
      });

      it('reverts', async () => {
        await expect(authorizer.grantRoles(ROLES, grantee.address)).to.be.revertedWith('GRANT_SENDER_NOT_ADMIN');
      });
    });
  });

  describe('grantRolesToMany', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
      });

      it('grants a list of roles', async () => {
        await authorizer.grantRolesToMany(ROLES, [grantee.address, other.address]);

        expect(await authorizer.canPerform(ROLE_1, grantee.address, WHERE)).to.be.true;
        expect(await authorizer.canPerform(ROLE_2, other.address, WHERE)).to.be.true;

        expect(await authorizer.canPerform(ROLE_2, grantee.address, WHERE)).to.be.false;
        expect(await authorizer.canPerform(ROLE_1, other.address, WHERE)).to.be.false;
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(grantee);
      });

      it('reverts', async () => {
        await expect(authorizer.grantRolesToMany(ROLES, [grantee.address, other.address])).to.be.revertedWith(
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

      context('when the roles where granted', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantRoles(ROLES, grantee.address);
        });

        it('revokes a list of roles', async () => {
          await authorizer.revokeRoles(ROLES, grantee.address);

          for (const role of ROLES) {
            expect(await authorizer.canPerform(role, grantee.address, WHERE)).to.be.false;
          }
        });
      });

      context('when one of the roles was not granted', () => {
        sharedBeforeEach('grant one role', async () => {
          await authorizer.grantRole(ROLE_1, grantee.address);
        });

        it('ignores the request', async () => {
          await authorizer.revokeRoles(ROLES, grantee.address);

          for (const role of ROLES) {
            expect(await authorizer.canPerform(role, grantee.address, WHERE)).to.be.false;
          }
        });
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(grantee);
      });

      it('reverts', async () => {
        await expect(authorizer.revokeRoles(ROLES, grantee.address)).to.be.revertedWith('REVOKE_SENDER_NOT_ADMIN');
      });
    });
  });

  describe('revokeRolesFromMany', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
      });

      context('when the roles where granted', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantRolesToMany(ROLES, [grantee.address, other.address]);
        });

        it('revokes a list of roles', async () => {
          await authorizer.revokeRolesFromMany(ROLES, [grantee.address, other.address]);

          for (const role of ROLES) {
            expect(await authorizer.canPerform(role, grantee.address, WHERE)).to.be.false;
            expect(await authorizer.canPerform(role, other.address, WHERE)).to.be.false;
          }
        });
      });

      context('when one of the roles was not granted', () => {
        sharedBeforeEach('grant one role', async () => {
          await authorizer.grantRoles([ROLE_1], grantee.address);
        });

        it('ignores the request', async () => {
          await authorizer.revokeRolesFromMany(ROLES, [grantee.address, other.address]);

          for (const role of ROLES) {
            expect(await authorizer.canPerform(role, grantee.address, WHERE)).to.be.false;
            expect(await authorizer.canPerform(role, other.address, WHERE)).to.be.false;
          }
        });
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(grantee);
      });

      it('reverts', async () => {
        await expect(authorizer.revokeRolesFromMany(ROLES, [grantee.address, other.address])).to.be.revertedWith(
          'REVOKE_SENDER_NOT_ADMIN'
        );
      });
    });
  });
});
