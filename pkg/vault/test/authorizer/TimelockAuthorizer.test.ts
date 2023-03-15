import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TimelockAuthorizer from '@balancer-labs/v2-helpers/src/models/authorizer/TimelockAuthorizer';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { advanceTime, currentTimestamp, DAY } from '@balancer-labs/v2-helpers/src/time';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('TimelockAuthorizer', () => {
  let authorizer: TimelockAuthorizer, vault: Contract, authenticatedContract: Contract;
  let root: SignerWithAddress,
    nextRoot: SignerWithAddress,
    granter: SignerWithAddress,
    canceler: SignerWithAddress,
    revoker: SignerWithAddress,
    other: SignerWithAddress,
    from: SignerWithAddress;

  before('setup signers', async () => {
    [, root, nextRoot, granter, canceler, revoker, other] = await ethers.getSigners();
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

  describe('granters', () => {
    describe('addGranter', () => {
      context('in a specific contract', () => {
        it('root is already a granter', async () => {
          expect(await authorizer.isGranter(ACTION_1, root, WHERE_1)).to.be.true;
          expect(await authorizer.isGranter(ACTION_2, root, WHERE_1)).to.be.true;
        });

        it('account is granter for that action only in that contract', async () => {
          await authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root });

          expect(await authorizer.isGranter(ACTION_1, granter, WHERE_1)).to.be.true;
          expect(await authorizer.isGranter(ACTION_1, granter, WHERE_2)).to.be.false;
          expect(await authorizer.isGranter(ACTION_1, granter, EVERYWHERE)).to.be.false;
        });

        it('account is not granter for any other action anywhere', async () => {
          await authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root });

          expect(await authorizer.isGranter(ACTION_2, granter, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, granter, WHERE_2)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, granter, EVERYWHERE)).to.be.false;
        });

        it('emits a GranterAdded event', async () => {
          const receipt = await (await authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'GranterAdded', {
            actionId: ACTION_1,
            account: granter.address,
            where: WHERE_1,
          });
        });

        it('reverts if the account is already a granter', async () => {
          await authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root });
          await expect(authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_GRANTER'
          );
        });

        it('reverts if the account is already a global granter', async () => {
          await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root });
          await expect(authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_GRANTER'
          );
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.addGranter(ACTION_1, root, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_GRANTER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await expect(authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: other })).to.be.revertedWith(
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
          await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root });

          expect(await authorizer.isGranter(ACTION_1, granter, WHERE_1)).to.be.true;
          expect(await authorizer.isGranter(ACTION_1, granter, WHERE_2)).to.be.true;
          expect(await authorizer.isGranter(ACTION_1, granter, EVERYWHERE)).to.be.true;
        });

        it('account is not granter for any other action anywhere', async () => {
          await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root });

          expect(await authorizer.isGranter(ACTION_2, granter, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, granter, WHERE_2)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, granter, EVERYWHERE)).to.be.false;
        });

        it('emits a GranterAdded event', async () => {
          const receipt = await (await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'GranterAdded', {
            actionId: ACTION_1,
            account: granter.address,
            where: EVERYWHERE,
          });
        });

        it('does not revert if the account is already a granter in a specific contract', async () => {
          await authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root });

          const receipt = await (await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'GranterAdded', {
            actionId: ACTION_1,
            account: granter.address,
            where: EVERYWHERE,
          });
        });

        it('reverts if the account is already a global granter', async () => {
          await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root });
          await expect(authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_GRANTER'
          );
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.addGranter(ACTION_1, root, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_GRANTER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await expect(authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });
    });

    describe('removeGranter', () => {
      context('in a specific contract', () => {
        it('accoutn is not a granter for that action anywhere', async () => {
          await authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root });
          await authorizer.removeGranter(ACTION_1, granter, WHERE_1, { from: root });

          expect(await authorizer.isGranter(ACTION_1, granter, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_1, granter, WHERE_2)).to.be.false;
          expect(await authorizer.isGranter(ACTION_1, granter, EVERYWHERE)).to.be.false;
        });

        it('account is not a granter for any other action', async () => {
          await authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root });
          await authorizer.removeGranter(ACTION_1, granter, WHERE_1, { from: root });

          expect(await authorizer.isGranter(ACTION_2, granter, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, granter, WHERE_2)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, granter, EVERYWHERE)).to.be.false;
        });

        it('emits a GranterRemoved event', async () => {
          await authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root });

          const receipt = await (await authorizer.removeGranter(ACTION_1, granter, WHERE_1, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'GranterRemoved', {
            actionId: ACTION_1,
            account: granter.address,
            where: WHERE_1,
          });
        });

        it('reverts if the account is not a granter', async () => {
          await expect(authorizer.removeGranter(ACTION_1, granter, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_GRANTER'
          );
        });

        it('reverts if the account is a global granter', async () => {
          await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root });
          await expect(authorizer.removeGranter(ACTION_1, granter, WHERE_1, { from: root })).to.be.revertedWith(
            'GRANTER_IS_GLOBAL'
          );
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.removeGranter(ACTION_1, root, WHERE_1, { from: root })).to.be.revertedWith(
            'CANNOT_REMOVE_ROOT_GRANTER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root });
          await expect(authorizer.removeGranter(ACTION_1, granter, WHERE_1, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });

      context('in any contract', () => {
        it('account is not a granter for that action on any contract', async () => {
          await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root });
          await authorizer.removeGranter(ACTION_1, granter, EVERYWHERE, { from: root });

          expect(await authorizer.isGranter(ACTION_1, granter, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_1, granter, EVERYWHERE)).to.be.false;
        });

        it('account is not a granter for that any other action anywhere', async () => {
          await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root });
          await authorizer.removeGranter(ACTION_1, granter, EVERYWHERE, { from: root });

          expect(await authorizer.isGranter(ACTION_2, granter, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_2, granter, EVERYWHERE)).to.be.false;
        });

        it('emits a GranterRemoved event', async () => {
          await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root });

          const receipt = await (await authorizer.removeGranter(ACTION_1, granter, EVERYWHERE, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'GranterRemoved', {
            actionId: ACTION_1,
            account: granter.address,
            where: EVERYWHERE,
          });
        });

        it('reverts if the account is not a global granter', async () => {
          await expect(authorizer.removeGranter(ACTION_1, granter, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_GRANTER'
          );
        });

        it('reverts if the account is a granter in a specific contract', async () => {
          await authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root });
          await expect(authorizer.removeGranter(ACTION_1, granter, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_GRANTER'
          );
        });

        it('preserves granter status if account was granter over both a specific contract and globally', async () => {
          await authorizer.addGranter(ACTION_1, granter, WHERE_1, { from: root });
          await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root });

          expect(await authorizer.isGranter(ACTION_1, granter, WHERE_1)).to.be.true;
          expect(await authorizer.isGranter(ACTION_1, granter, EVERYWHERE)).to.be.true;

          await authorizer.removeGranter(ACTION_1, granter, EVERYWHERE, { from: root });

          expect(await authorizer.isGranter(ACTION_1, granter, WHERE_1)).to.be.true;
          expect(await authorizer.isGranter(ACTION_1, granter, EVERYWHERE)).to.be.false;

          await authorizer.removeGranter(ACTION_1, granter, WHERE_1, { from: root });

          expect(await authorizer.isGranter(ACTION_1, granter, WHERE_1)).to.be.false;
          expect(await authorizer.isGranter(ACTION_1, granter, EVERYWHERE)).to.be.false;
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.removeGranter(ACTION_1, root, EVERYWHERE, { from: root })).to.be.revertedWith(
            'CANNOT_REMOVE_ROOT_GRANTER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await authorizer.addGranter(ACTION_1, granter, EVERYWHERE, { from: root });
          await expect(authorizer.removeGranter(ACTION_1, granter, EVERYWHERE, { from: other })).to.be.revertedWith(
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
          await authorizer.addRevoker(revoker, WHERE_1, { from: root });

          expect(await authorizer.isRevoker(revoker, WHERE_1)).to.be.true;
          expect(await authorizer.isRevoker(revoker, WHERE_2)).to.be.false;
          expect(await authorizer.isRevoker(revoker, EVERYWHERE)).to.be.false;
        });

        it('emits a RevokerAdded event', async () => {
          const receipt = await (await authorizer.addRevoker(revoker, WHERE_1, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'RevokerAdded', {
            account: revoker.address,
            where: WHERE_1,
          });
        });

        it('reverts if account is already a revoker', async () => {
          await authorizer.addRevoker(revoker, WHERE_1, { from: root });
          await expect(authorizer.addRevoker(revoker, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_REVOKER'
          );
        });

        it('reverts if account is already a global revoker', async () => {
          await authorizer.addRevoker(revoker, EVERYWHERE, { from: root });
          await expect(authorizer.addRevoker(revoker, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_REVOKER'
          );
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.addRevoker(root, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_REVOKER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await expect(authorizer.addRevoker(revoker, WHERE_1, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });

      context('in any contract', () => {
        it('root is already a revoker', async () => {
          expect(await authorizer.isRevoker(root, EVERYWHERE)).to.be.true;
          expect(await authorizer.isRevoker(root, EVERYWHERE)).to.be.true;
        });

        it('account is a revoker in any contract', async () => {
          await authorizer.addRevoker(revoker, EVERYWHERE, { from: root });

          expect(await authorizer.isRevoker(revoker, WHERE_1)).to.be.true;
          expect(await authorizer.isRevoker(revoker, WHERE_2)).to.be.true;
          expect(await authorizer.isRevoker(revoker, EVERYWHERE)).to.be.true;
        });

        it('emits a RevokerAdded event', async () => {
          const receipt = await (await authorizer.addRevoker(revoker, EVERYWHERE, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'RevokerAdded', {
            account: revoker.address,
            where: EVERYWHERE,
          });
        });

        it('does not revert if account is already revoker in a specific contract', async () => {
          await authorizer.addRevoker(revoker, WHERE_1, { from: root });

          const receipt = await (await authorizer.addRevoker(revoker, EVERYWHERE, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'RevokerAdded', {
            account: revoker.address,
            where: EVERYWHERE,
          });
        });

        it('reverts if account already is a global revoker', async () => {
          await authorizer.addRevoker(revoker, EVERYWHERE, { from: root });
          await expect(authorizer.addRevoker(revoker, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_REVOKER'
          );
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.addRevoker(root, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_ALREADY_REVOKER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await expect(authorizer.addRevoker(revoker, EVERYWHERE, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });
    });

    describe('removeRevoker', () => {
      context('in a specific contract', () => {
        it('account is not a revoker anywhere', async () => {
          await authorizer.addRevoker(revoker, WHERE_1, { from: root });
          await authorizer.removeRevoker(revoker, WHERE_1, { from: root });

          expect(await authorizer.isRevoker(revoker, WHERE_1)).to.be.false;
          expect(await authorizer.isRevoker(revoker, WHERE_2)).to.be.false;
          expect(await authorizer.isRevoker(revoker, EVERYWHERE)).to.be.false;
        });

        it('emits a RevokerRemoved event', async () => {
          await authorizer.addRevoker(revoker, WHERE_1, { from: root });

          const receipt = await (await authorizer.removeRevoker(revoker, WHERE_1, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'RevokerRemoved', {
            account: revoker.address,
            where: WHERE_1,
          });
        });

        it('reverts if the account is not a revoker', async () => {
          await expect(authorizer.removeRevoker(revoker, WHERE_1, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_REVOKER'
          );
        });

        it('reverts if the account is a global revoker', async () => {
          await authorizer.addRevoker(revoker, EVERYWHERE, { from: root });
          await expect(authorizer.removeRevoker(revoker, WHERE_1, { from: root })).to.be.revertedWith(
            'REVOKER_IS_GLOBAL'
          );
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.removeRevoker(root, WHERE_1, { from: root })).to.be.revertedWith(
            'CANNOT_REMOVE_ROOT_REVOKER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await authorizer.addRevoker(revoker, WHERE_1, { from: root });
          await expect(authorizer.removeRevoker(revoker, WHERE_1, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });

      context('in any contract', () => {
        it('account is not a revoker for any contract', async () => {
          await authorizer.addRevoker(revoker, EVERYWHERE, { from: root });
          await authorizer.removeRevoker(revoker, EVERYWHERE, { from: root });

          expect(await authorizer.isRevoker(revoker, WHERE_1)).to.be.false;
          expect(await authorizer.isRevoker(revoker, EVERYWHERE)).to.be.false;
        });

        it('emits a RevokerRemoved event', async () => {
          await authorizer.addRevoker(revoker, EVERYWHERE, { from: root });

          const receipt = await (await authorizer.removeRevoker(revoker, EVERYWHERE, { from: root })).wait();
          expectEvent.inReceipt(receipt, 'RevokerRemoved', {
            account: revoker.address,
            where: EVERYWHERE,
          });
        });

        it('reverts if the account is not a global revoker', async () => {
          await expect(authorizer.removeRevoker(revoker, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_REVOKER'
          );
        });

        it('reverts if the account is a revoker in a specific contract', async () => {
          await authorizer.addRevoker(revoker, WHERE_1, { from: root });
          await expect(authorizer.removeRevoker(revoker, EVERYWHERE, { from: root })).to.be.revertedWith(
            'ACCOUNT_IS_NOT_REVOKER'
          );
        });

        it('preserves revoker status if it was received over both a specific contract and globally', async () => {
          await authorizer.addRevoker(revoker, WHERE_1, { from: root });
          await authorizer.addRevoker(revoker, EVERYWHERE, { from: root });

          expect(await authorizer.isRevoker(revoker, WHERE_1)).to.be.true;
          expect(await authorizer.isRevoker(revoker, EVERYWHERE)).to.be.true;

          await authorizer.removeRevoker(revoker, EVERYWHERE, { from: root });

          expect(await authorizer.isRevoker(revoker, WHERE_1)).to.be.true;
          expect(await authorizer.isRevoker(revoker, EVERYWHERE)).to.be.false;

          await authorizer.removeRevoker(revoker, WHERE_1, { from: root });

          expect(await authorizer.isRevoker(revoker, WHERE_1)).to.be.false;
          expect(await authorizer.isRevoker(revoker, EVERYWHERE)).to.be.false;
        });

        it('reverts if the account is root', async () => {
          await expect(authorizer.removeRevoker(root, EVERYWHERE, { from: root })).to.be.revertedWith(
            'CANNOT_REMOVE_ROOT_REVOKER'
          );
        });

        it('reverts if the caller is not root', async () => {
          await authorizer.addRevoker(revoker, EVERYWHERE, { from: root });
          await expect(authorizer.removeRevoker(revoker, EVERYWHERE, { from: other })).to.be.revertedWith(
            'SENDER_IS_NOT_ROOT'
          );
        });
      });
    });
  });

  describe('addCanceler', () => {
    context('when the sender is the root', () => {
      context('when adding canceler', () => {
        context('for a specific scheduled execution id', () => {
          const executionId = 0;
          const otherExecutionId = 1;

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
            expect(await authorizer.isCanceler(0, canceler)).to.be.true;
            expect(await authorizer.isCanceler(1, canceler)).to.be.true;
            expect(await authorizer.isCanceler(2, canceler)).to.be.true;
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
            let receipt = await authorizer.addCanceler(0, canceler, { from: root });
            expectEvent.inReceipt(await receipt.wait(), 'CancelerAdded', {
              scheduledExecutionId: 0,
            });
            receipt = await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });
            expectEvent.inReceipt(await receipt.wait(), 'CancelerAdded', {
              scheduledExecutionId: GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID,
            });

            expect(await authorizer.isCanceler(0, canceler)).to.be.true;
            expect(await authorizer.isCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler)).to.be.true;
          });

          it('cannot be added twice', async () => {
            await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });

            await expect(
              authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root })
            ).to.be.revertedWith('ACCOUNT_IS_ALREADY_CANCELER');
          });
        });
      });
    });

    context('when the sender is not the root', () => {
      it('reverts', async () => {
        await expect(authorizer.addCanceler(0, canceler, { from: other })).to.be.revertedWith('SENDER_IS_NOT_ROOT');
      });
    });
  });

  describe('removeCanceler', () => {
    context('when the sender is the root', () => {
      context('when removing canceler', () => {
        context('for a specific scheduled execution id', () => {
          it('can remove canceler for a specific execution id', async () => {
            await authorizer.addCanceler(0, canceler, { from: root });
            await authorizer.removeCanceler(0, canceler, { from: root });

            expect(await authorizer.isCanceler(0, canceler)).to.be.false;
          });

          it('emits an event', async () => {
            await authorizer.addCanceler(0, canceler, { from: root });
            const receipt = await authorizer.removeCanceler(0, canceler, { from: root });

            expectEvent.inReceipt(await receipt.wait(), 'CancelerRemoved', {
              scheduledExecutionId: 0,
              canceler: canceler.address,
            });
          });

          it('cannot remove if not canceler', async () => {
            await expect(authorizer.removeCanceler(0, canceler, { from: root })).to.be.revertedWith(
              'ACCOUNT_IS_NOT_CANCELER'
            );
          });

          it('cannot remove root', async () => {
            await expect(authorizer.removeCanceler(0, root, { from: root })).to.be.revertedWith(
              'CANNOT_REMOVE_ROOT_CANCELER'
            );
          });

          it('cannot remove global canceler for a specific execution id', async () => {
            await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });
            await expect(authorizer.removeCanceler(0, canceler, { from: root })).to.be.revertedWith(
              'ACCOUNT_IS_GLOBAL_CANCELER'
            );
          });

          it('cannot be removed twice', async () => {
            await authorizer.addCanceler(0, canceler, { from: root });
            await authorizer.removeCanceler(0, canceler, { from: root });

            await expect(authorizer.removeCanceler(0, canceler, { from: root })).to.be.revertedWith(
              'ACCOUNT_IS_NOT_CANCELER'
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
            await authorizer.addCanceler(0, canceler, { from: root });
            await authorizer.addCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });

            expect(await authorizer.isCanceler(0, canceler)).to.be.true;
            expect(await authorizer.isCanceler(1, canceler)).to.be.true;

            await authorizer.removeCanceler(GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, canceler, { from: root });

            expect(await authorizer.isCanceler(0, canceler)).to.be.true;
            expect(await authorizer.isCanceler(1, canceler)).to.be.false;

            await authorizer.removeCanceler(0, canceler, { from: root });

            expect(await authorizer.isCanceler(0, canceler)).to.be.false;
            expect(await authorizer.isCanceler(1, canceler)).to.be.false;
          });
        });
      });
    });

    context('when the sender is not the root', () => {
      it('reverts', async () => {
        await expect(authorizer.removeCanceler(0, canceler, { from: canceler })).to.be.revertedWith(
          'SENDER_IS_NOT_ROOT'
        );
      });
    });
  });

  describe('grantPermission', () => {
    context('when the sender is the root', () => {
      context('when the target does not have the permission granted', () => {
        context('when there is no delay set to grant permissions', () => {
          it('grants permission to perform the requested action for the requested contract', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.true;
          });

          it('does not grant permission to perform the requested action everywhere', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.false;
          });

          it('does not grant permission to perform the requested actions for other contracts', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, NOT_WHERE)).to.be.false;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root })).wait();

            expectEvent.inReceipt(receipt, 'PermissionGranted', {
              actionId: ACTION_1,
              account: granter.address,
              where: WHERE_1,
            });
          });
        });

        context('when there is a delay set to grant permissions', () => {
          const delay = DAY;

          sharedBeforeEach('set delay', async () => {
            const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
            await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, delay * 2, { from: root });
            await authorizer.scheduleAndExecuteGrantDelayChange(ACTION_1, delay, { from: root });
          });

          it('reverts', async () => {
            await expect(authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root })).to.be.revertedWith(
              'GRANT_MUST_BE_SCHEDULED'
            );
          });

          it('can schedule a grant permission', async () => {
            const id = await authorizer.scheduleGrantPermission(ACTION_1, granter, WHERE_1, [], { from: root });

            // should not be able to execute before delay
            await expect(authorizer.execute(id, { from: root })).to.be.revertedWith('ACTION_NOT_YET_EXECUTABLE');

            await advanceTime(delay);
            await authorizer.execute(id, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, granter, WHERE_2)).to.be.false;
          });
        });
      });

      context('when the target has the permission granted', () => {
        context('when the permission was granted for a contract', () => {
          sharedBeforeEach('grant a permission', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });
          });

          it('ignores the request and can still perform the action', async () => {
            await expect(authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root })).not.to.reverted;

            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.true;
          });

          it('does not grant the permission to perform the requested action everywhere', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.false;
          });

          it('does not grant the permission to perform the requested action for other contracts', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, NOT_WHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.false;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });
            expectEvent.notEmitted(await tx.wait(), 'PermissionGranted');
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grant the permission', async () => {
            await authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root });
          });

          it('grants the permission to perform the requested action for the requested contract', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.true;
          });

          it('still can perform the requested actions everywhere', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.true;
          });

          it('still can perform the requested actions for other contracts', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, NOT_WHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root })).wait();
            expectEvent.inReceipt(receipt, 'PermissionGranted', {
              actionId: ACTION_1,
              account: granter.address,
              where: WHERE_1,
            });
          });
        });
      });
    });

    context('when the sender is not the root', () => {
      it('reverts', async () => {
        await expect(authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: granter })).to.be.revertedWith(
          'SENDER_IS_NOT_GRANTER'
        );
      });
    });
  });

  describe('grantPermissionGlobally', () => {
    context('when the sender is the root', () => {
      context('when the target does not have the permission granted', () => {
        it('grants the permission to perform the requested action everywhere', async () => {
          await authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root });

          expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, granter, EVERYWHERE)).to.be.false;
        });

        it('grants permission to perform the requested action in any specific contract', async () => {
          await authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root });

          expect(await authorizer.canPerform(ACTION_1, granter, NOT_WHERE)).to.be.true;
          expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.true;
        });

        it('emits an event', async () => {
          const receipt = await (await authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root })).wait();

          expectEvent.inReceipt(receipt, 'PermissionGranted', {
            actionId: ACTION_1,
            account: granter.address,
            where: TimelockAuthorizer.EVERYWHERE,
          });
        });
      });

      context('when the target has the permission granted', () => {
        context('when the permission was granted for a contract', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });
          });

          it('grants permission to perform the requested action everywhere', async () => {
            await authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.true;
          });

          it('still can perform the requested action for the previously granted contracts', async () => {
            await authorizer.grantPermissionGlobally(ACTION_2, granter, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, granter, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, granter, WHERE_2)).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root })).wait();

            expectEvent.inReceipt(receipt, 'PermissionGranted', {
              actionId: ACTION_1,
              account: granter.address,
              where: TimelockAuthorizer.EVERYWHERE,
            });
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root });
          });

          it('ignores the request and can still perform the requested action everywhere', async () => {
            await expect(authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root })).not.to.be.reverted;

            expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.true;
          });

          it('ignores the request and can still perform the requested action in any specific contract', async () => {
            await expect(authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root })).not.to.be.reverted;

            expect(await authorizer.canPerform(ACTION_1, granter, NOT_WHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.true;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root });
            expectEvent.notEmitted(await tx.wait(), 'PermissionGrantedGlobally');
          });
        });
      });
    });

    context('when the sender is not the root', () => {
      it('reverts', async () => {
        await expect(authorizer.grantPermissionGlobally(ACTION_1, granter, { from: granter })).to.be.revertedWith(
          'SENDER_IS_NOT_GRANTER'
        );
      });
    });
  });

  describe('revokePermission', () => {
    context('when the sender is the root', () => {
      context('when the target does not have the permission granted', () => {
        it('ignores the request and cannot perform the requested action everywhere', async () => {
          await expect(authorizer.revokePermission(ACTION_1, granter, WHERE_1, { from: root })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, granter, EVERYWHERE)).to.be.false;
        });

        it('ignores the request and cannot perform the requested action in any specific contract', async () => {
          await expect(authorizer.revokePermission(ACTION_1, granter, WHERE_1, { from: root })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, granter, NOT_WHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.false;
        });

        it('does not emit an event', async () => {
          const tx = await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });
          expectEvent.notEmitted(await tx.wait(), 'PermissionRevoked');
        });
      });

      context('when the target has the permission granted', () => {
        context('when the permission was granted for a contract', () => {
          sharedBeforeEach('grants the permission', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });
          });

          context('when there is no delay set to revoke permissions', () => {
            it('revokes the requested permission for the requested contract', async () => {
              await authorizer.revokePermission(ACTION_1, granter, WHERE_1, { from: root });

              expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, granter, WHERE_1)).to.be.false;
              expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, granter, WHERE_2)).to.be.false;
            });

            it('still cannot perform the requested action everywhere', async () => {
              await authorizer.revokePermission(ACTION_1, granter, WHERE_1, { from: root });

              expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, granter, EVERYWHERE)).to.be.false;
            });

            it('emits an event', async () => {
              const receipt = await (
                await authorizer.revokePermission(ACTION_1, granter, WHERE_1, { from: root })
              ).wait();

              expectEvent.inReceipt(receipt, 'PermissionRevoked', {
                actionId: ACTION_1,
                account: granter.address,
                where: WHERE_1,
              });
            });
          });

          context('when there is a delay set to revoke permissions', () => {
            const delay = DAY;

            sharedBeforeEach('set delay', async () => {
              const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
              await authorizer.scheduleAndExecuteDelayChange(setAuthorizerAction, delay * 2, { from: root });
              await authorizer.scheduleAndExecuteRevokeDelayChange(ACTION_1, delay, { from: root });
              await authorizer.grantPermission(ACTION_1, granter, authenticatedContract, { from: root });
              await authorizer.grantPermission(ACTION_2, granter, authenticatedContract, { from: root });
            });

            it('reverts', async () => {
              await expect(authorizer.revokePermission(ACTION_1, granter, WHERE_1, { from: root })).to.be.revertedWith(
                'REVOKE_MUST_BE_SCHEDULED'
              );
            });

            it('can schedule a revoke permission', async () => {
              const id = await authorizer.scheduleRevokePermission(ACTION_1, granter, WHERE_1, [], { from: root });

              // should not be able to execute before delay
              await expect(authorizer.execute(id, { from: root })).to.be.revertedWith('ACTION_NOT_YET_EXECUTABLE');

              await advanceTime(delay);
              await authorizer.execute(id, { from: root });

              expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.false;
            });
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grants the permissions', async () => {
            await authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root });
          });

          it('still can perform the requested action for the requested contract', async () => {
            await authorizer.revokePermission(ACTION_1, granter, WHERE_1, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.true;
          });

          it('still can perform the requested action everywhere', async () => {
            await authorizer.revokePermission(ACTION_1, granter, WHERE_1, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.true;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });
            expectEvent.notEmitted(await tx.wait(), 'PermissionRevoked');
          });
        });
      });
    });

    context('when the sender is not the root', () => {
      it('reverts', async () => {
        await expect(authorizer.revokePermission(ACTION_1, granter, WHERE_1, { from: granter })).to.be.revertedWith(
          'SENDER_IS_NOT_REVOKER'
        );
      });
    });
  });

  describe('revokePermissionGlobally', () => {
    context('when the sender is the root', () => {
      context('when the sender does not have the permission granted', () => {
        it('ignores the request and cannot perform the requested action everywhere', async () => {
          await expect(authorizer.revokePermissionGlobally(ACTION_1, granter, { from: root })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, granter, EVERYWHERE)).to.be.false;
        });

        it('ignores the request and cannot perform the requested action in any specific contract', async () => {
          await expect(authorizer.revokePermissionGlobally(ACTION_1, granter, { from: root })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, granter, NOT_WHERE)).to.be.false;
        });

        it('does not emit an event', async () => {
          const tx = await authorizer.revokePermissionGlobally(ACTION_1, granter, { from: root });
          expectEvent.notEmitted(await tx.wait(), 'PermissionRevokedGlobally');
        });
      });

      context('when the account has the permission granted', () => {
        context('when the permission was granted for a contract', () => {
          sharedBeforeEach('grants the permission', async () => {
            await authorizer.grantPermission(ACTION_1, granter, WHERE_1, { from: root });
          });

          it('still cannot perform the requested action everywhere', async () => {
            await authorizer.revokePermissionGlobally(ACTION_1, granter, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, EVERYWHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, granter, EVERYWHERE)).to.be.false;
          });

          it('still can perform the requested action for the previously granted permissions', async () => {
            await authorizer.revokePermissionGlobally(ACTION_1, granter, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.true;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.revokePermissionGlobally(ACTION_1, granter, { from: root });
            expectEvent.notEmitted(await tx.wait(), 'PermissionRevokedGlobally');
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grants the permission', async () => {
            await authorizer.grantPermissionGlobally(ACTION_1, granter, { from: root });
          });

          it('revokes the requested global permission and cannot perform the requested action everywhere', async () => {
            await authorizer.revokePermissionGlobally(ACTION_1, granter, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_1)).to.be.false;
            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.false;
          });

          it('cannot perform the requested action in any specific contract', async () => {
            await authorizer.revokePermissionGlobally(ACTION_1, granter, { from: root });

            expect(await authorizer.canPerform(ACTION_1, granter, NOT_WHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_1, granter, WHERE_2)).to.be.false;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.revokePermissionGlobally(ACTION_1, granter, { from: root })).wait();

            expectEvent.inReceipt(receipt, 'PermissionRevoked', {
              actionId: ACTION_1,
              account: granter.address,
              where: TimelockAuthorizer.EVERYWHERE,
            });
          });
        });
      });
    });

    context('when the sender is not the root', () => {
      it('reverts', async () => {
        await expect(authorizer.revokePermissionGlobally(ACTION_1, granter, { from: granter })).to.be.revertedWith(
          'SENDER_IS_NOT_REVOKER'
        );
      });
    });
  });

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

      context('when the sender has the permission granted globally', () => {
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
    context('when the sender does not have the permission granted', () => {
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

      context('when the sender has the permission granted globally', () => {
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

  describe('cancel', () => {
    const delay = DAY;
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
      const data = authenticatedContract.interface.encodeFunctionData('protectedFunction', ['0x']);
      return authorizer.schedule(authenticatedContract, data, executors || [], { from: granter });
    };

    context('when the given id is valid', () => {
      let id: BigNumberish;

      function itCancelsTheScheduledAction() {
        context('when the action was not executed', () => {
          sharedBeforeEach('schedule execution', async () => {
            id = await schedule();
          });

          it('cancels the action', async () => {
            await authorizer.cancel(id, { from });

            const scheduledExecution = await authorizer.getScheduledExecution(id);
            expect(scheduledExecution.cancelled).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await authorizer.cancel(id, { from });

            expectEvent.inReceipt(await receipt.wait(), 'ExecutionCancelled', { scheduledExecutionId: id });
          });

          it('cannot be cancelled twice', async () => {
            await authorizer.cancel(id, { from });

            await expect(authorizer.cancel(id, { from })).to.be.revertedWith('ACTION_ALREADY_CANCELLED');
          });
        });

        context('when the action was executed', () => {
          sharedBeforeEach('schedule and execute action', async () => {
            id = await schedule();
            await advanceTime(delay);
            await authorizer.execute(id);
          });

          it('reverts', async () => {
            await expect(authorizer.cancel(id, { from })).to.be.revertedWith('ACTION_ALREADY_EXECUTED');
          });
        });
      }

      context('when the sender has permission for the requested action', () => {
        sharedBeforeEach('set sender', async () => {
          from = granter;
        });

        itCancelsTheScheduledAction();
      });

      context('when the sender is root', () => {
        sharedBeforeEach('set sender', async () => {
          from = root;
        });

        itCancelsTheScheduledAction();
      });

      context('when the sender does not have permission for the requested action', () => {
        sharedBeforeEach('set sender', async () => {
          from = other;
        });

        it('reverts', async () => {
          id = await schedule();

          await expect(authorizer.cancel(id, { from })).to.be.revertedWith('SENDER_IS_NOT_CANCELER');
        });
      });
    });

    context('when the given id is not valid', () => {
      it('reverts', async () => {
        await expect(authorizer.cancel(100)).to.be.revertedWith('ACTION_DOES_NOT_EXIST');
      });
    });
  });

  describe('setPendingRoot', () => {
    let ROOT_CHANGE_DELAY: BigNumberish;

    beforeEach('fetch root change delay', async () => {
      ROOT_CHANGE_DELAY = await authorizer.instance.getRootTransferDelay();
    });

    it('sets the nextRoot as the pending root during construction', async () => {
      expect(await authorizer.instance.getPendingRoot()).to.equal(nextRoot.address);
    });

    context('when the sender is the root', async () => {
      context('when trying to execute it directly', async () => {
        it('reverts', async () => {
          await expect(authorizer.instance.setPendingRoot(granter.address)).to.be.revertedWith('CAN_ONLY_BE_SCHEDULED');
        });
      });

      context('when trying to schedule a call', async () => {
        let newPendingRoot: SignerWithAddress;

        function itSetsThePendingRootCorrectly() {
          it('schedules a root change', async () => {
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
            const id = await authorizer.scheduleRootChange(newPendingRoot, [], { from: root });

            await expect(authorizer.execute(id)).to.be.revertedWith('ACTION_NOT_YET_EXECUTABLE');

            await advanceTime(ROOT_CHANGE_DELAY);
            await authorizer.execute(id);

            expect(await authorizer.isRoot(root)).to.be.true;
            expect(await authorizer.isPendingRoot(newPendingRoot)).to.be.true;
          });

          it('emits an event', async () => {
            const id = await authorizer.scheduleRootChange(newPendingRoot, [], { from: root });

            await advanceTime(ROOT_CHANGE_DELAY);
            const receipt = await authorizer.execute(id);
            expectEvent.inReceipt(await receipt.wait(), 'PendingRootSet', { pendingRoot: newPendingRoot.address });
          });
        }

        before('set desired pending root', () => {
          newPendingRoot = granter;
        });

        itSetsThePendingRootCorrectly();

        context('starting a new root transfer while pending root is set', () => {
          // We test this to ensure that executing an action which sets the pending root to an address which cannot
          // call `claimRoot` won't result in the Authorizer being unable to transfer root power to a different address.

          sharedBeforeEach('initiate a root transfer', async () => {
            const id = await authorizer.scheduleRootChange(granter, [], { from: root });
            await advanceTime(ROOT_CHANGE_DELAY);
            await authorizer.execute(id);
          });

          before('set desired pending root', () => {
            newPendingRoot = other;
          });

          itSetsThePendingRootCorrectly();
        });
      });
    });

    context('when the sender is not the root', async () => {
      it('reverts', async () => {
        await expect(authorizer.scheduleRootChange(granter, [], { from: granter })).to.be.revertedWith(
          'SENDER_IS_NOT_ROOT'
        );
      });
    });
  });

  describe('claimRoot', () => {
    let ROOT_CHANGE_DELAY: BigNumberish;

    beforeEach('fetch root change delay', async () => {
      ROOT_CHANGE_DELAY = await authorizer.instance.getRootTransferDelay();
    });

    sharedBeforeEach('initiate a root transfer', async () => {
      const id = await authorizer.scheduleRootChange(granter, [], { from: root });
      await advanceTime(ROOT_CHANGE_DELAY);
      await authorizer.execute(id);
    });

    context('when the sender is the pending root', async () => {
      it('transfers root powers from the current to the pending root', async () => {
        await authorizer.claimRoot({ from: granter });
        expect(await authorizer.isRoot(root)).to.be.false;
        expect(await authorizer.isRoot(granter)).to.be.true;
      });

      it('resets the pending root address to the zero address', async () => {
        await authorizer.claimRoot({ from: granter });
        expect(await authorizer.isPendingRoot(root)).to.be.false;
        expect(await authorizer.isPendingRoot(granter)).to.be.false;
        expect(await authorizer.isPendingRoot(ZERO_ADDRESS)).to.be.true;
      });

      it('emits an event', async () => {
        const receipt = await authorizer.claimRoot({ from: granter });
        expectEvent.inReceipt(await receipt.wait(), 'RootSet', { root: granter.address });
        expectEvent.inReceipt(await receipt.wait(), 'PendingRootSet', { pendingRoot: ZERO_ADDRESS });
      });
    });

    context('when the sender is not the pending root', async () => {
      it('reverts', async () => {
        await expect(authorizer.claimRoot({ from: other })).to.be.revertedWith('SENDER_IS_NOT_PENDING_ROOT');
      });
    });
  });
});
