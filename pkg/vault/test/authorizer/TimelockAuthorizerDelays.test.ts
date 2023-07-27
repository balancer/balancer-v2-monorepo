import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TimelockAuthorizer from '@balancer-labs/v2-helpers/src/models/authorizer/TimelockAuthorizer';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { advanceTime, currentTimestamp, DAY, MONTH } from '@balancer-labs/v2-helpers/src/time';
import { randomAddress, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { range } from 'lodash';

describe('TimelockAuthorizer delays', () => {
  let authorizer: TimelockAuthorizer, vault: Contract;

  let root: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, root, other] = await ethers.getSigners();
  });

  const ACTION_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ACTION_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';

  const MINIMUM_EXECUTION_DELAY = 5 * DAY;

  sharedBeforeEach('deploy authorizer', async () => {
    let authorizerContract: Contract;

    ({ instance: vault, authorizer: authorizerContract } = await Vault.create({
      admin: root,
      nextAdmin: ZERO_ADDRESS,
    }));

    authorizer = new TimelockAuthorizer(authorizerContract, root);
  });

  sharedBeforeEach('set delay to set authorizer', async () => {
    const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
    // setAuthorizer must have a delay larger or equal than the one we intend to set - it is invalid to set any delays
    // larger than setAuthorizer's.
    // We set a very large setAuthorizer delay so that we have flexibility in choosing both previous and new delay
    // values in the tests.
    await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, DAY * 365, { from: root });
  });

  describe('scheduleDelayChange', () => {
    const ACTION_DELAY = DAY;

    function itSchedulesTheDelayChangeCorrectly(expectedExecutionDelay: number) {
      it('schedules a delay change', async () => {
        const id = await authorizer.scheduleDelayChange(ACTION_1, ACTION_DELAY, [], { from: root });

        const { executed, data, where, executableAt } = await authorizer.getScheduledExecution(id);
        expect(executed).to.be.false;
        expect(data).to.be.equal(
          authorizer.instance.interface.encodeFunctionData('setDelay', [ACTION_1, ACTION_DELAY])
        );
        expect(where).to.be.equal(authorizer.address);
        expect(executableAt).to.equal((await currentTimestamp()).add(expectedExecutionDelay));
      });

      it('increases the scheduled execution count', async () => {
        const countBefore = await authorizer.instance.getScheduledExecutionsCount();
        await authorizer.scheduleDelayChange(ACTION_1, ACTION_DELAY, [], { from: root });

        const countAfter = await authorizer.instance.getScheduledExecutionsCount();

        expect(countAfter).to.equal(countBefore.add(1));
      });

      it('stores scheduler information', async () => {
        const id = await authorizer.scheduleDelayChange(ACTION_1, ACTION_DELAY, [], { from: root });

        const scheduledExecution = await authorizer.getScheduledExecution(id);
        expect(scheduledExecution.scheduledBy).to.equal(root.address);
        expect(scheduledExecution.scheduledAt).to.equal(await currentTimestamp());
      });

      it('stores empty executor and canceler information', async () => {
        const id = await authorizer.scheduleDelayChange(ACTION_1, ACTION_DELAY, [], { from: root });

        const scheduledExecution = await authorizer.getScheduledExecution(id);
        expect(scheduledExecution.executedBy).to.equal(ZERO_ADDRESS);
        expect(scheduledExecution.executedAt).to.equal(0);
        expect(scheduledExecution.canceledBy).to.equal(ZERO_ADDRESS);
        expect(scheduledExecution.canceledAt).to.equal(0);
      });

      it('execution can be unprotected', async () => {
        const id = await authorizer.scheduleDelayChange(ACTION_1, ACTION_DELAY, [], { from: root });
        const execution = await authorizer.getScheduledExecution(id);

        expect(execution.protected).to.be.false;
      });

      it('execution can be protected', async () => {
        const executors = range(4).map(randomAddress);
        const id = await authorizer.scheduleDelayChange(ACTION_1, ACTION_DELAY, executors, { from: root });
        const execution = await authorizer.getScheduledExecution(id);

        expect(execution.protected).to.be.true;
        await Promise.all(
          executors.map(async (executor) => expect(await authorizer.isExecutor(id, executor)).to.be.true)
        );
      });

      it('root can cancel the execution', async () => {
        const id = await authorizer.scheduleDelayChange(ACTION_1, ACTION_DELAY, [], { from: root });
        expect(await authorizer.isCanceler(id, root)).to.be.true;

        const receipt = await authorizer.cancel(id, { from: root });
        expectEvent.inReceipt(await receipt.wait(), 'ExecutionCanceled', { scheduledExecutionId: id });
      });

      it('can be executed after the expected delay', async () => {
        const id = await authorizer.scheduleDelayChange(ACTION_1, ACTION_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        const receipt = await authorizer.execute(id);
        expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', { scheduledExecutionId: id });
      });

      it('sets the new action delay when executed', async () => {
        const id = await authorizer.scheduleDelayChange(ACTION_1, ACTION_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        await authorizer.execute(id);

        expect(await authorizer.delay(ACTION_1)).to.be.equal(ACTION_DELAY);
      });

      it('does not set any other action delay when executed', async () => {
        const previousAction2Delay = await authorizer.delay(ACTION_2);

        const id = await authorizer.scheduleDelayChange(ACTION_1, ACTION_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        await authorizer.execute(id);

        expect(await authorizer.delay(ACTION_2)).to.be.equal(previousAction2Delay);
      });

      it('does not set the grant action delay when executed', async () => {
        const previousGrantDelay = await authorizer.getActionIdGrantDelay(ACTION_1);

        const id = await authorizer.scheduleDelayChange(ACTION_1, ACTION_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        await authorizer.execute(id);

        expect(await authorizer.getActionIdGrantDelay(ACTION_1)).to.be.equal(previousGrantDelay);
      });

      it('does not set the revoke action delay when executed', async () => {
        const previousRevokeDelay = await authorizer.getActionIdRevokeDelay(ACTION_1);

        const id = await authorizer.scheduleDelayChange(ACTION_1, ACTION_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        await authorizer.execute(id);

        expect(await authorizer.getActionIdRevokeDelay(ACTION_1)).to.be.equal(previousRevokeDelay);
      });

      it('emits an event', async () => {
        const id = await authorizer.scheduleDelayChange(ACTION_1, ACTION_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        const receipt = await authorizer.execute(id);
        expectEvent.inReceipt(await receipt.wait(), 'ActionDelaySet', { actionId: ACTION_1, delay: ACTION_DELAY });
      });
    }

    context('when the delay is being increased', () => {
      // When increasing the delay, the execution delay should always be the MINIMUM_EXECUTION_DELAY.

      context('when there was no previous delay', () => {
        itSchedulesTheDelayChangeCorrectly(MINIMUM_EXECUTION_DELAY);
      });

      context('when there was a previous delay set', () => {
        sharedBeforeEach('set a previous smaller delay', async () => {
          await authorizer.scheduleAndExecuteDelayChange(ACTION_1, ACTION_DELAY / 2, { from: root });
        });

        itSchedulesTheDelayChangeCorrectly(MINIMUM_EXECUTION_DELAY);
      });
    });

    context('when the delay is being decreased', () => {
      // When the delay is decreased, the execution delay should be the larger of the delay difference and
      // MINIMUM_EXECUTION_DELAY.

      context('when the previous delay was close to the new one', () => {
        const previousDelay = ACTION_DELAY + DAY;

        sharedBeforeEach(async () => {
          await authorizer.scheduleAndExecuteDelayChange(ACTION_1, previousDelay, { from: root });
        });

        itSchedulesTheDelayChangeCorrectly(MINIMUM_EXECUTION_DELAY);
      });

      context('when the previous delay was much larger than the new one', () => {
        const previousDelay = ACTION_DELAY + MONTH;

        sharedBeforeEach(async () => {
          await authorizer.scheduleAndExecuteDelayChange(ACTION_1, previousDelay, { from: root });
        });

        itSchedulesTheDelayChangeCorrectly(previousDelay - ACTION_DELAY);
      });
    });

    describe('error scenarios', () => {
      it('reverts if the sender is not root', async () => {
        await expect(authorizer.scheduleDelayChange(ACTION_1, DAY, [], { from: other })).to.be.revertedWith(
          'SENDER_IS_NOT_ROOT'
        );
      });

      it('reverts if the new delay is more than 2 years', async () => {
        await expect(
          authorizer.scheduleDelayChange(ACTION_1, DAY * 365 * 2 + 1, [], { from: root })
        ).to.be.revertedWith('DELAY_TOO_LARGE');
      });

      it('reverts if setDelay is called directly', async () => {
        await expect(authorizer.instance.setDelay(ACTION_1, DAY)).to.be.revertedWith('CAN_ONLY_BE_SCHEDULED');
      });

      it('reverts if the delay is greater than the setAuthorizer delay', async () => {
        const setAuthorizerDelay = await authorizer.delay(await actionId(vault, 'setAuthorizer'));
        const id = await authorizer.scheduleDelayChange(ACTION_1, setAuthorizerDelay.add(1), [], { from: root });

        // This condition is only tested at the time the delay is actually set (in case e.g. there was a scheduled action
        // to change setAuthorizer's delay), so we must attempt to execute the action to get the expected revert.
        await advanceTime(MINIMUM_EXECUTION_DELAY);
        await expect(authorizer.execute(id)).to.be.revertedWith('DELAY_EXCEEDS_SET_AUTHORIZER');
      });
    });
  });

  describe('scheduleGrantDelayChange', () => {
    const ACTION_GRANT_DELAY = DAY;

    function itSchedulesTheGrantDelayChangeCorrectly(expectedExecutionDelay: number) {
      it('schedules a grant delay change', async () => {
        const id = await authorizer.scheduleGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY, [], { from: root });

        const { executed, data, where, executableAt } = await authorizer.getScheduledExecution(id);

        expect(executed).to.be.false;
        expect(data).to.be.equal(
          authorizer.instance.interface.encodeFunctionData('setGrantDelay', [ACTION_1, ACTION_GRANT_DELAY])
        );
        expect(where).to.be.equal(authorizer.address);
        expect(executableAt).to.equal((await currentTimestamp()).add(expectedExecutionDelay));
      });

      it('increases the scheduled execution count', async () => {
        const countBefore = await authorizer.instance.getScheduledExecutionsCount();
        await authorizer.scheduleGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY, [], { from: root });

        const countAfter = await authorizer.instance.getScheduledExecutionsCount();

        expect(countAfter).to.equal(countBefore.add(1));
      });

      it('stores scheduler information', async () => {
        const id = await authorizer.scheduleGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY, [], { from: root });

        const scheduledExecution = await authorizer.getScheduledExecution(id);
        expect(scheduledExecution.scheduledBy).to.equal(root.address);
        expect(scheduledExecution.scheduledAt).to.equal(await currentTimestamp());
      });

      it('stores empty executor and canceler information', async () => {
        const id = await authorizer.scheduleGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY, [], { from: root });

        const scheduledExecution = await authorizer.getScheduledExecution(id);
        expect(scheduledExecution.executedBy).to.equal(ZERO_ADDRESS);
        expect(scheduledExecution.executedAt).to.equal(0);
        expect(scheduledExecution.canceledBy).to.equal(ZERO_ADDRESS);
        expect(scheduledExecution.canceledAt).to.equal(0);
      });

      it('execution can be unprotected', async () => {
        const id = await authorizer.scheduleGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY, [], { from: root });
        const execution = await authorizer.getScheduledExecution(id);

        expect(execution.protected).to.be.false;
      });

      it('execution can be protected', async () => {
        const executors = range(4).map(() => ethers.Wallet.createRandom().address);
        const id = await authorizer.scheduleGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY, executors, { from: root });
        const execution = await authorizer.getScheduledExecution(id);

        expect(execution.protected).to.be.true;
        await Promise.all(
          executors.map(async (executor) => expect(await authorizer.isExecutor(id, executor)).to.be.true)
        );
      });

      it('root can cancel the execution', async () => {
        const id = await authorizer.scheduleGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY, [], { from: root });
        expect(await authorizer.isCanceler(id, root)).to.be.true;

        const receipt = await authorizer.cancel(id, { from: root });
        expectEvent.inReceipt(await receipt.wait(), 'ExecutionCanceled', { scheduledExecutionId: id });
      });

      it('can be executed after the expected delay', async () => {
        const id = await authorizer.scheduleGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        const receipt = await authorizer.execute(id);
        expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', { scheduledExecutionId: id });
      });

      it('sets the new grant action delay when executed', async () => {
        const id = await authorizer.scheduleGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        await authorizer.execute(id);

        expect(await authorizer.getActionIdGrantDelay(ACTION_1)).to.be.equal(ACTION_GRANT_DELAY);
      });

      it('does not set any other action grant delay when executed', async () => {
        const previousAction2GrantDelay = await authorizer.getActionIdGrantDelay(ACTION_2);

        const id = await authorizer.scheduleGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        await authorizer.execute(id);

        expect(await authorizer.getActionIdGrantDelay(ACTION_2)).to.be.equal(previousAction2GrantDelay);
      });

      it('does not set the action delay when executed', async () => {
        const previousActionDelay = await authorizer.delay(ACTION_1);

        const id = await authorizer.scheduleGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        await authorizer.execute(id);

        expect(await authorizer.delay(ACTION_1)).to.be.equal(previousActionDelay);
      });

      it('does not set the revoke action delay when executed', async () => {
        const previousActionDelay = await authorizer.getActionIdRevokeDelay(ACTION_1);

        const id = await authorizer.scheduleGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        await authorizer.execute(id);

        expect(await authorizer.getActionIdRevokeDelay(ACTION_1)).to.be.equal(previousActionDelay);
      });

      it('emits an event', async () => {
        const id = await authorizer.scheduleGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        const receipt = await authorizer.execute(id);
        expectEvent.inReceipt(await receipt.wait(), 'GrantDelaySet', {
          actionId: ACTION_1,
          delay: ACTION_GRANT_DELAY,
        });
      });
    }

    context('when the delay is being increased', () => {
      // When incrasing the delay, the execution delay should always be the MINIMUM_EXECUTION_DELAY.

      context('when there was no previous delay', () => {
        itSchedulesTheGrantDelayChangeCorrectly(MINIMUM_EXECUTION_DELAY);
      });

      context('when there was a previous delay set', () => {
        sharedBeforeEach('set a previous smaller delay', async () => {
          await authorizer.scheduleAndExecuteGrantDelayChange(ACTION_1, ACTION_GRANT_DELAY / 2, { from: root });
        });

        itSchedulesTheGrantDelayChangeCorrectly(MINIMUM_EXECUTION_DELAY);
      });
    });

    context('when the delay is being decreased', () => {
      // When the delay is decreased, the execution delay should be the larger of the delay difference and
      // MINIMUM_EXECUTION_DELAY.

      context('when the previous delay was close to the new one', () => {
        const previousDelay = ACTION_GRANT_DELAY + DAY;

        sharedBeforeEach(async () => {
          await authorizer.scheduleAndExecuteGrantDelayChange(ACTION_1, previousDelay, { from: root });
        });

        itSchedulesTheGrantDelayChangeCorrectly(MINIMUM_EXECUTION_DELAY);
      });

      context('when the previous delay was much larger than the new one', () => {
        const previousDelay = ACTION_GRANT_DELAY + MONTH;

        sharedBeforeEach(async () => {
          await authorizer.scheduleAndExecuteGrantDelayChange(ACTION_1, previousDelay, { from: root });
        });

        itSchedulesTheGrantDelayChangeCorrectly(previousDelay - ACTION_GRANT_DELAY);
      });
    });

    describe('error scenarios', () => {
      it('reverts if the sender is not root', async () => {
        await expect(authorizer.scheduleGrantDelayChange(ACTION_1, DAY, [], { from: other })).to.be.revertedWith(
          'SENDER_IS_NOT_ROOT'
        );
      });

      it('reverts if the new delay is more than 2 years', async () => {
        await expect(
          authorizer.scheduleGrantDelayChange(ACTION_1, DAY * 365 * 2 + 1, [], { from: root })
        ).to.be.revertedWith('DELAY_TOO_LARGE');
      });

      it('reverts if setGrantDelay is called directly', async () => {
        await expect(authorizer.instance.setGrantDelay(ACTION_1, DAY)).to.be.revertedWith('CAN_ONLY_BE_SCHEDULED');
      });

      it('reverts if the delay is greater than the setAuthorizer delay', async () => {
        const setAuthorizerDelay = await authorizer.delay(await actionId(vault, 'setAuthorizer'));
        const id = await authorizer.scheduleGrantDelayChange(ACTION_1, setAuthorizerDelay.add(1), [], { from: root });

        // This condition is only tested at the time the delay is actually set (in case e.g. there was a scheduled action
        // to change setAuthorizer's delay), so we must attempt to execute the action to get the expected revert.
        await advanceTime(MINIMUM_EXECUTION_DELAY);
        await expect(authorizer.execute(id)).to.be.revertedWith('DELAY_EXCEEDS_SET_AUTHORIZER');
      });
    });
  });

  describe('scheduleRevokeDelayChange', () => {
    const ACTION_REVOKE_DELAY = DAY;

    function itSchedulesTheRevokeDelayChangeCorrectly(expectedExecutionDelay: number) {
      it('schedules a revoke delay change', async () => {
        const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY, [], { from: root });

        const { executed, data, where, executableAt } = await authorizer.getScheduledExecution(id);

        expect(executed).to.be.false;
        expect(data).to.be.equal(
          authorizer.instance.interface.encodeFunctionData('setRevokeDelay', [ACTION_1, ACTION_REVOKE_DELAY])
        );
        expect(where).to.be.equal(authorizer.address);
        expect(executableAt).to.equal((await currentTimestamp()).add(expectedExecutionDelay));
      });

      it('increases the scheduled execution count', async () => {
        const countBefore = await authorizer.instance.getScheduledExecutionsCount();
        await authorizer.scheduleRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY, [], { from: root });

        const countAfter = await authorizer.instance.getScheduledExecutionsCount();

        expect(countAfter).to.equal(countBefore.add(1));
      });

      it('stores scheduler information', async () => {
        const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY, [], { from: root });

        const scheduledExecution = await authorizer.getScheduledExecution(id);
        expect(scheduledExecution.scheduledBy).to.equal(root.address);
        expect(scheduledExecution.scheduledAt).to.equal(await currentTimestamp());
      });

      it('stores empty executor and canceler information', async () => {
        const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY, [], { from: root });

        const scheduledExecution = await authorizer.getScheduledExecution(id);
        expect(scheduledExecution.executedBy).to.equal(ZERO_ADDRESS);
        expect(scheduledExecution.executedAt).to.equal(0);
        expect(scheduledExecution.canceledBy).to.equal(ZERO_ADDRESS);
        expect(scheduledExecution.canceledAt).to.equal(0);
      });

      it('execution can be unprotected', async () => {
        const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY, [], { from: root });
        const execution = await authorizer.getScheduledExecution(id);

        expect(execution.protected).to.be.false;
      });

      it('execution can be protected', async () => {
        const executors = range(4).map(() => ethers.Wallet.createRandom().address);
        const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY, executors, { from: root });
        const execution = await authorizer.getScheduledExecution(id);

        expect(execution.protected).to.be.true;
        await Promise.all(
          executors.map(async (executor) => expect(await authorizer.isExecutor(id, executor)).to.be.true)
        );
      });

      it('root can cancel the execution', async () => {
        const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY, [], { from: root });
        expect(await authorizer.isCanceler(id, root)).to.be.true;

        const receipt = await authorizer.cancel(id, { from: root });
        expectEvent.inReceipt(await receipt.wait(), 'ExecutionCanceled', { scheduledExecutionId: id });
      });

      it('can be executed after the expected delay', async () => {
        const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        const receipt = await authorizer.execute(id);
        expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', { scheduledExecutionId: id });
      });

      it('sets the new revoke action delay when executed', async () => {
        const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        await authorizer.execute(id);

        expect(await authorizer.getActionIdRevokeDelay(ACTION_1)).to.be.equal(ACTION_REVOKE_DELAY);
      });

      it('does not set any other action revoke delay when executed', async () => {
        const previousAction2RevokeDelay = await authorizer.getActionIdRevokeDelay(ACTION_2);

        const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        await authorizer.execute(id);

        expect(await authorizer.getActionIdRevokeDelay(ACTION_2)).to.be.equal(previousAction2RevokeDelay);
      });

      it('does not set the action delay when executed', async () => {
        const previousActionDelay = await authorizer.delay(ACTION_1);

        const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        await authorizer.execute(id);

        expect(await authorizer.delay(ACTION_1)).to.be.equal(previousActionDelay);
      });

      it('does not set the grant action delay when executed', async () => {
        const previousActionDelay = await authorizer.getActionIdGrantDelay(ACTION_1);

        const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        await authorizer.execute(id);

        expect(await authorizer.getActionIdGrantDelay(ACTION_1)).to.be.equal(previousActionDelay);
      });

      it('emits an event', async () => {
        const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY, [], { from: root });

        await advanceTime(expectedExecutionDelay);
        const receipt = await authorizer.execute(id);
        expectEvent.inReceipt(await receipt.wait(), 'RevokeDelaySet', {
          actionId: ACTION_1,
          delay: ACTION_REVOKE_DELAY,
        });
      });
    }

    context('when the delay is being increased', () => {
      // When incrasing the delay, the execution delay should always be the MINIMUM_EXECUTION_DELAY.

      context('when there was no previous delay', () => {
        itSchedulesTheRevokeDelayChangeCorrectly(MINIMUM_EXECUTION_DELAY);
      });

      context('when there was a previous delay set', () => {
        sharedBeforeEach('set a previous smaller delay', async () => {
          await authorizer.scheduleAndExecuteRevokeDelayChange(ACTION_1, ACTION_REVOKE_DELAY / 2, { from: root });
        });

        itSchedulesTheRevokeDelayChangeCorrectly(MINIMUM_EXECUTION_DELAY);
      });
    });

    context('when the delay is being decreased', () => {
      // When the delay is decreased, the execution delay should be the larger of the delay difference and
      // MINIMUM_EXECUTION_DELAY.

      context('when the previous delay was close to the new one', () => {
        const previousDelay = ACTION_REVOKE_DELAY + DAY;

        sharedBeforeEach(async () => {
          await authorizer.scheduleAndExecuteRevokeDelayChange(ACTION_1, previousDelay, { from: root });
        });

        itSchedulesTheRevokeDelayChangeCorrectly(MINIMUM_EXECUTION_DELAY);
      });

      context('when the previous delay was much larger than the new one', () => {
        const previousDelay = ACTION_REVOKE_DELAY + MONTH;

        sharedBeforeEach(async () => {
          await authorizer.scheduleAndExecuteRevokeDelayChange(ACTION_1, previousDelay, { from: root });
        });

        itSchedulesTheRevokeDelayChangeCorrectly(previousDelay - ACTION_REVOKE_DELAY);
      });
    });

    describe('error scenarios', () => {
      it('reverts if the sender is not root', async () => {
        await expect(authorizer.scheduleRevokeDelayChange(ACTION_1, DAY, [], { from: other })).to.be.revertedWith(
          'SENDER_IS_NOT_ROOT'
        );
      });

      it('reverts if the new delay is more than 2 years', async () => {
        await expect(
          authorizer.scheduleRevokeDelayChange(ACTION_1, DAY * 365 * 2 + 1, [], { from: root })
        ).to.be.revertedWith('DELAY_TOO_LARGE');
      });

      it('reverts if setRevokeDelay is called directly', async () => {
        await expect(authorizer.instance.setRevokeDelay(ACTION_1, DAY)).to.be.revertedWith('CAN_ONLY_BE_SCHEDULED');
      });

      it('reverts if the delay is greater than the setAuthorizer delay', async () => {
        const setAuthorizerDelay = await authorizer.delay(await actionId(vault, 'setAuthorizer'));
        const id = await authorizer.scheduleRevokeDelayChange(ACTION_1, setAuthorizerDelay.add(1), [], { from: root });

        // This condition is only tested at the time the delay is actually set (in case e.g. there was a scheduled action
        // to change setAuthorizer's delay), so we must attempt to execute the action to get the expected revert.
        await advanceTime(MINIMUM_EXECUTION_DELAY);
        await expect(authorizer.execute(id)).to.be.revertedWith('DELAY_EXCEEDS_SET_AUTHORIZER');
      });
    });
  });
});
