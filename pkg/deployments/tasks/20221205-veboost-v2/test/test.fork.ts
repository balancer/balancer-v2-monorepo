import hre from 'hardhat';
import { Contract } from 'ethers';
import { expect } from 'chai';

import { ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';

import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import { describeForkTest, impersonate, getForkedNetwork, Task, TaskMode } from '../../../src';

describeForkTest('veBoostV2', 'mainnet', 16110000, function () {
  let oldDelegation: Contract;
  let delegation: Contract;

  let task: Task;

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  const existingBoosts: string[] = [
    '0x7f01d9b227593e033bf8d6fc86e634d27aa85568000000000000000000000000',
    '0xc2593e6a71130e7525ec3e64ba7795827086df0a000000000000000000000000',
    '0xef9a40f0ce782108233b6a5d8fef08c89b01a7bd000000000000000000000000',
    '0x0035fc5208ef989c28d47e552e92b0c507d2b318000000000000000000000000',
    '0xc4eac760c2c631ee0b064e39888b89158ff808b2000000000000000000005abf',
  ];

  before('run task', async () => {
    task = new Task('20221205-veboost-v2', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    delegation = await task.deployedInstance('VeBoostV2');

    oldDelegation = await new Task(
      '20220530-preseeded-voting-escrow-delegation',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    ).deployedInstance('PreseededVotingEscrowDelegation');
  });

  it('no unexpected boosts exist on old veBoost contract', async () => {
    const totalSupply = await oldDelegation.totalSupply();
    expect(existingBoosts.length).to.be.eq(totalSupply);
  });

  it('proxy can be migrated to delegation', async () => {
    const delegationProxy = await new Task(
      '20220325-ve-delegation',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    ).deployedInstance('VotingEscrowDelegationProxy');

    const authorizer = await new Task(
      '20210418-authorizer',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    ).deployedInstance('Authorizer');

    const govMultisig = await impersonate(GOV_MULTISIG);
    await authorizer
      .connect(govMultisig)
      .grantRole(await actionId(delegationProxy, 'setDelegation'), govMultisig.address);

    await delegationProxy.connect(govMultisig).setDelegation(delegation.address);

    expect(await delegationProxy.getDelegationImplementation()).to.be.eq(delegation.address);
  });

  it('allows existing boosts to be migrated', async () => {
    const migrateArgs = Array.from({ length: 16 }, (_, i) => existingBoosts[i] ?? ZERO_BYTES32);

    await delegation.migrate_many(migrateArgs);

    for (const tokenId of existingBoosts) {
      expect(await delegation.migrated(tokenId)).to.be.true;
    }
  });

  it('adjusted balances should be unchanged', async () => {
    for (const tokenId of existingBoosts) {
      const boostSender = tokenId.slice(0, 42);
      const preMigrationAdjustedBalanceSender = await oldDelegation.adjusted_balance_of(boostSender);
      const postMigrationAdjustedBalanceSender = await oldDelegation.adjusted_balance_of(boostSender);
      expect(postMigrationAdjustedBalanceSender).to.be.eq(preMigrationAdjustedBalanceSender);

      const boostReceiver = await oldDelegation.ownerOf(tokenId);
      const preMigrationAdjustedBalanceReceiver = await oldDelegation.adjusted_balance_of(boostReceiver);
      const postMigrationAdjustedBalanceReceiver = await oldDelegation.adjusted_balance_of(boostReceiver);

      expect(postMigrationAdjustedBalanceReceiver).to.be.eq(preMigrationAdjustedBalanceReceiver);

      // Assumes that senders and receivers are 1:1.
      const delegatedBalance = await delegation.delegated_balance(boostSender);
      const receivedBalance = await delegation.received_balance(boostReceiver);
      expect(delegatedBalance).to.be.gt(0);
      expect(delegatedBalance).to.be.eq(receivedBalance);
    }
  });
});
