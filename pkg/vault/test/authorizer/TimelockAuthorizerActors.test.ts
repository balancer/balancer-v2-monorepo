import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TimelockAuthorizer from '@balancer-labs/v2-helpers/src/models/authorizer/TimelockAuthorizer';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { advanceTime, DAY, MONTH } from '@balancer-labs/v2-helpers/src/time';

describe('TimelockAuthorizer actors', () => {
  let vault: Vault;
  let authorizer: TimelockAuthorizer;
  let root: SignerWithAddress,
    nextRoot: SignerWithAddress,
    account: SignerWithAddress,
    canceler: SignerWithAddress,
    other: SignerWithAddress;

  before('setup signers', async () => {
    [, root, nextRoot, account, canceler, other] = await ethers.getSigners();
  });

  const GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID = MAX_UINT256;

  const ACTION_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ACTION_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';

  const WHERE_1 = ethers.Wallet.createRandom().address;
  const WHERE_2 = ethers.Wallet.createRandom().address;

  const EVERYWHERE = TimelockAuthorizer.EVERYWHERE;

  sharedBeforeEach('deploy authorizer', async () => {
    vault = await Vault.create({
      admin: root,
      nextAdmin: nextRoot.address,
    });

    authorizer = new TimelockAuthorizer(vault.authorizer, root);
  });

  describe('granters', () => {
    describe('addGranter', () => {
      context('in a specific contract', () => {
        it('root is already a granter', async () => {
          expect(await authorizer.isGranter(ACTION_1, root, WHERE_1)).to.be.true;
          expect(await authorizer.isGranter(ACTION_2, root, WHERE_1)).to.be.true;
        });

        it('account is granter for that action only in that contract', async () => {
          await authorizer.addGranter(ACTION_1, account, WHERE_1, { from: root });

          expect(await authorizer.isGranter(ACTION_1, account, WHERE_1)).to.be.true;
          expect(await authorizer.isGranter(ACTION_1, account, WHERE_2)).to.be.false;
          expect(await authorizer.isGranter(ACTION_1, account, EVERYWHERE)).to.be.false;
        });

        it('account is not granter for any other action anywhere', async () => {
          await authorizer.addGranter(ACTION_1, account, WHERE_1, { from: root });

          expect(await authorizer.isGranter(ACTION_2, account, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, account, WHERE_2)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, account, EVERYWHERE)).to.be.false;
        });

        it('emits a GranterAdded event', async () => {
          const receipt = await (await authorizer.addGranter(ACTION_1, account, WHERE_1, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'GranterAdded', {
            actionId: ACTION_1,
            account: account.address,
            where: WHERE_1,
          });
        });

        it('reverts if the account is already a granter', async () => {
          await authorizer.addGranter(ACTION_1, account, WHERE_1, { from: root });
          await expect(authorizer.addGranter(ACTION_1, account, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_GRANTER'
          );
        });

        it('reverts if the account is already a global granter', async () => {
          await authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: root });
          await expect(authorizer.addGranter(ACTION_1, account, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_GRANTER'
          );
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.addGranter(ACTION_1, root, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_GRANTER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await expect(authorizer.addGranter(ACTION_1, account, WHERE_1, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });

      context('in any contract', () => {
        it('root is already a granter', async () => {
          expect(await authorizer.isGranter(ACTION_1, root, EVERYWHERE)).to.be.true;
          expect(await authorizer.isGranter(ACTION_2, root, EVERYWHERE)).to.be.true;
        });

        it('account is granter for that action in any contract', async () => {
          await authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: root });

          expect(await authorizer.isGranter(ACTION_1, account, WHERE_1)).to.be.true;
          expect(await authorizer.isGranter(ACTION_1, account, WHERE_2)).to.be.true;
          expect(await authorizer.isGranter(ACTION_1, account, EVERYWHERE)).to.be.true;
        });

        it('account is not granter for any other action anywhere', async () => {
          await authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: root });

          expect(await authorizer.isGranter(ACTION_2, account, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, account, WHERE_2)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, account, EVERYWHERE)).to.be.false;
        });

        it('emits a GranterAdded event', async () => {
          const receipt = await (await authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'GranterAdded', {
            actionId: ACTION_1,
            account: account.address,
            where: EVERYWHERE,
          });
        });

        it('does not revert if the account is already a granter in a specific contract', async () => {
          await authorizer.addGranter(ACTION_1, account, WHERE_1, { from: root });

          const receipt = await (await authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'GranterAdded', {
            actionId: ACTION_1,
            account: account.address,
            where: EVERYWHERE,
          });
        });

        it('reverts if the account is already a global granter', async () => {
          await authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: root });
          await expect(authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_GRANTER'
          );
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.addGranter(ACTION_1, root, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_GRANTER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await expect(authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });
    });

    describe('removeGranter', () => {
      context('in a specific contract', () => {
        it('account is not a granter for that action anywhere', async () => {
          await authorizer.addGranter(ACTION_1, account, WHERE_1, { from: root });
          await authorizer.removeGranter(ACTION_1, account, WHERE_1, { from: root });

          expect(await authorizer.isGranter(ACTION_1, account, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_1, account, WHERE_2)).to.be.false;
          expect(await authorizer.isGranter(ACTION_1, account, EVERYWHERE)).to.be.false;
        });

        it('account is not a granter for any other action', async () => {
          await authorizer.addGranter(ACTION_1, account, WHERE_1, { from: root });
          await authorizer.removeGranter(ACTION_1, account, WHERE_1, { from: root });

          expect(await authorizer.isGranter(ACTION_2, account, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, account, WHERE_2)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, account, EVERYWHERE)).to.be.false;
        });

        it('emits a GranterRemoved event', async () => {
          await authorizer.addGranter(ACTION_1, account, WHERE_1, { from: root });

          const receipt = await (await authorizer.removeGranter(ACTION_1, account, WHERE_1, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'GranterRemoved', {
            actionId: ACTION_1,
            account: account.address,
            where: WHERE_1,
          });
        });

        it('reverts if the account is not a granter', async () => {
          await expect(authorizer.removeGranter(ACTION_1, account, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_GRANTER'
          );
        });

        it('reverts if the account is a global granter', async () => {
          await authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: root });
          await expect(authorizer.removeGranter(ACTION_1, account, WHERE_1, { from: root })).to.be.revertedWith(
            'GRANTER_IS_GLOBAL'
          );
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.removeGranter(ACTION_1, root, WHERE_1, { from: root })).to.be.revertedWith(
            'CANNOT_REMOVE_ROOT_GRANTER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await authorizer.addGranter(ACTION_1, account, WHERE_1, { from: root });
          await expect(authorizer.removeGranter(ACTION_1, account, WHERE_1, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });

      context('in any contract', () => {
        it('account is not a granter for that action on any contract', async () => {
          await authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: root });
          await authorizer.removeGranter(ACTION_1, account, EVERYWHERE, { from: root });

          expect(await authorizer.isGranter(ACTION_1, account, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_1, account, EVERYWHERE)).to.be.false;
        });

        it('account is not a granter for that any other action anywhere', async () => {
          await authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: root });
          await authorizer.removeGranter(ACTION_1, account, EVERYWHERE, { from: root });

          expect(await authorizer.isGranter(ACTION_2, account, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, account, EVERYWHERE)).to.be.false;
        });

        it('emits a GranterRemoved event', async () => {
          await authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: root });

          const receipt = await (await authorizer.removeGranter(ACTION_1, account, EVERYWHERE, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'GranterRemoved', {
            actionId: ACTION_1,
            account: account.address,
            where: EVERYWHERE,
          });
        });

        it('reverts if the account is not a global granter', async () => {
          await expect(authorizer.removeGranter(ACTION_1, account, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_GRANTER'
          );
        });

        it('reverts if the account is a granter in a specific contract', async () => {
          await authorizer.addGranter(ACTION_1, account, WHERE_1, { from: root });
          await expect(authorizer.removeGranter(ACTION_1, account, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_GRANTER'
          );
        });

        it('preserves granter status if account was granter over both a specific contract and globally', async () => {
          await authorizer.addGranter(ACTION_1, account, WHERE_1, { from: root });
          await authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: root });

          expect(await authorizer.isGranter(ACTION_1, account, WHERE_1)).to.be.true;
          expect(await authorizer.isGranter(ACTION_1, account, EVERYWHERE)).to.be.true;

          await authorizer.removeGranter(ACTION_1, account, EVERYWHERE, { from: root });

          expect(await authorizer.isGranter(ACTION_1, account, WHERE_1)).to.be.true;
          expect(await authorizer.isGranter(ACTION_1, account, EVERYWHERE)).to.be.false;

          await authorizer.removeGranter(ACTION_1, account, WHERE_1, { from: root });

          expect(await authorizer.isGranter(ACTION_1, account, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_1, account, EVERYWHERE)).to.be.false;
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.removeGranter(ACTION_1, root, EVERYWHERE, { from: root })).to.be.revertedWith(
            'CANNOT_REMOVE_ROOT_GRANTER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await authorizer.addGranter(ACTION_1, account, EVERYWHERE, { from: root });
          await expect(authorizer.removeGranter(ACTION_1, account, EVERYWHERE, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });
    });
  });

  describe('revokers', () => {
    describe('addRevoker', () => {
      context('in a specific contract', () => {
        it('root is already a revoker', async () => {
          expect(await authorizer.isRevoker(root, WHERE_1)).to.be.true;
          expect(await authorizer.isRevoker(root, WHERE_2)).to.be.true;
        });

        it('account is a revoker only in that contract', async () => {
          await authorizer.addRevoker(account, WHERE_1, { from: root });

          expect(await authorizer.isRevoker(account, WHERE_1)).to.be.true;
          expect(await authorizer.isRevoker(account, WHERE_2)).to.be.false;
          expect(await authorizer.isRevoker(account, EVERYWHERE)).to.be.false;
        });

        it('emits a RevokerAdded event', async () => {
          const receipt = await (await authorizer.addRevoker(account, WHERE_1, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'RevokerAdded', {
            account: account.address,
            where: WHERE_1,
          });
        });

        it('reverts if account is already a revoker', async () => {
          await authorizer.addRevoker(account, WHERE_1, { from: root });
          await expect(authorizer.addRevoker(account, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_REVOKER'
          );
        });

        it('reverts if account is already a global revoker', async () => {
          await authorizer.addRevoker(account, EVERYWHERE, { from: root });
          await expect(authorizer.addRevoker(account, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_REVOKER'
          );
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.addRevoker(root, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_REVOKER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await expect(authorizer.addRevoker(account, WHERE_1, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });

      context('in any contract', () => {
        it('root is already a revoker', async () => {
          expect(await authorizer.isRevoker(root, EVERYWHERE)).to.be.true;
        });

        it('account is a revoker in any contract', async () => {
          await authorizer.addRevoker(account, EVERYWHERE, { from: root });

          expect(await authorizer.isRevoker(account, WHERE_1)).to.be.true;
          expect(await authorizer.isRevoker(account, WHERE_2)).to.be.true;
          expect(await authorizer.isRevoker(account, EVERYWHERE)).to.be.true;
        });

        it('emits a RevokerAdded event', async () => {
          const receipt = await (await authorizer.addRevoker(account, EVERYWHERE, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'RevokerAdded', {
            account: account.address,
            where: EVERYWHERE,
          });
        });

        it('does not revert if account is already revoker in a specific contract', async () => {
          await authorizer.addRevoker(account, WHERE_1, { from: root });

          const receipt = await (await authorizer.addRevoker(account, EVERYWHERE, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'RevokerAdded', {
            account: account.address,
            where: EVERYWHERE,
          });
        });

        it('reverts if account already is a global revoker', async () => {
          await authorizer.addRevoker(account, EVERYWHERE, { from: root });
          await expect(authorizer.addRevoker(account, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_REVOKER'
          );
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.addRevoker(root, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_REVOKER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await expect(authorizer.addRevoker(account, EVERYWHERE, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });
    });

    describe('removeRevoker', () => {
      context('in a specific contract', () => {
        it('account is not a revoker anywhere', async () => {
          await authorizer.addRevoker(account, WHERE_1, { from: root });
          await authorizer.removeRevoker(account, WHERE_1, { from: root });

          expect(await authorizer.isRevoker(account, WHERE_1)).to.be.false;
          expect(await authorizer.isRevoker(account, WHERE_2)).to.be.false;
          expect(await authorizer.isRevoker(account, EVERYWHERE)).to.be.false;
        });

        it('emits a RevokerRemoved event', async () => {
          await authorizer.addRevoker(account, WHERE_1, { from: root });

          const receipt = await (await authorizer.removeRevoker(account, WHERE_1, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'RevokerRemoved', {
            account: account.address,
            where: WHERE_1,
          });
        });

        it('reverts if the account is not a revoker', async () => {
          await expect(authorizer.removeRevoker(account, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_REVOKER'
          );
        });

        it('reverts if the account is a global revoker', async () => {
          await authorizer.addRevoker(account, EVERYWHERE, { from: root });
          await expect(authorizer.removeRevoker(account, WHERE_1, { from: root })).to.be.revertedWith(
            'REVOKER_IS_GLOBAL'
          );
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.removeRevoker(root, WHERE_1, { from: root })).to.be.revertedWith(
            'CANNOT_REMOVE_ROOT_REVOKER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await authorizer.addRevoker(account, WHERE_1, { from: root });
          await expect(authorizer.removeRevoker(account, WHERE_1, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });

      context('in any contract', () => {
        it('account is not a revoker for any contract', async () => {
          await authorizer.addRevoker(account, EVERYWHERE, { from: root });
          await authorizer.removeRevoker(account, EVERYWHERE, { from: root });

          expect(await authorizer.isRevoker(account, WHERE_1)).to.be.false;
          expect(await authorizer.isRevoker(account, EVERYWHERE)).to.be.false;
        });

        it('emits a RevokerRemoved event', async () => {
          await authorizer.addRevoker(account, EVERYWHERE, { from: root });

          const receipt = await (await authorizer.removeRevoker(account, EVERYWHERE, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'RevokerRemoved', {
            account: account.address,
            where: EVERYWHERE,
          });
        });

        it('reverts if the account is not a global revoker', async () => {
          await expect(authorizer.removeRevoker(account, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_REVOKER'
          );
        });

        it('reverts if the account is a revoker in a specific contract', async () => {
          await authorizer.addRevoker(account, WHERE_1, { from: root });
          await expect(authorizer.removeRevoker(account, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_REVOKER'
          );
        });

        it('preserves revoker status if it was received over both a specific contract and globally', async () => {
          await authorizer.addRevoker(account, WHERE_1, { from: root });
          await authorizer.addRevoker(account, EVERYWHERE, { from: root });

          expect(await authorizer.isRevoker(account, WHERE_1)).to.be.true;
          expect(await authorizer.isRevoker(account, EVERYWHERE)).to.be.true;

          await authorizer.removeRevoker(account, EVERYWHERE, { from: root });

          expect(await authorizer.isRevoker(account, WHERE_1)).to.be.true;
          expect(await authorizer.isRevoker(account, EVERYWHERE)).to.be.false;

          await authorizer.removeRevoker(account, WHERE_1, { from: root });

          expect(await authorizer.isRevoker(account, WHERE_1)).to.be.false;
          expect(await authorizer.isRevoker(account, EVERYWHERE)).to.be.false;
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.removeRevoker(root, EVERYWHERE, { from: root })).to.be.revertedWith(
            'CANNOT_REMOVE_ROOT_REVOKER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await authorizer.addRevoker(account, EVERYWHERE, { from: root });
          await expect(authorizer.removeRevoker(account, EVERYWHERE, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });
    });
  });

  describe('cancelers', () => {
    let executionId: number;
    let otherExecutionId: number;

    sharedBeforeEach('schedule actions', async () => {
      // It is only possible to create cancelers for specific scheduled execution ids if they exist, so we must
      // first schedule them.

      // The only action that is simple to schedule and execute on a clean system is setting a delay for the
      // `setAuthorizer`, since not having that delay prevents other delays from being set. We schedule two
      // calls to that function.

      const setAuthorizerAction = await actionId(vault.instance, 'setAuthorizer');
      executionId = await authorizer.scheduleDelayChange(setAuthorizerAction, DAY, [], { from: root });
      otherExecutionId = await authorizer.scheduleDelayChange(setAuthorizerAction, DAY, [], { from: root });
    });

    describe('addCanceler', () => {
      context('for a specific scheduled execution id', () => {
        it('root is a canceler', async () => {
          expect(await authorizer.isCanceler(executionId, root)).to.be.true;
        });

        it('can add canceler for a specific execution id', async () => {
          expect(await authorizer.isCanceler(executionId, canceler)).to.be.false;

          await authorizer.addCanceler(executionId, canceler, { from: root });

          expect(await authorizer.isCanceler(executionId, canceler)).to.be.true;
          // test that canceler has only a specific permission
          expect(await authorizer.isCanceler(otherExecutionId, canceler)).to.be.false;
        });

        it('emits an event', async () => {
          const receipt = await authorizer.addCanceler(executionId, canceler, { from: root });

          expectEvent.inReceipt(await receipt.wait(), 'CancelerAdded', { scheduledExecutionId: executionId });
        });

        it('cannot be added twice', async () => {
          await authorizer.addCanceler(executionId, canceler, { from: root });

          await expect(authorizer.addCanceler(executionId, canceler, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_CANCELER'
          );
        });

        it('reverts if the sender is not the root', async () => {
          await expect(authorizer.addCanceler(executionId, canceler, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });

        it('reverts if the scheduled execution does not exist', async () => {
          await expect(authorizer.addCanceler(42, canceler, { from: root })).to.be.revertedWith(
            'EXECUTION_DOES_NOT_EXIST'
          );
        });

        it('reverts if the scheduled execution was executed', async () => {
          await advanceTime(MONTH);
          await authorizer.execute(executionId);

          await expect(authorizer.addCanceler(executionId, canceler, { from: root })).to.be.revertedWith(
            'EXECUTION_IS_NOT_PENDING'
          );
        });

        it('reverts if the scheduled execution was canceled', async () => {
          await authorizer.cancel(executionId, { from: root });

          await expect(authorizer.addCanceler(executionId, canceler, { from: root })).to.be.revertedWith(
            'EXECUTION_IS_NOT_PENDING'
          );
        });
      });

      context('for any scheduled execution id', () => {
        it('root is a canceler', async () => {
          expect(await authorizer.isCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, root)).to.be.true;
        });

        it('cannot add root as a canceler', async () => {
          await expect(
            authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, root, { from: root })
          ).to.be.revertedWith('ACCOUNT_IS_ALREADY_CANCELER');
        });

        it('can add canceler for any execution id', async () => {
          await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });

          expect(await authorizer.isCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler)).to.be.true;
          // check that the canceler can cancel any action
          expect(await authorizer.isCanceler(executionId, canceler)).to.be.true;
          expect(await authorizer.isCanceler(otherExecutionId, canceler)).to.be.true;
        });

        it('emits an event', async () => {
          const receipt = await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, {
            from: root,
          });

          expectEvent.inReceipt(await receipt.wait(), 'CancelerAdded', {
            scheduledExecutionId: GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID,
          });
        });

        it('can add specific canceler and then a global', async () => {
          let receipt = await authorizer.addCanceler(executionId, canceler, { from: root });
          expectEvent.inReceipt(await receipt.wait(), 'CancelerAdded', {
            scheduledExecutionId: executionId,
          });
          receipt = await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });
          expectEvent.inReceipt(await receipt.wait(), 'CancelerAdded', {
            scheduledExecutionId: GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID,
          });

          expect(await authorizer.isCanceler(executionId, canceler)).to.be.true;
          expect(await authorizer.isCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler)).to.be.true;
        });

        it('cannot be added twice', async () => {
          await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });

          await expect(
            authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root })
          ).to.be.revertedWith('ACCOUNT_IS_ALREADY_CANCELER');
        });

        it('reverts if the sender is not the root', async () => {
          await expect(
            authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: other })
          ).to.be.revertedWith('SENDER_IS_NOT_ROOT');
        });
      });
    });

    describe('removeCanceler', () => {
      context('for a specific scheduled execution id', () => {
        it('can remove canceler for a specific execution id', async () => {
          await authorizer.addCanceler(executionId, canceler, { from: root });
          await authorizer.removeCanceler(executionId, canceler, { from: root });

          expect(await authorizer.isCanceler(executionId, canceler)).to.be.false;
        });

        it('emits an event', async () => {
          await authorizer.addCanceler(executionId, canceler, { from: root });
          const receipt = await authorizer.removeCanceler(executionId, canceler, { from: root });

          expectEvent.inReceipt(await receipt.wait(), 'CancelerRemoved', {
            scheduledExecutionId: executionId,
            canceler: canceler.address,
          });
        });

        it('cannot remove if not canceler', async () => {
          await expect(authorizer.removeCanceler(executionId, canceler, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_CANCELER'
          );
        });

        it('cannot remove root', async () => {
          await expect(authorizer.removeCanceler(executionId, root, { from: root })).to.be.revertedWith(
            'CANNOT_REMOVE_ROOT_CANCELER'
          );
        });

        it('cannot remove global canceler for a specific execution id', async () => {
          await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });
          await expect(authorizer.removeCanceler(executionId, canceler, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_GLOBAL_CANCELER'
          );
        });

        it('cannot be removed twice', async () => {
          await authorizer.addCanceler(executionId, canceler, { from: root });
          await authorizer.removeCanceler(executionId, canceler, { from: root });

          await expect(authorizer.removeCanceler(executionId, canceler, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_CANCELER'
          );
        });

        it('reverts if the sender is not the root', async () => {
          await expect(authorizer.removeCanceler(executionId, canceler, { from: canceler })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });

      context('for any scheduled execution id', () => {
        it('can remove canceler for any execution id', async () => {
          await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });

          await authorizer.removeCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });

          expect(await authorizer.isCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler)).to.be.false;
        });

        it('emits an event', async () => {
          await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });
          const receipt = await authorizer.removeCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, {
            from: root,
          });

          expectEvent.inReceipt(await receipt.wait(), 'CancelerRemoved', {
            scheduledExecutionId: GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID,
            canceler: canceler.address,
          });
        });

        it('cannot remove if not a canceler', async () => {
          await expect(
            authorizer.removeCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, other, { from: root })
          ).to.be.revertedWith('ACCOUNT_IS_NOT_CANCELER');
        });

        it('cannot remove the root', async () => {
          await expect(
            authorizer.removeCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, root, { from: root })
          ).to.be.revertedWith('CANNOT_REMOVE_ROOT_CANCELER');
        });

        it('cannot be removed twice', async () => {
          await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });
          await authorizer.removeCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });

          await expect(
            authorizer.removeCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root })
          ).to.be.revertedWith('ACCOUNT_IS_NOT_CANCELER');
        });

        it('can remove canceler for any execution id', async () => {
          await authorizer.addCanceler(executionId, canceler, { from: root });
          await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });

          expect(await authorizer.isCanceler(executionId, canceler)).to.be.true;
          expect(await authorizer.isCanceler(otherExecutionId, canceler)).to.be.true;

          await authorizer.removeCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });

          expect(await authorizer.isCanceler(executionId, canceler)).to.be.true;
          expect(await authorizer.isCanceler(otherExecutionId, canceler)).to.be.false;

          await authorizer.removeCanceler(executionId, canceler, { from: root });

          expect(await authorizer.isCanceler(executionId, canceler)).to.be.false;
          expect(await authorizer.isCanceler(otherExecutionId, canceler)).to.be.false;
        });

        it('reverts if the sender is not the root', async () => {
          await expect(
            authorizer.removeCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: canceler })
          ).to.be.revertedWith('SENDER_IS_NOT_ROOT');
        });
      });
    });
  });
});
