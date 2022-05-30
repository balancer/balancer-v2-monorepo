import hre from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { expect } from 'chai';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate } from '../../../src/signers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { range } from 'lodash';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { fromNow, MONTH } from '@balancer-labs/v2-helpers/src/time';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('PreseededVotingEscrowDelegation', function () {
  let oldDelegation: Contract;
  let receiver: SignerWithAddress;
  let delegation: Contract;

  const task = new Task('preseeded-voting-escrow-delegation', TaskMode.TEST, getForkedNetwork(hre));

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  before('run task', async () => {
    await task.run({ force: true });
    delegation = await task.deployedInstance('PreseededVotingEscrowDelegation');
  });

  before('setup signers', async () => {
    receiver = await getSigner(1);
  });

  it('proxy can be migrated to delegation', async () => {
    const delegationProxyTask = new Task('ve-delegation', TaskMode.READ_ONLY, getForkedNetwork(hre));

    const delegationProxy = await delegationProxyTask.deployedInstance('VotingEscrowDelegationProxy');
    oldDelegation = await delegationProxyTask.instanceAt(
      'VotingEscrowDelegation',
      await delegationProxy.getDelegationImplementation()
    );

    const authorizer = await new Task(
      '20210418-authorizer',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    ).deployedInstance('Authorizer');

    const govMultisig = await impersonate(GOV_MULTISIG, fp(100));
    await authorizer
      .connect(govMultisig)
      .grantRole(await actionId(delegationProxy, 'setDelegation'), govMultisig.address);

    await delegationProxy.connect(govMultisig).setDelegation(delegation.address);
  });

  it('preseeds boosts and approvals', async () => {
    const receipt = await (await delegation.preseed()).wait();

    for (const i in range(10)) {
      const boostCall = await delegation.preseeded_boost_calls(i);
      if (boostCall.delegator != ZERO_ADDRESS) {
        expectEvent.inReceipt(receipt, 'DelegateBoost', {
          _delegator: boostCall.delegator,
          _receiver: boostCall.receiver,
          _cancel_time: boostCall.cancel_time,
          _expire_time: boostCall.expire_time,
        });
      }

      const approvalCall = await delegation.preseeded_approval_calls(i);
      if (approvalCall.delegator != ZERO_ADDRESS) {
        expectEvent.inReceipt(receipt, 'ApprovalForAll', {
          _owner: approvalCall.delegator,
          _operator: approvalCall.operator,
          _approved: true,
        });
      }
    }
  });

  it('mints boosts for all accounts that had a boost', async () => {
    const oldTotalSupply = await oldDelegation.totalSupply();
    let cancelledTokens = 0;

    for (const i in range(oldTotalSupply)) {
      const id = await oldDelegation.tokenByIndex(i);

      // Any cancelled boosts will still show up in the token enumeration (as the token is not burned), but will have a
      // zero expiration time. We simply skip those, since cancelled boosts are not recreated in the preseeded contract.
      if (((await oldDelegation.token_expiry(id)) as BigNumber).isZero()) {
        cancelledTokens += 1;
        continue;
      }

      expect(await oldDelegation.ownerOf(id)).to.equal(await delegation.ownerOf(id));
      expect(await oldDelegation.token_expiry(id)).to.equal(await delegation.token_expiry(id));
      expect(await oldDelegation.token_cancel_time(id)).to.equal(await delegation.token_cancel_time(id));

      // Ideally we'd also check delegator and boost amount, but there's no easy way to get the delegator, and boost
      // amounts might not match if the delegator has locked more veBAL after the boost creation, resulting in the
      // preseeded delegation using that extra veBAL in the new boost.
    }

    expect(await delegation.totalSupply()).to.equal(oldTotalSupply.sub(cancelledTokens));
  });

  it('the Tribe operator can create boosts for the DAO', async () => {
    // From https://forum.balancer.fi/t/tribe-dao-boost-delegation/3218
    const TRIBE_DAO = '0xc4EAc760C2C631eE0b064E39888b89158ff808B2';
    const TRIBE_OPERATOR = '0x66977ce30049cd0e443216bf26377966c3a109e2';

    const operator = await impersonate(TRIBE_OPERATOR, fp(100));

    const receipt = await (
      await delegation.connect(operator).create_boost(TRIBE_DAO, receiver.address, 1000, 0, await fromNow(MONTH), 0)
    ).wait();

    expectEvent.inReceipt(receipt, 'DelegateBoost', {
      _delegator: TRIBE_DAO,
      _receiver: receiver.address,
    });
  });
});
