import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { expect } from 'chai';

describe('Authorizer', () => {
  let authorizer: Contract;
  let admin: SignerWithAddress, someone: SignerWithAddress, anotherone: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, someone, anotherone] = await ethers.getSigners();
  });

  const ROLE_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ROLE_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';

  const ROLES = [ROLE_1, ROLE_2];

  beforeEach('deploy authorizer', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
  });

  describe('grantRoles', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
      });

      it('grants a list of roles', async () => {
        await authorizer.grantRoles(ROLES, someone.address);

        for (const role of ROLES) {
          expect(await authorizer.hasRole(role, someone.address)).to.be.true;
        }
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(someone);
      });

      it('reverts', async () => {
        await expect(authorizer.grantRoles(ROLES, someone.address)).to.be.revertedWith('GRANT_SENDER_NOT_ADMIN');
      });
    });
  });

  describe('grantRolesToMany', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
      });

      it('grants a list of roles', async () => {
        await authorizer.grantRolesToMany(ROLES, [someone.address, anotherone.address]);

        expect(await authorizer.hasRole(ROLE_1, someone.address)).to.be.true;
        expect(await authorizer.hasRole(ROLE_2, anotherone.address)).to.be.true;

        expect(await authorizer.hasRole(ROLE_2, someone.address)).to.be.false;
        expect(await authorizer.hasRole(ROLE_1, anotherone.address)).to.be.false;
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(someone);
      });

      it('reverts', async () => {
        await expect(authorizer.grantRolesToMany(ROLES, [someone.address, anotherone.address])).to.be.revertedWith(
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
        beforeEach('grant roles', async () => {
          await authorizer.grantRoles(ROLES, someone.address);
        });

        it('revokes a list of roles', async () => {
          await authorizer.revokeRoles(ROLES, someone.address);

          for (const role of ROLES) {
            expect(await authorizer.hasRole(role, someone.address)).to.be.false;
          }
        });
      });

      context('when one of the roles was not granted', () => {
        beforeEach('grant one role', async () => {
          await authorizer.grantRole(ROLE_1, someone.address);
        });

        it('ignores the request', async () => {
          await authorizer.revokeRoles(ROLES, someone.address);

          for (const role of ROLES) {
            expect(await authorizer.hasRole(role, someone.address)).to.be.false;
          }
        });
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(someone);
      });

      it('reverts', async () => {
        await expect(authorizer.revokeRoles(ROLES, someone.address)).to.be.revertedWith('REVOKE_SENDER_NOT_ADMIN');
      });
    });
  });

  describe('revokeRolesToMany', () => {
    context('when the sender is the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(admin);
      });

      context('when the roles where granted', () => {
        beforeEach('grant roles', async () => {
          await authorizer.grantRolesToMany(ROLES, [someone.address, anotherone.address]);
        });

        it('revokes a list of roles', async () => {
          await authorizer.revokeRolesToMany(ROLES, [someone.address, anotherone.address]);

          for (const role of ROLES) {
            expect(await authorizer.hasRole(role, someone.address)).to.be.false;
            expect(await authorizer.hasRole(role, anotherone.address)).to.be.false;
          }
        });
      });

      context('when one of the roles was not granted', () => {
        beforeEach('grant one role', async () => {
          await authorizer.grantRoles([ROLE_1], someone.address);
        });

        it('ignores the request', async () => {
          await authorizer.revokeRolesToMany(ROLES, [someone.address, anotherone.address]);

          for (const role of ROLES) {
            expect(await authorizer.hasRole(role, someone.address)).to.be.false;
            expect(await authorizer.hasRole(role, anotherone.address)).to.be.false;
          }
        });
      });
    });

    context('when the sender is not the admin', () => {
      beforeEach('set sender', async () => {
        authorizer = authorizer.connect(someone);
      });

      it('reverts', async () => {
        await expect(authorizer.revokeRolesToMany(ROLES, [someone.address, anotherone.address])).to.be.revertedWith(
          'REVOKE_SENDER_NOT_ADMIN'
        );
      });
    });
  });
});
