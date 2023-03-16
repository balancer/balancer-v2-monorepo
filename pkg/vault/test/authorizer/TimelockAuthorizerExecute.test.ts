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
    executor: SignerWithAddress,
    canceler: SignerWithAddress,
    revoker: SignerWithAddress,
    other: SignerWithAddress,
    from: SignerWithAddress;

  before('setup signers', async () => {
    [, root, nextRoot, granter, executor, canceler, revoker, other] = await ethers.getSigners();
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
    let executors: SignerWithAddress[];

    sharedBeforeEach('grant protected function permission with delay', async () => {
      // We must set a delay for the `setAuthorizer` function as well to be able to give one to `protectedFunction`
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, delay, { from: root });

      const protectedFunctionAction = await actionId(authenticatedContract, 'protectedFunction');
      await authorizer.scheduleAndExecuteDelayChange(protectedFunctionAction, delay, { from: root });
      await authorizer.grantPermission(protectedFunctionAction, granter, authenticatedContract, { from: root });
    });

    const schedule = async (): Promise<number> => {
      const data = authenticatedContract.interface.encodeFunctionData('protectedFunction', [functionData]);
      return authorizer.schedule(authenticatedContract, data, executors || [], { from: granter });
    };

    context('when the given id is valid', () => {
      let id: BigNumberish;

      context('when the action is protected', () => {
        sharedBeforeEach('set executors', async () => {
          executors = [root, other];
        });

        context('when the sender is an allowed executor', () => {
          itLetsExecutorExecute(0);
          itLetsExecutorExecute(1);

          function itLetsExecutorExecute(index: number) {
            context(`with executor #${index}`, () => {
              sharedBeforeEach('set sender', async () => {
                if (index >= executors.length) throw new Error('Invalid executor index');
                from = executors[index];
              });

              context('when the action was not cancelled', () => {
                sharedBeforeEach('schedule execution', async () => {
                  id = await schedule();
                });

                it('sender is marked as an executor', async () => {
                  expect(await authorizer.instance.isExecutor(id, from.address)).to.be.true;
                });

                context('when the delay has passed', () => {
                  sharedBeforeEach('advance time', async () => {
                    await advanceTime(delay);
                  });

                  it('executes the action', async () => {
                    const receipt = await authorizer.execute(id, { from });

                    const scheduledExecution = await authorizer.getScheduledExecution(id);
                    expect(scheduledExecution.executed).to.be.true;

                    expectEvent.inIndirectReceipt(
                      await receipt.wait(),
                      authenticatedContract.interface,
                      'ProtectedFunctionCalled',
                      { data: functionData }
                    );
                  });

                  it('emits an event', async () => {
                    const receipt = await authorizer.execute(id, { from });

                    expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', {
                      scheduledExecutionId: id,
                    });
                  });

                  it('cannot be executed twice', async () => {
                    await authorizer.execute(id, { from });

                    await expect(authorizer.execute(id, { from })).to.be.revertedWith('ACTION_ALREADY_EXECUTED');
                  });
                });

                context('when the delay has not passed', () => {
                  it('reverts', async () => {
                    await expect(authorizer.execute(id, { from })).to.be.revertedWith('ACTION_NOT_YET_EXECUTABLE');
                  });
                });
              });

              context('when the action was cancelled', () => {
                sharedBeforeEach('schedule and cancel action', async () => {
                  id = await schedule();
                  await authorizer.cancel(id, { from: granter });
                });

                it('reverts', async () => {
                  await expect(authorizer.execute(id, { from })).to.be.revertedWith('ACTION_ALREADY_CANCELLED');
                });
              });
            });
          }
        });

        context('when the sender is not an allowed executor', () => {
          it('reverts', async () => {
            id = await schedule();
            await advanceTime(delay);

            await expect(authorizer.execute(id, { from: granter })).to.be.revertedWith('SENDER_IS_NOT_EXECUTOR');
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

          const receipt = await authorizer.execute(id);

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
      });
    });

    context('when the given id is not valid', () => {
      it('reverts', async () => {
        await expect(authorizer.execute(100)).to.be.revertedWith('ACTION_DOES_NOT_EXIST');
      });
    });
  });

  describe('execute', () => {
    it('can execute an action', async () => {});

    it('action is marked as executed', async () => {});

    context('when the action is protected', () => {
      it('all executors can execute', async () => {});

      it('other cannot execute', async () => {});
    });

    it('can be executed by anyone if not protected', async () => {});

    it('emits an event', async () => {});

    it('cannot be executed twice', async () => {});

    it('reverts if action was cancelled', async () => {});

    it('reverts if the delay has not passed', async () => {});

    it('reverts if the scheduled id is invalid', async () => {});
  });

  describe('cancel', () => {
    const delay = DAY;
    let executors: SignerWithAddress[];

    sharedBeforeEach('grant protected function permission with delay', async () => {
      // We must set a delay for the `setAuthorizer` function as well to be able to give one to `protectedFunction`
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, delay, { from: root });

      const protectedFunctionAction = await actionId(authenticatedContract, 'protectedFunction');
      await authorizer.scheduleAndExecuteDelayChange(protectedFunctionAction, delay, { from: root });
      await authorizer.grantPermission(protectedFunctionAction, executor, authenticatedContract, { from: root });
    });

    const schedule = async (): Promise<number> => {
      const data = authenticatedContract.interface.encodeFunctionData('protectedFunction', ['0x']);
      const id = await authorizer.schedule(authenticatedContract, data, executors || [], { from: executor });
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
