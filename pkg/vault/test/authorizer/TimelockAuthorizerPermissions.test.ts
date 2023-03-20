import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TimelockAuthorizer from '@balancer-labs/v2-helpers/src/models/authorizer/TimelockAuthorizer';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { advanceTime, DAY } from '@balancer-labs/v2-helpers/src/time';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('TimelockAuthorizer permissions', () => {
  let authorizer: TimelockAuthorizer, vault: Contract, authenticatedContract: Contract;
  let root: SignerWithAddress,
    nextRoot: SignerWithAddress,
    revoker: SignerWithAddress,
    granter: SignerWithAddress,
    user: SignerWithAddress;

  before('setup signers', async () => {
    [, root, nextRoot, granter, revoker, user] = await ethers.getSigners();
  });

  const GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID = MAX_UINT256;

  const ACTION_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ACTION_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';

  const WHERE_1 = ethers.Wallet.createRandom().address;
  const WHERE_2 = ethers.Wallet.createRandom().address;

  const EVERYWHERE = TimelockAuthorizer.EVERYWHERE;
  const NOT_WHERE = ethers.Wallet.createRandom().address;

  sharedBeforeEach('deploy authorizer', async () => {
    let authorizerContract: Contract;

    ({ instance: vault, authorizer: authorizerContract } = await Vault.create({
      admin: root,
      nextAdmin: nextRoot.address,
    }));

    authorizer = new TimelockAuthorizer(authorizerContract, root);
    authenticatedContract = await deploy('MockAuthenticatedContract', { args: [vault.address] });
  });

  describe('permissions', () => {
    describe('grantPermission', () => {
      context('when there is a delay set to grant permissions', () => {
        const delay = DAY;

        sharedBeforeEach('set delay', async () => {
          const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
          await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, delay * 2, { from: root });
          await authorizer.scheduleAndExecuteGrantDelayChange(ACTION_1, delay, { from: root });
        });

        it('reverts if requires a schedule', async () => {
          await expect(authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: root })).to.be.revertedWith(
            'GRANT_MUST_BE_SCHEDULED'
          );
        });

        it('can schedule a grant permission', async () => {
          const id = await authorizer.scheduleGrantPermission(ACTION_1, user, WHERE_1, [], { from: root });

          // should not be able to execute before delay
          await expect(authorizer.execute(id, { from: root })).to.be.revertedWith('ACTION_NOT_YET_EXECUTABLE');

          await advanceTime(delay);
          await authorizer.execute(id, { from: root });

          expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, user, WHERE_2)).to.be.false;
        });
      });

      context('when there is a no delay set to grant permissions', () => {
        it('reverts if the sender is not the granter', async () => {
          await expect(authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: granter })).to.be.revertedWith(
            'SENDER_IS_NOT_GRANTER'
          );
        });

        function itGrantsPermissionCorrectly(getSender: () => SignerWithAddress) {
          context('when the target does not have the permission', () => {
            context('when granting the permission for a contract', () => {
              it('grants permission to perform the requested action for the requested contract', async () => {
                await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
              });

              it('does not grant permission to perform the requested action everywhere', async () => {
                await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
              });

              it('does not grant permission to perform the requested actions for other contracts', async () => {
                await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, NOT_WHERE)).to.be.false;
              });

              it('emits an event', async () => {
                const receipt = await (
                  await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() })
                ).wait();

                expectEvent.inReceipt(receipt, 'PermissionGranted', {
                  actionId: ACTION_1,
                  account: user.address,
                  where: WHERE_1,
                });
              });
            });
            context('when granting the permission for everywhere', () => {
              it('grants the permission to perform the requested action everywhere', async () => {
                await authorizer.grantPermissionGlobally(ACTION_1, user, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.true;
                expect(await authorizer.canPerform(ACTION_2, user, EVERYWHERE)).to.be.false;
              });

              it('grants permission to perform the requested action in any specific contract', async () => {
                await authorizer.grantPermissionGlobally(ACTION_1, user, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, NOT_WHERE)).to.be.true;
                expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.true;
              });

              it('emits an event', async () => {
                const receipt = await (
                  await authorizer.grantPermissionGlobally(ACTION_1, user, { from: getSender() })
                ).wait();

                expectEvent.inReceipt(receipt, 'PermissionGranted', {
                  actionId: ACTION_1,
                  account: user.address,
                  where: TimelockAuthorizer.EVERYWHERE,
                });
              });
            });
          });

          context('when the target has the permission for a contract', () => {
            sharedBeforeEach('grant a permission', async () => {
              await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() });
            });
            context('when granting the permission for a contract', () => {
              it('ignores the request and can still perform the action', async () => {
                await expect(authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() })).not.to
                  .reverted;

                expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
              });

              it('does not grant the permission to perform the requested action everywhere', async () => {
                await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
              });

              it('does not grant the permission to perform the requested action for other contracts', async () => {
                await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, NOT_WHERE)).to.be.false;
                expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
              });

              it('does not emit an event', async () => {
                const tx = await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() });
                expectEvent.notEmitted(await tx.wait(), 'PermissionGranted');
              });
            });
            context('when granting the permission for everywhere', () => {
              it('grants permission to perform the requested action everywhere', async () => {
                await authorizer.grantPermissionGlobally(ACTION_1, user, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.true;
              });

              it('still can perform the requested action for the previously granted contracts', async () => {
                await authorizer.grantPermissionGlobally(ACTION_2, user, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
                expect(await authorizer.canPerform(ACTION_2, user, WHERE_1)).to.be.true;
                expect(await authorizer.canPerform(ACTION_2, user, WHERE_2)).to.be.true;
              });

              it('emits an event', async () => {
                const receipt = await (
                  await authorizer.grantPermissionGlobally(ACTION_1, user, { from: getSender() })
                ).wait();

                expectEvent.inReceipt(receipt, 'PermissionGranted', {
                  actionId: ACTION_1,
                  account: user.address,
                  where: TimelockAuthorizer.EVERYWHERE,
                });
              });
            });
          });

          context('when the target has the permission for everywhere', () => {
            sharedBeforeEach('grant the permission', async () => {
              await authorizer.grantPermissionGlobally(ACTION_1, user, { from: getSender() });
            });

            context('when granting the permission for a contract', () => {
              it('grants the permission to perform the requested action for the requested contract', async () => {
                await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
                expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.true;
              });

              it('still can perform the requested actions everywhere', async () => {
                await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.true;
                expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.true;
              });

              it('still can perform the requested actions for other contracts', async () => {
                await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, NOT_WHERE)).to.be.true;
                expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.true;
              });

              it('emits an event', async () => {
                const receipt = await (
                  await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() })
                ).wait();
                expectEvent.inReceipt(receipt, 'PermissionGranted', {
                  actionId: ACTION_1,
                  account: user.address,
                  where: WHERE_1,
                });
              });
            });
            context('when granting the permission for everywhere', () => {
              it('ignores the request and can still perform the requested action everywhere', async () => {
                await expect(authorizer.grantPermissionGlobally(ACTION_1, user, { from: getSender() })).not.to.be
                  .reverted;

                expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.true;
              });

              it('ignores the request and can still perform the requested action in any specific contract', async () => {
                await expect(authorizer.grantPermissionGlobally(ACTION_1, user, { from: getSender() })).not.to.be
                  .reverted;

                expect(await authorizer.canPerform(ACTION_1, user, NOT_WHERE)).to.be.true;
                expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
              });

              it('does not emit an event', async () => {
                const tx = await authorizer.grantPermissionGlobally(ACTION_1, user, { from: getSender() });
                expectEvent.notEmitted(await tx.wait(), 'PermissionGrantedGlobally');
              });
            });
          });
        }

        context('when the sender is root', () => {
          itGrantsPermissionCorrectly(() => root);
        });

        context('when the sender is granter', () => {
          sharedBeforeEach('makes a granter', async () => {
            await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root });
            await authorizer.addGranter(ACTION_2, granter, EVERYWHERE, { from: root });
          });
          itGrantsPermissionCorrectly(() => granter);
        });
      });
    });

    describe('scheduleGrantPermission', () => {});

    describe.only('revokePermission', () => {
      const delay = DAY;
      context('when there is a delay set to revoke permissions', () => {
        sharedBeforeEach('set delay', async () => {
          const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
          await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, delay * 2, { from: root });
          await authorizer.scheduleAndExecuteRevokeDelayChange(ACTION_1, delay, { from: root });
        });

        it('reverts if requires a schedule', async () => {
          await expect(authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: root })).to.be.revertedWith(
            'REVOKE_MUST_BE_SCHEDULED'
          );
        });

        it('can schedule a revoke permission', async () => {
          const id = await authorizer.scheduleRevokePermission(ACTION_1, user, WHERE_1, [], { from: root });

          // should not be able to execute before delay
          await expect(authorizer.execute(id, { from: root })).to.be.revertedWith('ACTION_NOT_YET_EXECUTABLE');

          await advanceTime(delay);
          await authorizer.execute(id, { from: root });

          expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, user, WHERE_2)).to.be.false;
        });
      });

      context('when there is a no delay set to revoke permissions', () => {
        it('reverts if the sender is not the revoker', async () => {
          await expect(authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: revoker })).to.be.revertedWith(
            'SENDER_IS_NOT_REVOKER'
          );
        });

        function itRevokesPermissionCorrectly(getSender: () => SignerWithAddress) {
          context('when the user does not have the permission', () => {
            it('ignores the request and cannot perform the requested action everywhere', async () => {
              await expect(authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: getSender() })).not.to.be.reverted;

              expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, user, EVERYWHERE)).to.be.false;
            });

            it('ignores the request and cannot perform the requested action in any specific contract', async () => {
              await expect(authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: getSender() })).not.to.be.reverted;

              expect(await authorizer.canPerform(ACTION_1, user, NOT_WHERE)).to.be.false;
              expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
            });

            it('does not emit an event', async () => {
              const tx = await authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: getSender() });
              expectEvent.notEmitted(await tx.wait(), 'PermissionRevoked');
            });
          });

          context('when the user has the permission for a contract', () => {
            sharedBeforeEach('grants the permission', async () => {
              await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: root });
            });
            context('when revoking the permission for a contract', () => {
              it('revokes the requested permission for the requested contract', async () => {
                await authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.false;
                expect(await authorizer.canPerform(ACTION_2, user, WHERE_1)).to.be.false;
                expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
                expect(await authorizer.canPerform(ACTION_2, user, WHERE_2)).to.be.false;
              });

              it('still cannot perform the requested action everywhere', async () => {
                await authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
                expect(await authorizer.canPerform(ACTION_2, user, EVERYWHERE)).to.be.false;
              });

              it('emits an event', async () => {
                const receipt = await (
                  await authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: getSender() })
                ).wait();

                expectEvent.inReceipt(receipt, 'PermissionRevoked', {
                  actionId: ACTION_1,
                  account: user.address,
                  where: WHERE_1,
                });
              });
            });

            context('when revoking the permission for a everywhere', () => {
              it('still cannot perform the requested action everywhere', async () => {
                await authorizer.revokePermissionGlobally(ACTION_1, user, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
                expect(await authorizer.canPerform(ACTION_2, user, EVERYWHERE)).to.be.false;
              });

              it('still can perform the requested action for the previously granted permissions', async () => {
                await authorizer.revokePermissionGlobally(ACTION_1, user, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
              });

              it('does not emit an event', async () => {
                const tx = await authorizer.revokePermissionGlobally(ACTION_1, user, { from: getSender() });
                expectEvent.notEmitted(await tx.wait(), 'PermissionRevokedGlobally');
              });
            });
          });

          context('when the user has the permission everywhere', () => {
            sharedBeforeEach('grants the permissions', async () => {
              await authorizer.grantPermissionGlobally(ACTION_1, user, { from: root });
            });
            context('when revoking the permission for a contract', () => {
              it('still can perform the requested action for the requested contract', async () => {
                await authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
                expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.true;
              });

              it('still can perform the requested action everywhere', async () => {
                await authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: getSender() });

                expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.true;
              });

              it('does not emit an event', async () => {
                const tx = await authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: getSender() });
                expectEvent.notEmitted(await tx.wait(), 'PermissionRevoked');
              });
            });
            context('when revoking the permission for a everywhere', () => {});
            it('revokes the requested global permission and cannot perform the requested action everywhere', async () => {
              await authorizer.revokePermissionGlobally(ACTION_1, user, { from: getSender() });

              expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.false;
              expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
            });

            it('cannot perform the requested action in any specific contract', async () => {
              await authorizer.revokePermissionGlobally(ACTION_1, user, { from: getSender() });

              expect(await authorizer.canPerform(ACTION_1, user, NOT_WHERE)).to.be.false;
              expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
            });

            it('emits an event', async () => {
              const receipt = await (
                await authorizer.revokePermissionGlobally(ACTION_1, user, { from: getSender() })
              ).wait();

              expectEvent.inReceipt(receipt, 'PermissionRevoked', {
                actionId: ACTION_1,
                account: user.address,
                where: TimelockAuthorizer.EVERYWHERE,
              });
            });
          });
        }

        context('when the sender is root', () => {
          itRevokesPermissionCorrectly(() => root);
        });

        context('when the sender is revoker', () => {
          sharedBeforeEach('makes a revoker', async () => {
            await authorizer.addRevoker(revoker, EVERYWHERE, { from: root });
          });
          itRevokesPermissionCorrectly(() => revoker);
        });
      });
    });

    describe('scheduleRevokePermission', () => {});
  });

  describe.only('renounce', () => {
    describe('renouncePermission', () => {
      context('when the sender does not have the permission granted', () => {
        it('ignores the request and still cannot perform the requested action everywhere', async () => {
          await expect(authorizer.renouncePermission(ACTION_1, WHERE_1, { from: granter })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.false;
        });

        it('ignores the request and still cannot perform the requested action in any specific contract', async () => {
          await expect(authorizer.renouncePermission(ACTION_1, WHERE_1, { from: granter })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, granter, NOT_WHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.false;
        });
      });

      context('when the sender has the permission granted', () => {
        context('when the sender has the permission granted for a specific contract', () => {
          sharedBeforeEach('grants the permission', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });
          });

          it('revokes the requested permission for the requested contract', async () => {
            await authorizer.renouncePermission(ACTION_1, WHERE_1, { from: granter });

            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, granter, WHERE_1)).to.be.false;
            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, granter, WHERE_2)).to.be.false;
          });

          it('still cannot perform the requested action everywhere', async () => {
            await authorizer.renouncePermission(ACTION_1, WHERE_1, { from: granter });

            expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.false;
          });
        });

        context('when the sender has the permission granted everywhere', () => {
          sharedBeforeEach('grants the permission', async () => {
            await authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root });
          });

          it('still can perform the requested actions for the requested contract', async () => {
            await authorizer.renouncePermission(ACTION_1, WHERE_1, { from: granter });

            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.true;
          });

          it('still can perform the requested action everywhere', async () => {
            await authorizer.renouncePermission(ACTION_1, WHERE_1, { from: granter });

            expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.true;
          });
        });
      });
    });

    describe('renouncePermissionGlobally', () => {
      context('when the sender does not have the permission', () => {
        it('ignores the request and still cannot perform the requested action everywhere', async () => {
          await expect(authorizer.renouncePermissionGlobally(ACTION_1, { from: granter })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.false;
        });

        it('ignores the request and still cannot perform the requested action in any specific contract', async () => {
          await expect(authorizer.renouncePermissionGlobally(ACTION_1, { from: granter })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, granter, NOT_WHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.false;
        });
      });

      context('when the sender has the permission granted', () => {
        context('when the sender has the permission granted for a specific contract', () => {
          sharedBeforeEach('grants the permission', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });
          });

          it('still can perform the requested action for the requested contract', async () => {
            await authorizer.renouncePermissionGlobally(ACTION_1, { from: granter });

            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.true;
          });

          it('still cannot perform the requested action everywhere', async () => {
            await authorizer.renouncePermissionGlobally(ACTION_1, { from: granter });

            expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, granter, EVERYWHERE)).to.be.false;
          });
        });

        context('when the sender has the permission granted everywhere', () => {
          sharedBeforeEach('grants the permission', async () => {
            await authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root });
          });

          it('revokes the requested permissions everywhere', async () => {
            await authorizer.renouncePermissionGlobally(ACTION_1, { from: granter });

            expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.false;
          });

          it('still cannot perform the requested action in any specific contract', async () => {
            await authorizer.renouncePermissionGlobally(ACTION_1, { from: granter });

            expect(await authorizer.canPerform(ACTION_1, granter, NOT_WHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.false;
          });
        });
      });
    });
  });
});
