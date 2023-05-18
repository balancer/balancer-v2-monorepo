import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TimelockAuthorizer from '@balancer-labs/v2-helpers/src/models/authorizer/TimelockAuthorizer';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { advanceTime, currentTimestamp, DAY } from '@balancer-labs/v2-helpers/src/time';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { randomAddress, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { range } from 'lodash';

describe('TimelockAuthorizer permissions', () => {
  let authorizer: TimelockAuthorizer, vault: Contract;
  let root: SignerWithAddress,
    nextRoot: SignerWithAddress,
    revoker: SignerWithAddress,
    granter: SignerWithAddress,
    user: SignerWithAddress,
    other: SignerWithAddress;

  before('setup signers', async () => {
    [, root, nextRoot, granter, revoker, user, other] = await ethers.getSigners();
  });

  const ACTION_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ACTION_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';
  const ACTION_3 = '0x0000000000000000000000000000000000000000000000000000000000000003';

  const WHERE_1 = ethers.Wallet.createRandom().address;
  const WHERE_2 = ethers.Wallet.createRandom().address;
  const WHERE_3 = ethers.Wallet.createRandom().address;

  const EVERYWHERE = TimelockAuthorizer.EVERYWHERE;
  const NOT_WHERE = ethers.Wallet.createRandom().address;
  const MINIMUM_EXECUTION_DELAY = 5 * DAY;

  sharedBeforeEach('deploy authorizer', async () => {
    let authorizerContract: Contract;

    ({ instance: vault, authorizer: authorizerContract } = await Vault.create({
      admin: root,
      nextAdmin: nextRoot.address,
    }));

    authorizer = new TimelockAuthorizer(authorizerContract, root);
  });

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
    });

    context('when there is a no delay set to grant permissions', () => {
      function itGrantsPermissionCorrectly(getSender: () => SignerWithAddress) {
        it('reverts if the sender is not the granter', async () => {
          await expect(authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_GRANTER'
          );
        });
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

          it('cannot grant the permission twice', async () => {
            await expect(authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() })).to.be.revertedWith(
              'PERMISSION_ALREADY_GRANTED'
            );
          });

          context('when granting the permission for everywhere', () => {
            it('grants permission to perform the requested action everywhere', async () => {
              await authorizer.grantPermissionGlobally(ACTION_1, user, { from: getSender() });

              expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.true;
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

        context('when the target has the permission for everywhere', () => {
          sharedBeforeEach('grant the permission', async () => {
            await authorizer.grantPermissionGlobally(ACTION_1, user, { from: getSender() });
          });

          context('when granting the permission for a contract', () => {
            it('cannot grant the permission twice', async () => {
              await expect(
                authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: getSender() })
              ).to.be.revertedWith('PERMISSION_ALREADY_GRANTED');
            });
          });

          it('cannot grant the permision twice', async () => {
            await expect(authorizer.grantPermissionGlobally(ACTION_1, user, { from: getSender() })).to.revertedWith(
              'PERMISSION_ALREADY_GRANTED'
            );
          });
        });
      }

      context('when the sender is root', () => {
        itGrantsPermissionCorrectly(() => root);
      });

      context('when the sender is granter everywhere', () => {
        sharedBeforeEach('makes a granter', async () => {
          await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root });
          await authorizer.addGranter(ACTION_2, granter, EVERYWHERE, { from: root });
        });
        itGrantsPermissionCorrectly(() => granter);

        it('cannot grant the permission in other actions', async () => {
          await expect(authorizer.grantPermission(ACTION_3, user, WHERE_1, { from: granter })).to.be.revertedWith(
            'SENDER_IS_NOT_GRANTER'
          );
        });
      });

      context('when the sender is granter at a specific contract', () => {
        sharedBeforeEach('makes a granter', async () => {
          await authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root });
        });

        it('reverts if the sender is not the granter', async () => {
          await expect(authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_GRANTER'
          );
        });

        it('cannot grant the permission in other contracts', async () => {
          await expect(authorizer.grantPermission(ACTION_1, user, WHERE_3, { from: granter })).to.be.revertedWith(
            'SENDER_IS_NOT_GRANTER'
          );
        });

        it('cannot grant the permission for other actions', async () => {
          await expect(authorizer.grantPermission(ACTION_3, user, WHERE_1, { from: granter })).to.be.revertedWith(
            'SENDER_IS_NOT_GRANTER'
          );
        });

        context('when the target does not have the permission', () => {
          context('when granting the permission for a contract', () => {
            it('grants permission to perform the requested action for the requested contract', async () => {
              await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: granter });

              expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
            });

            it('does not grant permission to perform the requested action everywhere', async () => {
              await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: granter });

              expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
            });

            it('does not grant permission to perform the requested actions for other contracts', async () => {
              await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: granter });

              expect(await authorizer.canPerform(ACTION_1, user, NOT_WHERE)).to.be.false;
            });

            it('emits an event', async () => {
              const receipt = await (
                await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: granter })
              ).wait();

              expectEvent.inReceipt(receipt, 'PermissionGranted', {
                actionId: ACTION_1,
                account: user.address,
                where: WHERE_1,
              });
            });
          });
        });

        context('when the target has the permission for a contract', () => {
          it('cannot grant the same permission twice', async () => {
            await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: granter });
            await expect(authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: granter })).to.revertedWith(
              'PERMISSION_ALREADY_GRANTED'
            );
          });
        });

        context('when the target has the permission for everywhere', () => {
          sharedBeforeEach('grant the permission', async () => {
            await authorizer.grantPermissionGlobally(ACTION_1, user, { from: root });
          });

          context('when granting the permission for a contract', () => {
            it('cannot grant the permission twice', async () => {
              await expect(authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: granter })).to.be.revertedWith(
                'PERMISSION_ALREADY_GRANTED'
              );
            });
          });
        });
      });
    });
  });

  describe('scheduleGrantPermission', () => {
    const delay = DAY;

    sharedBeforeEach('set delay', async () => {
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, delay * 2, { from: root });
      await authorizer.scheduleAndExecuteGrantDelayChange(ACTION_1, delay, { from: root });
    });

    it('reverts if action has no grant delay', async () => {
      await expect(authorizer.scheduleGrantPermission(ACTION_2, user, WHERE_1, [], { from: root })).to.be.revertedWith(
        'ACTION_HAS_NO_GRANT_DELAY'
      );
    });

    it('reverts if sender is not granter', async () => {
      await expect(authorizer.scheduleGrantPermission(ACTION_1, user, WHERE_1, [], { from: other })).to.be.revertedWith(
        'SENDER_IS_NOT_GRANTER'
      );
    });

    function itScheduleGrantPermissionCorrectly(getSender: () => SignerWithAddress) {
      it('schedules a grant permission', async () => {
        const id = await authorizer.scheduleGrantPermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        const { executed, data, where, executableAt } = await authorizer.getScheduledExecution(id);
        expect(executed).to.be.false;
        expect(data).to.be.equal(
          authorizer.instance.interface.encodeFunctionData('grantPermission', [ACTION_1, user.address, WHERE_1])
        );
        expect(where).to.be.equal(authorizer.address);
        expect(executableAt).to.equal((await currentTimestamp()).add(delay));
      });

      it('increases the scheduled execution count', async () => {
        const countBefore = await authorizer.instance.getScheduledExecutionsCount();
        await authorizer.scheduleGrantPermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        const countAfter = await authorizer.instance.getScheduledExecutionsCount();

        expect(countAfter).to.equal(countBefore.add(1));
      });

      it('stores scheduler information', async () => {
        const id = await authorizer.scheduleGrantPermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        const scheduledExecution = await authorizer.getScheduledExecution(id);
        expect(scheduledExecution.scheduledBy).to.equal(getSender().address);
        expect(scheduledExecution.scheduledAt).to.equal(await currentTimestamp());
      });

      it('stores empty executor and canceler information', async () => {
        const id = await authorizer.scheduleGrantPermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        const scheduledExecution = await authorizer.getScheduledExecution(id);
        expect(scheduledExecution.executedBy).to.equal(ZERO_ADDRESS);
        expect(scheduledExecution.executedAt).to.equal(0);
        expect(scheduledExecution.canceledBy).to.equal(ZERO_ADDRESS);
        expect(scheduledExecution.canceledAt).to.equal(0);
      });

      it('execution can be unprotected', async () => {
        const id = await authorizer.scheduleGrantPermission(ACTION_1, user, WHERE_1, [], { from: getSender() });
        const execution = await authorizer.getScheduledExecution(id);

        expect(execution.protected).to.be.false;
      });

      it('execution can be protected', async () => {
        const executors = range(4).map(randomAddress);
        const id = await authorizer.scheduleGrantPermission(ACTION_1, user, WHERE_1, executors, { from: getSender() });
        const execution = await authorizer.getScheduledExecution(id);

        expect(execution.protected).to.be.true;
        await Promise.all(
          executors.map(async (executor) => expect(await authorizer.isExecutor(id, executor)).to.be.true)
        );
      });

      it('granter can cancel the execution', async () => {
        const id = await authorizer.scheduleGrantPermission(ACTION_1, user, WHERE_1, [], { from: getSender() });
        expect(await authorizer.isCanceler(id, getSender())).to.be.true;

        const receipt = await authorizer.cancel(id, { from: getSender() });
        expectEvent.inReceipt(await receipt.wait(), 'ExecutionCanceled', { scheduledExecutionId: id });
      });

      it('can be executed after the expected delay', async () => {
        const id = await authorizer.scheduleGrantPermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        await advanceTime(delay);
        const receipt = await authorizer.execute(id);
        expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', { scheduledExecutionId: id });
      });

      it('grants the permission when executed', async () => {
        const id = await authorizer.scheduleGrantPermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        await advanceTime(delay);
        await authorizer.execute(id);

        expect(await authorizer.hasPermission(ACTION_1, user, WHERE_1)).to.be.equal(true);
      });

      it('does not grant any other permissions when executed', async () => {
        const id = await authorizer.scheduleGrantPermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        await advanceTime(delay);
        const receipt = await authorizer.execute(id);

        expectEvent.inReceipt(await receipt.wait(), 'PermissionGranted', {
          actionId: ACTION_1,
          account: user.address,
          where: WHERE_1,
        });

        expect(await authorizer.hasPermission(ACTION_3, user, WHERE_1)).to.be.equal(false);
        expect(await authorizer.hasPermission(ACTION_2, user, WHERE_2)).to.be.equal(false);
      });

      it('emits an event', async () => {
        const receipt = await authorizer.instance
          .connect(getSender())
          .scheduleGrantPermission(ACTION_1, user.address, WHERE_1, []);

        expectEvent.inReceipt(await receipt.wait(), 'GrantPermissionScheduled', {
          actionId: ACTION_1,
          account: user.address,
          where: WHERE_1,
        });
      });
    }

    context('when the sender is root', () => {
      itScheduleGrantPermissionCorrectly(() => root);
    });

    context('when the sender is granter everywhere', () => {
      sharedBeforeEach('makes a granter', async () => {
        await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root });
      });

      it('cannot grant the permission for other actions', async () => {
        await expect(
          authorizer.scheduleGrantPermission(ACTION_3, user, WHERE_1, [], { from: granter })
        ).to.be.revertedWith('SENDER_IS_NOT_GRANTER');
      });

      itScheduleGrantPermissionCorrectly(() => granter);
    });

    context('when the sender is granter for a specific contract', () => {
      sharedBeforeEach('makes a granter', async () => {
        await authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root });
      });

      it('cannot grant the permission in other contracts', async () => {
        await expect(
          authorizer.scheduleGrantPermission(ACTION_1, user, WHERE_3, [], { from: granter })
        ).to.be.revertedWith('SENDER_IS_NOT_GRANTER');
      });

      it('cannot grant the permission for other actions', async () => {
        await expect(
          authorizer.scheduleGrantPermission(ACTION_3, user, WHERE_1, [], { from: granter })
        ).to.be.revertedWith('SENDER_IS_NOT_GRANTER');
      });

      itScheduleGrantPermissionCorrectly(() => granter);
    });
  });

  describe('revokePermission', () => {
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
    });

    context('when there is a no delay set to revoke permissions', () => {
      it('reverts if the sender is not the revoker', async () => {
        await expect(authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: revoker })).to.be.revertedWith(
          'SENDER_IS_NOT_REVOKER'
        );
      });

      function itRevokesPermissionCorrectly(getSender: () => SignerWithAddress) {
        context('when the user does not have the permission', () => {
          it('cannot revoke the permission', async () => {
            await expect(
              authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: getSender() })
            ).to.be.revertedWith('PERMISSION_NOT_GRANTED');
          });

          it('cannot perform the requested action everywhere', async () => {
            expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, user, EVERYWHERE)).to.be.false;
          });

          it('cannot perform the requested action in any specific contract', async () => {
            expect(await authorizer.canPerform(ACTION_1, user, NOT_WHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
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
            it('cannot revoke the permission', async () => {
              await expect(
                authorizer.revokePermissionGlobally(ACTION_1, user, { from: getSender() })
              ).to.be.revertedWith('PERMISSION_NOT_GRANTED');
            });
          });
        });

        context('when the user has the permission everywhere', () => {
          sharedBeforeEach('grants the permissions', async () => {
            await authorizer.grantPermissionGlobally(ACTION_1, user, { from: root });
          });

          context('when revoking the permission for a contract', () => {
            it('cannot revoke the permission', async () => {
              await expect(
                authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: getSender() })
              ).to.be.revertedWith('ACCOUNT_HAS_GLOBAL_PERMISSION');
            });

            it('can perform the requested action for the requested contract', async () => {
              expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
              expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.true;
            });

            it('can perform the requested action everywhere', async () => {
              expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.true;
            });
          });

          context('when revoking the permission for a everywhere', () => {
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
        });

        context('when the user has the permission in a specific contract and everywhere', () => {
          sharedBeforeEach('grants the permissions', async () => {
            await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: root });
            await authorizer.grantPermissionGlobally(ACTION_1, user, { from: root });
          });

          context('when revoking the permission for a contract', () => {
            it('cannot revoke the permission', async () => {
              await expect(
                authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: getSender() })
              ).to.be.revertedWith('ACCOUNT_HAS_GLOBAL_PERMISSION');
            });
          });

          context('when revoking the permission for a everywhere', () => {
            it('revokes the requested global permission', async () => {
              await authorizer.revokePermissionGlobally(ACTION_1, user, { from: getSender() });

              expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
              expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
            });

            it('can still perform the requested action in the specific contract', async () => {
              await authorizer.revokePermissionGlobally(ACTION_1, user, { from: getSender() });

              expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
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
        });
      }

      context('when the sender is root', () => {
        itRevokesPermissionCorrectly(() => root);
      });

      context('when the sender is revoker everywhere', () => {
        sharedBeforeEach('makes a revoker', async () => {
          await authorizer.addRevoker(revoker, EVERYWHERE, { from: root });
        });
        itRevokesPermissionCorrectly(() => revoker);
      });

      context('when the sender is revoker for a specific contract', () => {
        sharedBeforeEach('makes a revoker', async () => {
          await authorizer.addRevoker(revoker, WHERE_1, { from: root });
        });

        it('cannot revoke the permission in other contracts', async () => {
          await expect(authorizer.revokePermission(ACTION_1, user, WHERE_3, { from: revoker })).to.be.revertedWith(
            'SENDER_IS_NOT_REVOKER'
          );
        });

        it('cannot revoke the permission if it was not granted', async () => {
          await expect(authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: root })).to.be.revertedWith(
            'PERMISSION_NOT_GRANTED'
          );
        });

        context('when the user has the permission for a contract', () => {
          sharedBeforeEach('grants the permission', async () => {
            await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: root });
          });

          context('when revoking the permission for a contract', () => {
            it('revokes the requested permission for the requested contract', async () => {
              await authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: revoker });

              expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, user, WHERE_1)).to.be.false;
              expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, user, WHERE_2)).to.be.false;
            });

            it('still cannot perform the requested action everywhere', async () => {
              await authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: revoker });

              expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, user, EVERYWHERE)).to.be.false;
            });

            it('emits an event', async () => {
              const receipt = await (
                await authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: revoker })
              ).wait();

              expectEvent.inReceipt(receipt, 'PermissionRevoked', {
                actionId: ACTION_1,
                account: user.address,
                where: WHERE_1,
              });
            });
          });
        });

        context('when the user has the permission everywhere', () => {
          sharedBeforeEach('grants the permissions', async () => {
            await authorizer.grantPermissionGlobally(ACTION_1, user, { from: root });
          });

          context('when revoking the permission for a contract', () => {
            it('cannot revoke the permission', async () => {
              await expect(authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: revoker })).to.be.revertedWith(
                'ACCOUNT_HAS_GLOBAL_PERMISSION'
              );
            });
          });
        });
      });
    });
  });

  describe('scheduleRevokePermission', () => {
    const delay = DAY;

    sharedBeforeEach('set delay', async () => {
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, delay * 2, { from: root });
      await authorizer.scheduleAndExecuteRevokeDelayChange(ACTION_1, delay, { from: root });
    });

    it('reverts if action has no revoke delay', async () => {
      await expect(authorizer.scheduleRevokePermission(ACTION_2, user, WHERE_1, [], { from: root })).to.be.revertedWith(
        'ACTION_HAS_NO_REVOKE_DELAY'
      );
    });

    it('reverts if sender is not revoker', async () => {
      await expect(
        authorizer.scheduleRevokePermission(ACTION_1, user, WHERE_1, [], { from: other })
      ).to.be.revertedWith('SENDER_IS_NOT_REVOKER');
    });

    function itScheduleRevokePermissionCorrectly(getSender: () => SignerWithAddress) {
      it('schedules a revoke permission', async () => {
        const id = await authorizer.scheduleRevokePermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        const { executed, data, where, executableAt } = await authorizer.getScheduledExecution(id);
        expect(executed).to.be.false;
        expect(data).to.be.equal(
          authorizer.instance.interface.encodeFunctionData('revokePermission', [ACTION_1, user.address, WHERE_1])
        );
        expect(where).to.be.equal(authorizer.address);
        expect(executableAt).to.equal((await currentTimestamp()).add(delay));
      });

      it('increases the scheduled execution count', async () => {
        const countBefore = await authorizer.instance.getScheduledExecutionsCount();
        await authorizer.scheduleRevokePermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        const countAfter = await authorizer.instance.getScheduledExecutionsCount();

        expect(countAfter).to.equal(countBefore.add(1));
      });

      it('stores scheduler information', async () => {
        const id = await authorizer.scheduleRevokePermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        const scheduledExecution = await authorizer.getScheduledExecution(id);
        expect(scheduledExecution.scheduledBy).to.equal(getSender().address);
        expect(scheduledExecution.scheduledAt).to.equal(await currentTimestamp());
      });

      it('stores empty executor and canceler information', async () => {
        const id = await authorizer.scheduleRevokePermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        const scheduledExecution = await authorizer.getScheduledExecution(id);
        expect(scheduledExecution.executedBy).to.equal(ZERO_ADDRESS);
        expect(scheduledExecution.executedAt).to.equal(0);
        expect(scheduledExecution.canceledBy).to.equal(ZERO_ADDRESS);
        expect(scheduledExecution.canceledAt).to.equal(0);
      });

      it('execution can be unprotected', async () => {
        const id = await authorizer.scheduleRevokePermission(ACTION_1, user, WHERE_1, [], { from: getSender() });
        const execution = await authorizer.getScheduledExecution(id);

        expect(execution.protected).to.be.false;
      });

      it('execution can be protected', async () => {
        const executors = range(4).map(randomAddress);
        const id = await authorizer.scheduleRevokePermission(ACTION_1, user, WHERE_1, executors, { from: getSender() });
        const execution = await authorizer.getScheduledExecution(id);

        expect(execution.protected).to.be.true;
        await Promise.all(
          executors.map(async (executor) => expect(await authorizer.isExecutor(id, executor)).to.be.true)
        );
      });

      it('revoker can cancel the execution', async () => {
        const id = await authorizer.scheduleRevokePermission(ACTION_1, user, WHERE_1, [], { from: getSender() });
        expect(await authorizer.isCanceler(id, getSender())).to.be.true;

        const receipt = await authorizer.cancel(id, { from: getSender() });
        expectEvent.inReceipt(await receipt.wait(), 'ExecutionCanceled', { scheduledExecutionId: id });
      });

      it('can be executed after the expected delay', async () => {
        // Grant the permission so we can later revoke it
        await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: root });
        const id = await authorizer.scheduleRevokePermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        await advanceTime(delay);
        const receipt = await authorizer.execute(id);
        expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', { scheduledExecutionId: id });
      });

      it('revokes the permission when executed', async () => {
        // grant the premission first
        await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: root });

        expect(await authorizer.hasPermission(ACTION_1, user, WHERE_1)).to.be.equal(true);

        const id = await authorizer.scheduleRevokePermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        await advanceTime(delay);
        await authorizer.execute(id);

        expect(await authorizer.hasPermission(ACTION_1, user, WHERE_1)).to.be.equal(false);
      });

      it('does not revoke any other permissions when executed', async () => {
        // Grant the permission so we can later revoke it
        await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: root });
        const id = await authorizer.scheduleRevokePermission(ACTION_1, user, WHERE_1, [], { from: getSender() });

        await advanceTime(delay);
        await authorizer.execute(id);

        expect(await authorizer.hasPermission(ACTION_3, user, WHERE_1)).to.be.equal(false);
        expect(await authorizer.hasPermission(ACTION_2, user, WHERE_2)).to.be.equal(false);
      });

      it('emits an event', async () => {
        const receipt = await authorizer.instance
          .connect(getSender())
          .scheduleRevokePermission(ACTION_1, user.address, WHERE_1, []);

        expectEvent.inReceipt(await receipt.wait(), 'RevokePermissionScheduled', {
          actionId: ACTION_1,
          account: user.address,
          where: WHERE_1,
        });
      });
    }

    context('when the sender is root', () => {
      itScheduleRevokePermissionCorrectly(() => root);
    });

    context('when the sender is revoker everywhere', () => {
      sharedBeforeEach('makes a revoker', async () => {
        await authorizer.addRevoker(revoker, EVERYWHERE, { from: root });
      });
      itScheduleRevokePermissionCorrectly(() => revoker);
    });

    context('when the sender is revoker for a specific contract', () => {
      sharedBeforeEach('makes a revoker', async () => {
        await authorizer.addRevoker(revoker, WHERE_1, { from: root });
      });
      itScheduleRevokePermissionCorrectly(() => revoker);

      it('cannot schedule revoke the permission in other contracts', async () => {
        await expect(
          authorizer.scheduleRevokePermission(ACTION_1, user, WHERE_3, [], { from: revoker })
        ).to.be.revertedWith('SENDER_IS_NOT_REVOKER');
      });
    });
  });

  describe('renouncePermission', () => {
    const delay = DAY;
    context('when the sender does not have the permission', () => {
      context('when renouncing the permission for a specific contract', () => {
        it('cannot renounce the permission if it was not granted', async () => {
          await expect(authorizer.renouncePermission(ACTION_1, WHERE_1, { from: user })).to.be.revertedWith(
            'PERMISSION_NOT_GRANTED'
          );
        });

        it('cannot perform the requested action everywhere', async () => {
          expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
        });

        it('cannot perform the requested action in any specific contract', async () => {
          expect(await authorizer.canPerform(ACTION_1, user, NOT_WHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
        });
      });

      context('when renouncing the permission for everywhere', () => {
        it('cannot renounce the permission if it was not granted', async () => {
          await expect(authorizer.renouncePermissionGlobally(ACTION_1, { from: user })).to.be.revertedWith(
            'PERMISSION_NOT_GRANTED'
          );
        });

        it('cannot perform the requested action everywhere', async () => {
          expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
        });

        it('cannot perform the requested action in any specific contract', async () => {
          expect(await authorizer.canPerform(ACTION_1, user, NOT_WHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
        });
      });
    });

    context('when the user has the permission for a specific contract', () => {
      sharedBeforeEach('grants the permission', async () => {
        await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: root });
      });

      context('when renouncing the permission for a specific contract', () => {
        it('revokes the requested permission for the requested contract', async () => {
          await authorizer.renouncePermission(ACTION_1, WHERE_1, { from: user });

          expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, user, WHERE_1)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, user, WHERE_2)).to.be.false;
        });

        it('cannot perform the requested action everywhere', async () => {
          await authorizer.renouncePermission(ACTION_1, WHERE_1, { from: user });

          expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
        });

        it('can revoke even if the permission has a delay', async () => {
          await authorizer.scheduleAndExecuteDelayChange(await actionId(vault, 'setAuthorizer'), delay, { from: root });
          const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, delay, [], { from: root });
          await advanceTime(MINIMUM_EXECUTION_DELAY);
          await authorizer.execute(id);
          expect(authorizer.revokePermission(ACTION_1, user, WHERE_1, { from: user })).to.be.revertedWith(
            'REVOKE_MUST_BE_SCHEDULED'
          );
          await authorizer.renouncePermission(ACTION_1, WHERE_1, { from: user });

          expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, user, WHERE_1)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, user, WHERE_2)).to.be.false;
        });
      });

      context('when renouncing the permission for everywhere', () => {
        it('cannot renounce the permission if it was not granted', async () => {
          await expect(authorizer.renouncePermissionGlobally(ACTION_1, { from: user })).to.be.revertedWith(
            'PERMISSION_NOT_GRANTED'
          );
        });

        it('can perform the requested action for the requested contract', async () => {
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
        });

        it('cannot perform the requested action everywhere', async () => {
          expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, user, EVERYWHERE)).to.be.false;
        });
      });
    });

    context('when the user has the permission for everywhere', () => {
      sharedBeforeEach('grants the permission', async () => {
        await authorizer.grantPermissionGlobally(ACTION_1, user, { from: root });
      });

      context('when renouncing the permission for a specific contract', () => {
        it('cannot renounce the permission if it was not granted', async () => {
          await expect(authorizer.renouncePermission(ACTION_1, WHERE_1, { from: user })).to.be.revertedWith(
            'ACCOUNT_HAS_GLOBAL_PERMISSION'
          );
        });

        it('can perform the requested actions for the requested contract', async () => {
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.true;
        });

        it('can perform the requested action everywhere', async () => {
          expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.true;
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.true;
        });
      });

      context('when renouncing the permission for everywhere', () => {
        it('revokes the requested permissions everywhere', async () => {
          await authorizer.renouncePermissionGlobally(ACTION_1, { from: user });

          expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
        });

        it('can revoke even if the permission has a delay', async () => {
          await authorizer.scheduleAndExecuteDelayChange(await actionId(vault, 'setAuthorizer'), delay, { from: root });
          const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, delay, [], { from: root });
          await advanceTime(MINIMUM_EXECUTION_DELAY);
          await authorizer.execute(id);
          expect(authorizer.revokePermissionGlobally(ACTION_1, user, { from: user })).to.be.revertedWith(
            'REVOKE_MUST_BE_SCHEDULED'
          );
          await authorizer.renouncePermissionGlobally(ACTION_1, { from: user });

          expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
        });

        it('still cannot perform the requested action in any specific contract', async () => {
          await authorizer.renouncePermissionGlobally(ACTION_1, { from: user });

          expect(await authorizer.canPerform(ACTION_1, user, NOT_WHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
        });
      });
    });

    context('when the user has the permission for a specific contract and everywhere', () => {
      sharedBeforeEach('grants the permission', async () => {
        await authorizer.grantPermission(ACTION_1, user, WHERE_1, { from: root });
        await authorizer.grantPermissionGlobally(ACTION_1, user, { from: root });
      });

      context('when renouncing the permission for a specific contract', () => {
        it('cannot renounce the permission', async () => {
          await expect(authorizer.renouncePermission(ACTION_1, WHERE_1, { from: user })).to.be.revertedWith(
            'ACCOUNT_HAS_GLOBAL_PERMISSION'
          );
        });

        it('can perform the requested actions for the requested contract', async () => {
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.true;
        });

        it('can perform the requested action everywhere', async () => {
          expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.true;
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.true;
        });
      });

      context('when renouncing the permission for everywhere', () => {
        it('revokes the requested permissions everywhere', async () => {
          await authorizer.renouncePermissionGlobally(ACTION_1, { from: user });

          expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
        });

        it('can still perform the requested action in the specific contract', async () => {
          await authorizer.renouncePermissionGlobally(ACTION_1, { from: user });

          expect(await authorizer.canPerform(ACTION_1, user, WHERE_1)).to.be.true;
        });

        it('can revoke even if the permission has a delay', async () => {
          await authorizer.scheduleAndExecuteDelayChange(await actionId(vault, 'setAuthorizer'), delay, { from: root });
          const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, delay, [], { from: root });
          await advanceTime(MINIMUM_EXECUTION_DELAY);
          await authorizer.execute(id);
          expect(authorizer.revokePermissionGlobally(ACTION_1, user, { from: user })).to.be.revertedWith(
            'REVOKE_MUST_BE_SCHEDULED'
          );
          await authorizer.renouncePermissionGlobally(ACTION_1, { from: user });

          expect(await authorizer.canPerform(ACTION_1, user, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, user, WHERE_2)).to.be.false;
        });
      });
    });
  });
});
