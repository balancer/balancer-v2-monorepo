import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { impersonate } from '../../../src/signers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

describeForkTest('L2VotingEscrowDelegationProxy', 'arbitrum', 70407500, function () {
  let vault: Contract, authorizer: Contract;
  let veProxy: Contract, nullVotingEscrow: Contract, veDelegation: Contract;
  let admin: SignerWithAddress, user1: SignerWithAddress, user2: SignerWithAddress;

  let task: Task;

  const GOV_MULTISIG = '0xaf23dc5983230e9eeaf93280e312e57539d098d0';

  const user1VeBal = fp(100);
  const user2VeBal = fp(200);

  before('run task', async () => {
    task = new Task('20230316-l2-ve-delegation-proxy', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    veProxy = await task.deployedInstance('VotingEscrowDelegationProxy');
    nullVotingEscrow = await task.deployedInstance('NullVotingEscrow');
  });

  before('setup accounts', async () => {
    [, admin, user1, user2] = await ethers.getSigners();
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());
  });

  before('setup mock VE delegation implementation', async () => {
    veDelegation = await deploy('MockVeDelegation');
    await veDelegation.mint(user1.address, user1VeBal);
    await veDelegation.mint(user2.address, user2VeBal);
  });

  before('grant set and kill delegation permissions to admin', async () => {
    const govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    await authorizer.connect(govMultisig).grantRole(await actionId(veProxy, 'setDelegation'), admin.address);
    await authorizer.connect(govMultisig).grantRole(await actionId(veProxy, 'killDelegation'), admin.address);
  });

  describe('getters', () => {
    it('returns null voting escrow', async () => {
      expect(await veProxy.getVotingEscrow()).to.be.eq(nullVotingEscrow.address);
    });

    it('returns empty default voting escrow delegation implementation', async () => {
      expect(await veProxy.getDelegationImplementation()).to.be.eq(ZERO_ADDRESS);
    });
  });

  it('returns 0 total supply', async () => {
    expect(await veProxy.totalSupply()).to.be.eq(0);
  });

  it('returns 0 balance for users', async () => {
    expect(await veProxy.adjusted_balance_of(user1.address)).to.be.eq(0);
    expect(await veProxy.adjusted_balance_of(user2.address)).to.be.eq(0);
  });

  it('sets a new delegation implementation', async () => {
    const tx = await veProxy.connect(admin).setDelegation(veDelegation.address);
    expectEvent.inReceipt(await tx.wait(), 'DelegationImplementationUpdated', {
      newImplementation: veDelegation.address,
    });
  });

  it('uses new delegation', async () => {
    expect(await veProxy.adjusted_balance_of(user1.address)).to.be.eq(user1VeBal);
    expect(await veProxy.adjusted_balance_of(user2.address)).to.be.eq(user2VeBal);

    expect(await veProxy.totalSupply()).to.be.eq(user1VeBal.add(user2VeBal));
  });

  it('kills delegation', async () => {
    const tx = await veProxy.connect(admin).killDelegation();
    expectEvent.inReceipt(await tx.wait(), 'DelegationImplementationUpdated', {
      newImplementation: ZERO_ADDRESS,
    });
  });

  it('returns 0 total supply again', async () => {
    expect(await veProxy.totalSupply()).to.be.eq(0);
  });

  it('returns 0 balance for users again', async () => {
    expect(await veProxy.adjusted_balance_of(user1.address)).to.be.eq(0);
    expect(await veProxy.adjusted_balance_of(user2.address)).to.be.eq(0);
  });
});
