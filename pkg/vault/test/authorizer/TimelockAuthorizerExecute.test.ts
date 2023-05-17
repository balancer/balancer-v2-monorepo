import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TimelockAuthorizer from '@balancer-labs/v2-helpers/src/models/authorizer/TimelockAuthorizer';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { advanceTime, currentTimestamp, DAY } from '@balancer-labs/v2-helpers/src/time';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('TimelockAuthorizer execute', () => {
  let authorizer: TimelockAuthorizer, vault: Contract, authenticatedContract: Contract;
  let root: SignerWithAddress,
    nextRoot: SignerWithAddress,
    user: SignerWithAddress,
    executor: SignerWithAddress,
    canceler: SignerWithAddress,
    other: SignerWithAddress,
    account: SignerWithAddress;

  const EVERYWHERE = TimelockAuthorizer.EVERYWHERE;
  const GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID = MAX_UINT256;

  before('setup signers', async () => {
    [, root, nextRoot, executor, canceler, account, user, other] = await ethers.getSigners();
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

    let action: string, data: string;
    let anotherAuthenticatedContract: Contract;

    sharedBeforeEach('deploy sample instances', async () => {
      anotherAuthenticatedContract = await deploy('MockAuthenticatedContract', { args: [vault.address] });
    });

    sharedBeforeEach('set authorizer permission delay', async () => {
      // We must set a delay for the `setAuthorizer` function as well to be able to give one to `protectedFunction`,
      // which it must have in order to be able to schedule calls to it.
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, 2 * delay, { from: root });
    });

    sharedBeforeEach('set action', async () => {
      action = await actionId(authenticatedContract, 'protectedFunction');
    });

    sharedBeforeEach('grant permission', async () => {
      await authorizer.grantPermission(action, user, authenticatedContract, { from: root });
    });

    sharedBeforeEach('set delay for action', async () => {
      await authorizer.scheduleAndExecuteDelayChange(action, delay, { from: root });
    });

    const schedule = async (
      where: Contract,
      executors: SignerWithAddress[] | undefined = undefined
    ): Promise<number> => {
      data = authenticatedContract.interface.encodeFunctionData('protectedFunction', [functionData]);
      return authorizer.schedule(where, data, executors || [], { from: user });
    };

    it('increases the scheduled execution count', async () => {
      const countBefore = await authorizer.instance.getScheduledExecutionsCount();
      await schedule(authenticatedContract);
      const countAfter = await authorizer.instance.getScheduledExecutionsCount();

      expect(countAfter).to.equal(countBefore.add(1));
    });

    it('stores scheduler information', async () => {
      const id = await schedule(authenticatedContract);

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.scheduledBy).to.equal(user.address);
      expect(scheduledExecution.scheduledAt).to.equal(await currentTimestamp());
    });

    it('stores empty executor and canceler information', async () => {
      const id = await schedule(authenticatedContract);

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.executedBy).to.equal(ZERO_ADDRESS);
      expect(scheduledExecution.executedAt).to.equal(0);
      expect(scheduledExecution.canceledBy).to.equal(ZERO_ADDRESS);
      expect(scheduledExecution.canceledAt).to.equal(0);
    });

    it('schedules a non-protected execution', async () => {
      const id = await schedule(authenticatedContract);

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.executed).to.be.false;
      expect(scheduledExecution.data).to.be.equal(data);
      expect(scheduledExecution.where).to.be.equal(authenticatedContract.address);
      expect(scheduledExecution.protected).to.be.false;
      expect(scheduledExecution.executableAt).to.be.at.eq((await currentTimestamp()).add(delay));
    });

    it('can schedule with a global permission', async () => {
      await authorizer.revokePermission(action, user, authenticatedContract, { from: root });
      await authorizer.grantPermission(action, user, EVERYWHERE, { from: root });
      const id = await schedule(authenticatedContract);

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.executed).to.be.false;
      expect(scheduledExecution.data).to.be.equal(data);
      expect(scheduledExecution.where).to.be.equal(authenticatedContract.address);
      expect(scheduledExecution.protected).to.be.false;
      expect(scheduledExecution.executableAt).to.be.at.eq((await currentTimestamp()).add(delay));
    });

    it('receives canceler status', async () => {
      const id = await schedule(authenticatedContract);

      expect(await authorizer.isCanceler(id, user)).to.be.true;
    });

    it('can cancel the action immediately', async () => {
      const id = await schedule(authenticatedContract);
      // should not revert
      const receipt = await authorizer.cancel(id, { from: user });
      expectEvent.inReceipt(await receipt.wait(), 'ExecutionCanceled', { scheduledExecutionId: id });
    });

    it('schedules the protected execution', async () => {
      const id = await schedule(authenticatedContract, [executor]);

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.executed).to.be.false;
      expect(scheduledExecution.data).to.be.equal(data);
      expect(scheduledExecution.where).to.be.equal(authenticatedContract.address);
      expect(scheduledExecution.protected).to.be.true;
      expect(scheduledExecution.executableAt).to.be.at.eq((await currentTimestamp()).add(delay));
    });

    it('emits ExecutorAdded events', async () => {
      const executors = [executor];
      const receipt = await authorizer.instance.connect(user).schedule(
        authenticatedContract.address,
        data,
        executors.map((e) => e.address)
      );

      for (const executor of executors) {
        expectEvent.inReceipt(await receipt.wait(), 'ExecutorAdded', { executor: executor.address });
      }
    });

    it('emits ExecutionScheduled event', async () => {
      const receipt = await authorizer.instance.connect(user).schedule(authenticatedContract.address, data, []);

      // There is no getter to fetch _scheduledExecutions.length so we don't know what the next scheduledExecutionId is
      // that is why we hardcore value `2`
      expectEvent.inReceipt(await receipt.wait(), 'ExecutionScheduled', { scheduledExecutionId: 2 });
    });

    it('reverts if an executor is specified twice', async () => {
      await expect(schedule(authenticatedContract, [executor, executor])).to.be.revertedWith('DUPLICATE_EXECUTORS');
    });

    it('reverts if there is no delay set', async () => {
      action = await actionId(authenticatedContract, 'secondProtectedFunction');
      await authorizer.grantPermission(action, user, authenticatedContract, { from: root });

      await expect(
        authorizer.instance
          .connect(user)
          .schedule(
            authenticatedContract.address,
            authenticatedContract.interface.encodeFunctionData('secondProtectedFunction', [functionData]),
            []
          )
      ).to.be.revertedWith('DELAY_IS_NOT_SET');
    });

    it('reverts if the sender has permissions for another contract', async () => {
      await expect(schedule(anotherAuthenticatedContract)).to.be.revertedWith('SENDER_DOES_NOT_HAVE_PERMISSION');
    });

    it('reverts if the sender has permissions for another action', async () => {
      action = await actionId(authenticatedContract, 'secondProtectedFunction');
      await authorizer.scheduleAndExecuteDelayChange(action, delay, { from: root });
      await expect(
        authorizer.instance
          .connect(user)
          .schedule(
            authenticatedContract.address,
            authenticatedContract.interface.encodeFunctionData('secondProtectedFunction', [functionData]),
            []
          )
      ).to.be.revertedWith('SENDER_DOES_NOT_HAVE_PERMISSION');
    });

    it('reverts if the sender does not have permission', async () => {
      await expect(
        authorizer.instance
          .connect(other)
          .schedule(
            authenticatedContract.address,
            authenticatedContract.interface.encodeFunctionData('protectedFunction', [functionData]),
            []
          )
      ).to.be.revertedWith('SENDER_DOES_NOT_HAVE_PERMISSION');
    });

    it('reverts if the target is the authorizer', async () => {
      const where = authorizer.instance;
      await expect(schedule(where)).to.be.revertedWith('CANNOT_SCHEDULE_AUTHORIZER_ACTIONS');
    });

    it('reverts the target is the execution helper', async () => {
      const where = await authorizer.instance.getTimelockExecutionHelper();
      await expect(schedule(where)).to.be.revertedWith('ATTEMPTING_EXECUTION_HELPER_REENTRANCY');
    });

    it('reverts if schedule for EOA', async () => {
      // we do not specify reason here because call to an EOA results in the following error:
      // Transaction reverted without a reason

      await expect(authorizer.schedule(other.address, functionData, [], { from: user })).to.be.reverted;
    });

    it('reverts if data is less than 4 bytes', async () => {
      await expect(authorizer.schedule(authenticatedContract.address, '0x00', [], { from: user })).to.be.revertedWith(
        'DATA_TOO_SHORT'
      );
    });
  });

  describe('execute', () => {
    const delay = DAY;
    const functionData = '0x0123456789abcdef';

    sharedBeforeEach('grant protected function permission with delay', async () => {
      // We must set a delay for the `setAuthorizer` function as well to be able to give one to `protectedFunction`,
      // which it must have in order to be able to schedule calls to it.
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

    it('stores executor information', async () => {
      const id = await schedule();
      await advanceTime(delay);
      await authorizer.execute(id, { from: executor });

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.executedBy).to.equal(executor.address);
      expect(scheduledExecution.executedAt).to.equal(await currentTimestamp());
    });

    it('stores empty canceler information', async () => {
      const id = await schedule();
      await advanceTime(delay);
      await authorizer.execute(id, { from: executor });

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.canceledBy).to.equal(ZERO_ADDRESS);
      expect(scheduledExecution.canceledAt).to.equal(0);
    });

    it('execute returns a correct result', async () => {
      const id = await schedule();
      await advanceTime(delay);
      const ret = await authorizer.instance.connect(executor).callStatic.execute(id);

      // we have to slice first 4 selector bytes from the input data to get the return data
      expect(ret).to.be.eq(
        '0x' + authenticatedContract.interface.encodeFunctionData('protectedFunction', [functionData]).slice(10)
      );
    });

    context('when the action is protected', () => {
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
      await expect(authorizer.execute(id, { from: executor })).to.be.revertedWith('EXECUTION_ALREADY_EXECUTED');
    });

    it('reverts if action was canceled', async () => {
      const id = await schedule();
      await advanceTime(delay);
      await authorizer.cancel(id, { from: user });
      await expect(authorizer.execute(id, { from: executor })).to.be.revertedWith('EXECUTION_ALREADY_CANCELED');
    });

    it('reverts if the delay has not passed', async () => {
      const id = await schedule();
      await expect(authorizer.execute(id, { from: executor })).to.be.revertedWith('EXECUTION_NOT_YET_EXECUTABLE');
    });

    it('reverts if the scheduled id is invalid', async () => {
      await expect(authorizer.execute(100)).to.be.revertedWith('EXECUTION_DOES_NOT_EXIST');
    });
  });

  describe('cancel', () => {
    const delay = DAY;

    sharedBeforeEach('grant protected function permission with delay', async () => {
      // We must set a delay for the `setAuthorizer` function as well to be able to give one to `protectedFunction`,
      // which it must have in order to be able to schedule calls to it.
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

    it('stores canceler information', async () => {
      const id = await schedule();
      await advanceTime(delay);
      await authorizer.cancel(id, { from: canceler });

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.canceledBy).to.equal(canceler.address);
      expect(scheduledExecution.canceledAt).to.equal(await currentTimestamp());
    });

    it('stores empty executor information', async () => {
      const id = await schedule();
      await advanceTime(delay);
      await authorizer.cancel(id, { from: canceler });

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.executedBy).to.equal(ZERO_ADDRESS);
      expect(scheduledExecution.executedAt).to.equal(0);
    });

    it('specific canceler can cancel the action', async () => {
      const id = await schedule();
      await authorizer.cancel(id, { from: canceler });

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.canceled).to.be.true;
    });

    it('global canceler can cancel the action', async () => {
      await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });
      const id = await authorizer.schedule(
        authenticatedContract,
        authenticatedContract.interface.encodeFunctionData('protectedFunction', ['0x']),
        [],
        { from: user }
      );
      await authorizer.cancel(id, { from: canceler });

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.canceled).to.be.true;
    });

    it('root canceler can cancel the action', async () => {
      const id = await schedule();
      await authorizer.cancel(id, { from: root });

      const scheduledExecution = await authorizer.getScheduledExecution(id);
      expect(scheduledExecution.canceled).to.be.true;
    });

    it('emits an event', async () => {
      const id = await schedule();
      const receipt = await authorizer.cancel(id, { from: canceler });

      expectEvent.inReceipt(await receipt.wait(), 'ExecutionCanceled', { scheduledExecutionId: id });
    });

    it('cannot be canceled twice', async () => {
      const id = await schedule();
      await authorizer.cancel(id, { from: canceler });

      await expect(authorizer.cancel(id, { from: canceler })).to.be.revertedWith('EXECUTION_ALREADY_CANCELED');
    });

    it('reverts if the scheduled id is invalid', async () => {
      await expect(authorizer.cancel(100)).to.be.revertedWith('EXECUTION_DOES_NOT_EXIST');
    });

    it('reverts if action was executed', async () => {
      const id = await schedule();
      await advanceTime(delay);
      await authorizer.execute(id);

      await expect(authorizer.cancel(id, { from: canceler })).to.be.revertedWith('EXECUTION_ALREADY_EXECUTED');
    });

    it('reverts if sender is not canceler', async () => {
      const id = await schedule();

      await expect(authorizer.cancel(id, { from: other })).to.be.revertedWith('SENDER_IS_NOT_CANCELER');
    });
  });

  describe('getScheduledExecutions', () => {
    const delay = DAY * 5;

    sharedBeforeEach('set authorizer permission delay', async () => {
      // We must set a delay for the `setAuthorizer` function as well to be able to give one to `protectedFunction`,
      // which it must have in order to be able to schedule calls to it.
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, 2 * delay, { from: root });
    });

    sharedBeforeEach('grant permission', async () => {
      const action = await actionId(authenticatedContract, 'protectedFunction');
      await authorizer.grantPermission(action, user, authenticatedContract, { from: root });

      await authorizer.scheduleAndExecuteDelayChange(action, delay, { from: root });
    });

    const schedule = async (functionData: string): Promise<number> => {
      return authorizer.schedule(
        authenticatedContract.address,
        authenticatedContract.interface.encodeFunctionData('protectedFunction', [functionData]),
        [],
        { from: user }
      );
    };

    // We will schedule 5 calls to `protectedFunction`, with data 0x00, 0x01, 0x02, etc.
    const SCHEDULED_ENTRIES = 5;
    // There'll be two extra entries: the one used to set the delay for setAuthorizer, and the one used to set the delay
    // for `protectedFunction`.
    const TOTAL_ENTRIES = SCHEDULED_ENTRIES + 2;

    const LARGE_MAX_SIZE = 10; // This is more than there are total entries, so it won't affect the result

    sharedBeforeEach('schedule multiple entries', async () => {
      for (let i = 0; i < SCHEDULED_ENTRIES; ++i) {
        await schedule(`0x0${i}`);
      }
    });

    it('returns the number of total entries', async () => {
      expect(await authorizer.instance.getScheduledExecutionsCount()).to.equal(TOTAL_ENTRIES);
    });

    it('reverts if the skip value is too large', async () => {
      await expect(authorizer.instance.getScheduledExecutions(TOTAL_ENTRIES, LARGE_MAX_SIZE, false)).to.be.revertedWith(
        'SKIP_VALUE_TOO_LARGE'
      );
    });

    it('reverts if the maxSize value is zero', async () => {
      await expect(authorizer.instance.getScheduledExecutions(0, 0, false)).to.be.revertedWith('ZERO_MAX_SIZE_VALUE');
    });

    context('in chronological order', () => {
      const reverseOrder = false;

      it('returns entries in chronological order', async () => {
        const entries = await authorizer.instance.getScheduledExecutions(0, LARGE_MAX_SIZE, reverseOrder);

        expect(entries.length).to.equal(TOTAL_ENTRIES);

        // The first entry is the one that sets the setAuthorizer delay
        expect(entries[0].where).to.equal(authorizer.address);
        expect(entries[0].data).to.equal(
          authorizer.interface.encodeFunctionData('setDelay', [await actionId(vault, 'setAuthorizer'), 2 * delay])
        );

        // The last entry is the one that we scheduled
        expect(entries[entries.length - 1].where).to.equal(authenticatedContract.address);
        expect(entries[entries.length - 1].data).to.equal(
          authenticatedContract.interface.encodeFunctionData('protectedFunction', [`0x04`])
        );
      });

      it('skips older entries', async () => {
        // We skip the initial two entries (setDelay for setAuthorizer and setDelay for protectedFunction)
        const entries = await authorizer.instance.getScheduledExecutions(2, LARGE_MAX_SIZE, reverseOrder);

        expect(entries.length).to.equal(SCHEDULED_ENTRIES);

        expect(entries[0].where).to.equal(authenticatedContract.address);
        expect(entries[0].data).to.equal(
          authenticatedContract.interface.encodeFunctionData('protectedFunction', [`0x00`])
        );

        // The last entry is the one that we scheduled
        expect(entries[entries.length - 1].where).to.equal(authenticatedContract.address);
        expect(entries[entries.length - 1].data).to.equal(
          authenticatedContract.interface.encodeFunctionData('protectedFunction', [`0x04`])
        );
      });

      it('trims newer entries with lower maxSize', async () => {
        // This skips the initial two entries, but only returns 3 of the `protectedFunction` calls
        const entries = await authorizer.instance.getScheduledExecutions(2, 3, reverseOrder);

        expect(entries.length).to.equal(3);

        expect(entries[0].where).to.equal(authenticatedContract.address);
        expect(entries[0].data).to.equal(
          authenticatedContract.interface.encodeFunctionData('protectedFunction', [`0x00`])
        );

        expect(entries[2].where).to.equal(authenticatedContract.address);
        expect(entries[2].data).to.equal(
          authenticatedContract.interface.encodeFunctionData('protectedFunction', [`0x02`])
        );
      });
    });

    context('in reverse chronological order', () => {
      const reverseOrder = true;

      it('returns entries in reverse chronological order', async () => {
        const entries = await authorizer.instance.getScheduledExecutions(0, LARGE_MAX_SIZE, reverseOrder);

        expect(entries.length).to.equal(TOTAL_ENTRIES);

        // The first entry is the last one that we scheduled
        expect(entries[0].where).to.equal(authenticatedContract.address);
        expect(entries[0].data).to.equal(
          authenticatedContract.interface.encodeFunctionData('protectedFunction', [`0x04`])
        );

        // The last entry is the one that sets the setAuthorizer delay
        expect(entries[entries.length - 1].where).to.equal(authorizer.address);
        expect(entries[entries.length - 1].data).to.equal(
          authorizer.interface.encodeFunctionData('setDelay', [await actionId(vault, 'setAuthorizer'), 2 * delay])
        );
      });

      it('skips newer entries', async () => {
        // We skip the last two entries (the last two calls to `protectedFunction`)
        const entries = await authorizer.instance.getScheduledExecutions(2, LARGE_MAX_SIZE, reverseOrder);

        expect(entries.length).to.equal(TOTAL_ENTRIES - 2);

        // The first entry is the third to last that we scheduled
        expect(entries[0].where).to.equal(authenticatedContract.address);
        expect(entries[0].data).to.equal(
          authenticatedContract.interface.encodeFunctionData('protectedFunction', [`0x02`])
        );

        // The last entry is the one that sets the setAuthorizer delay
        expect(entries[entries.length - 1].where).to.equal(authorizer.address);
        expect(entries[entries.length - 1].data).to.equal(
          authorizer.interface.encodeFunctionData('setDelay', [await actionId(vault, 'setAuthorizer'), 2 * delay])
        );
      });

      it('trims newer entries with lower maxSize', async () => {
        // This skips the last two calls to `protectedFunction`, but only returns 3 of the `protectedFunction` calls
        // (trimming the two initial setup actions).
        const entries = await authorizer.instance.getScheduledExecutions(2, 3, reverseOrder);

        expect(entries.length).to.equal(3);

        // This is the third to last scheduled call to `protectedFunction`
        expect(entries[0].where).to.equal(authenticatedContract.address);
        expect(entries[0].data).to.equal(
          authenticatedContract.interface.encodeFunctionData('protectedFunction', [`0x02`])
        );

        // This is the first scheduled call to `protectedFunction`
        expect(entries[2].where).to.equal(authenticatedContract.address);
        expect(entries[2].data).to.equal(
          authenticatedContract.interface.encodeFunctionData('protectedFunction', [`0x00`])
        );
      });
    });
  });
});
