import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TimelockAuthorizer from '@balancer-labs/v2-helpers/src/models/authorizer/TimelockAuthorizer';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { advanceTime, currentTimestamp } from '@balancer-labs/v2-helpers/src/time';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('TimelockAuthorizer root', () => {
  let authorizer: TimelockAuthorizer;
  let root: SignerWithAddress, nextRoot: SignerWithAddress, user: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, root, nextRoot, user, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    const vault = await Vault.create({
      admin: root,
      nextAdmin: nextRoot.address,
    });

    authorizer = new TimelockAuthorizer(vault.authorizer, root);
  });

  describe('root', () => {
    describe('setPendingRoot', () => {
      let ROOT_CHANGE_DELAY: BigNumberish;

      beforeEach('fetch root change delay', async () => {
        ROOT_CHANGE_DELAY = await authorizer.instance.getRootTransferDelay();
      });

      it('sets the nextRoot as the pending root during construction', async () => {
        expect(await authorizer.instance.getPendingRoot()).to.equal(nextRoot.address);
      });

      context('when scheduling root change', async () => {
        function itSetsThePendingRootCorrectly(getNewPendingRoot: () => SignerWithAddress) {
          it('schedules a root change', async () => {
            const newPendingRoot: SignerWithAddress = getNewPendingRoot();
            const expectedData = authorizer.instance.interface.encodeFunctionData('setPendingRoot', [
              newPendingRoot.address,
            ]);

            const id = await authorizer.scheduleRootChange(newPendingRoot, [], { from: root });

            const scheduledExecution = await authorizer.getScheduledExecution(id);
            expect(scheduledExecution.executed).to.be.false;
            expect(scheduledExecution.data).to.be.equal(expectedData);
            expect(scheduledExecution.where).to.be.equal(authorizer.address);
            expect(scheduledExecution.protected).to.be.false;
            expect(scheduledExecution.executableAt).to.be.at.almostEqual(
              (await currentTimestamp()).add(ROOT_CHANGE_DELAY)
            );
          });

          it('can be executed after the delay', async () => {
            const newPendingRoot: SignerWithAddress = getNewPendingRoot();
            const id = await authorizer.scheduleRootChange(newPendingRoot, [], { from: root });

            await expect(authorizer.execute(id)).to.be.revertedWith('EXECUTION_NOT_YET_EXECUTABLE');

            await advanceTime(ROOT_CHANGE_DELAY);
            await authorizer.execute(id);

            expect(await authorizer.isRoot(root)).to.be.true;
            expect(await authorizer.isPendingRoot(newPendingRoot)).to.be.true;
          });

          it('emits an event', async () => {
            const newPendingRoot: SignerWithAddress = getNewPendingRoot();
            let receipt = await authorizer.instance.connect(root).scheduleRootChange(newPendingRoot.address, []);
            const event = expectEvent.inReceipt(await receipt.wait(), 'RootChangeScheduled', {
              newRoot: newPendingRoot.address,
            });

            await advanceTime(ROOT_CHANGE_DELAY);
            receipt = await authorizer.execute(event.args.scheduledExecutionId);
            expectEvent.inReceipt(await receipt.wait(), 'PendingRootSet', { pendingRoot: newPendingRoot.address });
          });
        }

        itSetsThePendingRootCorrectly(() => user);

        context('starting a new root transfer while pending root is set', () => {
          // We test this to ensure that executing an action which sets the pending root to an address which cannot
          // call `claimRoot` won't result in the Authorizer being unable to transfer root power to a different address.

          sharedBeforeEach('initiate a root transfer', async () => {
            const id = await authorizer.scheduleRootChange(user, [], { from: root });
            await advanceTime(ROOT_CHANGE_DELAY);
            await authorizer.execute(id);
          });

          itSetsThePendingRootCorrectly(() => other);
        });
      });

      it('reverts if trying to execute it directly', async () => {
        await expect(authorizer.instance.setPendingRoot(user.address)).to.be.revertedWith('CAN_ONLY_BE_SCHEDULED');
      });

      it('reverts if the sender is not the root', async () => {
        await expect(authorizer.scheduleRootChange(user, [], { from: user })).to.be.revertedWith('SENDER_IS_NOT_ROOT');
      });
    });

    describe('claimRoot', () => {
      let ROOT_CHANGE_DELAY: BigNumberish;

      beforeEach('fetch root change delay', async () => {
        ROOT_CHANGE_DELAY = await authorizer.instance.getRootTransferDelay();
      });

      sharedBeforeEach('initiate a root transfer', async () => {
        const id = await authorizer.scheduleRootChange(user, [], { from: root });
        await advanceTime(ROOT_CHANGE_DELAY);
        await authorizer.execute(id);
      });

      it('transfers root powers from the current to the pending root', async () => {
        await authorizer.claimRoot({ from: user });
        expect(await authorizer.isRoot(root)).to.be.false;
        expect(await authorizer.isRoot(user)).to.be.true;
        expect(await authorizer.instance.getRoot()).to.be.eq(user.address);
      });

      it('resets the pending root address to the zero address', async () => {
        await authorizer.claimRoot({ from: user });
        expect(await authorizer.isPendingRoot(root)).to.be.false;
        expect(await authorizer.isPendingRoot(user)).to.be.false;
        expect(await authorizer.isPendingRoot(ZERO_ADDRESS)).to.be.true;
        expect(await authorizer.instance.getPendingRoot()).to.be.eq(ZERO_ADDRESS);
      });

      it('emits an event', async () => {
        const receipt = await authorizer.claimRoot({ from: user });
        expectEvent.inReceipt(await receipt.wait(), 'RootSet', { root: user.address });
        expectEvent.inReceipt(await receipt.wait(), 'PendingRootSet', { pendingRoot: ZERO_ADDRESS });
      });

      it('reverts if the sender is not the pending root', async () => {
        await expect(authorizer.claimRoot({ from: other })).to.be.revertedWith('SENDER_IS_NOT_PENDING_ROOT');
      });
    });
  });
});
