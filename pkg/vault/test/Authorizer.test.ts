import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

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

  describe('delayed calls', () => {
    let actionDelayId: string;
    let setActionDelayEncoded: string;
    sharedBeforeEach('get action delay Id', async () => {
      actionDelayId = ethers.utils.keccak256(authorizer.interface.getSighash('setActionDelay'));
      setActionDelayEncoded = authorizer.interface.encodeFunctionData('setActionDelay', [ROLE_1, 3600]);
    });
    context('initial conditions', () => {
      it('setActionDelay is delayed by minimum delay initially', async () => {
        expect(await authorizer._SET_ACTION_DELAY()).to.equal(actionDelayId);
        expect(await authorizer.getDelay(actionDelayId)).to.equal(await authorizer._MIN_DELAY());
      });
    });

    context('creating delayed call', () => {
      sharedBeforeEach('get action delay Id', async () => {
        actionDelayId = ethers.utils.keccak256(authorizer.interface.getSighash('setActionDelay'));
        await authorizer.connect(admin).grantRoleGlobally(ROLE_1, grantee.address);
        await authorizer.connect(admin).grantRoleGlobally(actionDelayId, grantee.address);
      });
      context('fails creating delayed calls', () => {
        it('if not authorized', async () => {
          await expect(
            authorizer.connect(other).deployDelayedCall(ROLE_1, WHERE[0], 0, ROLE_1, true)
          ).to.be.revertedWith('Invalid permission');
        });

        it('if not creating it for a delayed action', async () => {
          await expect(
            authorizer.connect(grantee).deployDelayedCall(ROLE_1, WHERE[0], 0, ROLE_1, true)
          ).to.be.revertedWith('Not a delayed action');
        });
      });

      context('creates a delayed call', () => {
        it('successfully', async () => {
          const delayedCallAddress = await authorizer
            .connect(grantee)
            .callStatic.deployDelayedCall(actionDelayId, authorizer.address, 0, setActionDelayEncoded, false);
          const tx = await authorizer
            .connect(grantee)
            .deployDelayedCall(actionDelayId, authorizer.address, 0, setActionDelayEncoded, false);
          const receipt = await tx.wait();
          expectEvent.inReceipt(receipt, 'DelayedCallScheduled', {
            actionId: actionDelayId,
            callAddress: delayedCallAddress,
            where: authorizer.address,
            value: 0,
            data: setActionDelayEncoded,
            delay: 3600,
          });
          expect(await authorizer.getDelayedCallsAt(actionDelayId, 0)).to.equal(delayedCallAddress);
          expect(await authorizer.getDelayedCallsCount(actionDelayId)).to.equal(1);
        });
      });

      context('sets a delay', () => {
        it('by creating a delayed call that triggers setDelay', async () => {
          const delayedCallAddress = await authorizer
            .connect(grantee)
            .callStatic.deployDelayedCall(actionDelayId, authorizer.address, 0, setActionDelayEncoded, false);
          await authorizer
            .connect(grantee)
            .deployDelayedCall(actionDelayId, authorizer.address, 0, setActionDelayEncoded, false);
          await authorizer.connect(admin).grantRoleGlobally(actionDelayId, delayedCallAddress);
          await ethers.provider.send('evm_increaseTime', [3600]);
          await ethers.provider.send('evm_mine', []);
          const delayedCall = await ethers.getContractAt('DelayedCall', delayedCallAddress);
          await delayedCall.trigger();
          expect(await authorizer.getDelay(ROLE_1)).to.equal(3600);
        });
      });
    });
  });
});
