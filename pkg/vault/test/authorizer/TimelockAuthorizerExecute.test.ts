import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TimelockAuthorizer from '@balancer-labs/v2-helpers/src/models/authorizer/TimelockAuthorizer';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime, currentTimestamp, DAY } from '@balancer-labs/v2-helpers/src/time';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('TimelockAuthorizer execute', () => {
  let authorizer: TimelockAuthorizer, vault: Contract, authenticatedContract: Contract;
  let root: SignerWithAddress,
    nextRoot: SignerWithAddress,
    granter: SignerWithAddress,
    user: SignerWithAddress,
    executor: SignerWithAddress,
    canceler: SignerWithAddress,
    revoker: SignerWithAddress,
    other: SignerWithAddress,
    account: SignerWithAddress,
    from: SignerWithAddress;

  before('setup signers', async () => {
    [, root, nextRoot, granter, executor, canceler, revoker, account, user, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    let authorizerContract: Contract;

    ({ instance: vault, authorizer: authorizerContract } = await Vault.create({
      admin: root,
      nextAdmin: nextRoot.address,
    }));

    authorizer = new TimelockAuthorizer(authorizerContract, root);
    authenticatedContract = await deploy('MockAuthenticatedContract', { args: [vault.address] });
  });

  describe('schedule', () => {
    const delay = DAY * 5;
    const functionData = '0x0123456789abcdef';

    let where: Contract, action: string, data: string, executors: SignerWithAddress[];
    let anotherAuthenticatedContract: Contract;

    sharedBeforeEach('deploy sample instances', async () => {
      anotherAuthenticatedContract = await deploy('MockAuthenticatedContract', { args: [vault.address] });
    });

    sharedBeforeEach('set authorizer permission delay', async () => {
      // We must set a delay for the `setAuthorizer` function as well to be able to give one to `protectedFunction`
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, 2 * delay, { from: root });
    });

    const schedule = async (): Promise<number> => {
      data = authenticatedContract.interface.encodeFunctionData('protectedFunction', [functionData]);
      return authorizer.schedule(where, data, executors || [], { from: granter });
    };

    context('when the target is not the authorizer', () => {
      sharedBeforeEach('set where', async () => {
        where = authenticatedContract;
      });

      context('when the sender has permission', () => {
        context('when the sender has permission for the requested action', () => {
          sharedBeforeEach('set action', async () => {
            action = await actionId(authenticatedContract, 'protectedFunction');
          });

          context('when the sender has permission for the requested contract', () => {
            sharedBeforeEach('grant permission', async () => {
              await authorizer.grantPermission(action, granter, authenticatedContract, { from: root });
            });

            context('when there is a delay set', () => {
              const delay = DAY * 5;

              sharedBeforeEach('set delay', async () => {
                await authorizer.scheduleAndExecuteDelayChange(action, delay, { from: root });
              });

              context('when no executors are specified', () => {
                sharedBeforeEach('set executors', async () => {
                  executors = [];
                });

                it('schedules a non-protected execution', async () => {
                  const id = await schedule();

                  const scheduledExecution = await authorizer.getScheduledExecution(id);
                  expect(scheduledExecution.executed).to.be.false;
                  expect(scheduledExecution.data).to.be.equal(data);
                  expect(scheduledExecution.where).to.be.equal(where.address);
                  expect(scheduledExecution.protected).to.be.false;
                  expect(scheduledExecution.executableAt).to.be.at.almostEqual((await currentTimestamp()).add(delay));
                });

                it('cannot execute the action immediately', async () => {
                  const id = await schedule();
                  await expect(authorizer.execute(id)).to.be.revertedWith('ACTION_NOT_YET_EXECUTABLE');
                });

                it('can be executed by anyone', async () => {
                  const id = await schedule();
                  await advanceTime(delay);

                  const receipt = await authorizer.execute(id);
                  expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', { scheduledExecutionId: id });

                  const scheduledExecution = await authorizer.getScheduledExecution(id);
                  expect(scheduledExecution.executed).to.be.true;

                  expectEvent.inIndirectReceipt(
                    await receipt.wait(),
                    authenticatedContract.interface,
                    'ProtectedFunctionCalled',
                    {
                      data: functionData,
                    }
                  );
                });

                it('cannot be executed twice', async () => {
                  const id = await schedule();
                  await advanceTime(delay);

                  await authorizer.execute(id);
                  await expect(authorizer.execute(id)).to.be.revertedWith('ACTION_ALREADY_EXECUTED');
                });

                it('receives canceler status', async () => {
                  const id = await schedule();

                  expect(await authorizer.isCanceler(id, granter)).to.be.true;
                });

                it('can cancel the action immediately', async () => {
                  const id = await schedule();
                  // should not revert
                  const receipt = await authorizer.cancel(id, { from: granter });
                  expectEvent.inReceipt(await receipt.wait(), 'ExecutionCancelled', { scheduledExecutionId: id });
                });
              });

              context('when an executor is specified', () => {
                sharedBeforeEach('set executors', async () => {
                  executors = [other];
                });

                it('schedules the requested execution', async () => {
                  const id = await schedule();

                  const scheduledExecution = await authorizer.getScheduledExecution(id);
                  expect(scheduledExecution.executed).to.be.false;
                  expect(scheduledExecution.data).to.be.equal(data);
                  expect(scheduledExecution.where).to.be.equal(where.address);
                  expect(scheduledExecution.protected).to.be.true;
                  expect(scheduledExecution.executableAt).to.be.at.almostEqual((await currentTimestamp()).add(delay));
                });

                it('emits ExecutorAdded events', async () => {
                  const receipt = await authorizer.instance.connect(granter).schedule(
                    where.address,
                    data,
                    executors.map((e) => e.address)
                  );

                  for (const executor of executors) {
                    expectEvent.inReceipt(await receipt.wait(), 'ExecutorAdded', { executor: executor.address });
                  }
                });

                it('cannot execute the action immediately', async () => {
                  const id = await schedule();
                  await expect(authorizer.execute(id, { from: executors[0] })).to.be.revertedWith(
                    'ACTION_NOT_YET_EXECUTABLE'
                  );
                });

                it('can be executed by the executor only', async () => {
                  const id = await schedule();
                  await advanceTime(delay);

                  await expect(authorizer.execute(id, { from: granter })).to.be.revertedWith('SENDER_IS_NOT_EXECUTOR');

                  const receipt = await authorizer.execute(id, { from: executors[0] });
                  expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', { scheduledExecutionId: id });

                  const scheduledExecution = await authorizer.getScheduledExecution(id);
                  expect(scheduledExecution.executed).to.be.true;

                  expectEvent.inIndirectReceipt(
                    await receipt.wait(),
                    authenticatedContract.interface,
                    'ProtectedFunctionCalled',
                    {
                      data: functionData,
                    }
                  );
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

              context('when an executor is specified twice', () => {
                sharedBeforeEach('set executors', async () => {
                  executors = [other, other];
                });

                it('reverts', async () => {
                  await expect(schedule()).to.be.revertedWith('DUPLICATE_EXECUTORS');
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
              await authorizer.grantPermission(action, granter, anotherAuthenticatedContract, { from: root });
            });

            it('reverts', async () => {
              await expect(schedule()).to.be.revertedWith('SENDER_DOES_NOT_HAVE_PERMISSION');
            });
          });
        });

        context('when the sender has permissions for another action', () => {
          sharedBeforeEach('grant permission', async () => {
            action = await actionId(authenticatedContract, 'secondProtectedFunction');
            await authorizer.grantPermission(action, granter, authenticatedContract, { from: root });
          });

          it('reverts', async () => {
            await expect(schedule()).to.be.revertedWith('SENDER_DOES_NOT_HAVE_PERMISSION');
          });
        });
      });

      context('when the sender does not have permission', () => {
        it('reverts', async () => {
          await expect(schedule()).to.be.revertedWith('SENDER_DOES_NOT_HAVE_PERMISSION');
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

    context('when the target is the execution helper', () => {
      sharedBeforeEach('set where', async () => {
        where = await authorizer.instance.getTimelockExecutionHelper();
      });

      it('reverts', async () => {
        await expect(schedule()).to.be.revertedWith('ATTEMPTING_EXECUTION_HELPER_REENTRANCY');
      });
    });
  });

  describe('execute', () => {
    const delay = DAY;
    const functionData = '0x0123456789abcdef';

    sharedBeforeEach('grant protected function permission with delay', async () => {
      // We must set a delay for the `setAuthorizer` function as well to be able to give one to `protectedFunction`
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, delay, { from: root });

      const protectedFunctionAction = await actionId(authenticatedContract, 'protectedFunction');
      await authorizer.scheduleAndExecuteDelayChange(protectedFunctionAction, delay, { from: root });
      await authorizer.grantPermission(protectedFunctionAction, user, authenticatedContract, { from: root });
    });

    const schedule = async (executors: SignerWithAddress[] | undefined = undefined): Promise<number> => {
      const data = authenticatedContract.interface.encodeFunctionData('protectedFunction', [functionData]);
      return authorizer.schedule(authenticatedContract, data, executors || [], { from: user });
    };

    it('can execute an action', async () => {
      const id = await schedule();
      await advanceTime(delay);
      const receipt = await authorizer.execute(id, { from: executor });

      expectEvent.inIndirectReceipt(await receipt.wait(), authenticatedContract.interface, 'ProtectedFunctionCalled', {
        data: functionData,
      });
    });

    it('action is marked as executed', async () => {
      const id = await schedule();
      await advanceTime(delay);
      await authorizer.execute(id, { from: executor });

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.executed).to.be.true;
    });

    context('when the action is protected', () => {
      sharedBeforeEach('set executors', async () => {});
      it('all executors can execute', async () => {
        const id = await schedule([executor, account]);
        await advanceTime(delay);

        expect(await authorizer.isExecutor(id, executor)).to.be.true;
        expect(await authorizer.isExecutor(id, account)).to.be.true;

        const receipt = await authorizer.execute(id, { from: account });
        expectEvent.inIndirectReceipt(
          await receipt.wait(),
          authenticatedContract.interface,
          'ProtectedFunctionCalled',
          {
            data: functionData,
          }
        );
      });

      it('other cannot execute', async () => {
        const id = await schedule([executor]);
        await advanceTime(delay);

        await expect(authorizer.execute(id, { from: other })).to.be.revertedWith('SENDER_IS_NOT_EXECUTOR');
      });
    });

    it('can be executed by anyone if not protected', async () => {
      const id = await schedule();
      await advanceTime(delay);

      const receipt = await authorizer.execute(id);

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.executed).to.be.true;

      expectEvent.inIndirectReceipt(await receipt.wait(), authenticatedContract.interface, 'ProtectedFunctionCalled', {
        data: functionData,
      });
    });

    it('emits an event', async () => {
      const id = await schedule();
      await advanceTime(delay);
      const receipt = await authorizer.execute(id, { from: executor });

      expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', {
        scheduledExecutionId: id,
      });
    });

    it('cannot be executed twice', async () => {
      const id = await schedule();
      await advanceTime(delay);
      await authorizer.execute(id, { from: executor });
      await expect(authorizer.execute(id, { from: executor })).to.be.revertedWith('ACTION_ALREADY_EXECUTED');
    });

    it('reverts if action was cancelled', async () => {
      const id = await schedule();
      await advanceTime(delay);
      await authorizer.cancel(id, { from: user });
      await expect(authorizer.execute(id, { from: executor })).to.be.revertedWith('ACTION_ALREADY_CANCELLED');
    });

    it('reverts if the delay has not passed', async () => {
      const id = await schedule();
      await expect(authorizer.execute(id, { from: executor })).to.be.revertedWith('ACTION_NOT_YET_EXECUTABLE');
    });

    it('reverts if the scheduled id is invalid', async () => {
      await expect(authorizer.execute(100)).to.be.revertedWith('ACTION_DOES_NOT_EXIST');
    });
  });

  describe('cancel', () => {
    const delay = DAY;

    sharedBeforeEach('grant protected function permission with delay', async () => {
      // We must set a delay for the `setAuthorizer` function as well to be able to give one to `protectedFunction`
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, delay, { from: root });

      const protectedFunctionAction = await actionId(authenticatedContract, 'protectedFunction');
      await authorizer.scheduleAndExecuteDelayChange(protectedFunctionAction, delay, { from: root });
      await authorizer.grantPermission(protectedFunctionAction, user, authenticatedContract, { from: root });
    });

    const schedule = async (): Promise<number> => {
      const data = authenticatedContract.interface.encodeFunctionData('protectedFunction', ['0x']);
      const id = await authorizer.schedule(authenticatedContract, data, [], { from: user });
      await authorizer.addCanceler(id, canceler, { from: root });
      return id;
    };

    it('cancel the action', async () => {
      const id = await schedule();
      await authorizer.cancel(id, { from: canceler });

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.cancelled).to.be.true;
    });

    it('emits an event', async () => {
      const id = await schedule();
      const receipt = await authorizer.cancel(id, { from: canceler });

      expectEvent.inReceipt(await receipt.wait(), 'ExecutionCancelled', { scheduledExecutionId: id });
    });

    it('cannot be cancelled twice', async () => {
      const id = await schedule();
      await authorizer.cancel(id, { from: canceler });

      await expect(authorizer.cancel(id, { from: canceler })).to.be.revertedWith('ACTION_ALREADY_CANCELLED');
    });

    it('reverts if the scheduled id is invalid', async () => {
      await expect(authorizer.cancel(100)).to.be.revertedWith('ACTION_DOES_NOT_EXIST');
    });

    it('reverts if action was executed', async () => {
      const id = await schedule();
      await advanceTime(delay);
      await authorizer.execute(id);

      await expect(authorizer.cancel(id, { from: canceler })).to.be.revertedWith('ACTION_ALREADY_EXECUTED');
    });

    it('reverts if sender is not canceler', async () => {
      const id = await schedule();

      await expect(authorizer.cancel(id, { from: other })).to.be.revertedWith('SENDER_IS_NOT_CANCELER');
    });
  });
});
