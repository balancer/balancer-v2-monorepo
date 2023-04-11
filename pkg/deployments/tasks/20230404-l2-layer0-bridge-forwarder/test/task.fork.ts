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
import { randomAddress, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describeForkTest('L2Layer0BridgeForwarder', 'arbitrum', 70407500, function () {
  let vault: Contract, authorizer: Contract;
  let forwarder: Contract;
  let admin: SignerWithAddress, other: SignerWithAddress;
  let delegation: string;

  let task: Task;

  const GOV_MULTISIG = '0xaf23dc5983230e9eeaf93280e312e57539d098d0';

  before('run task', async () => {
    task = new Task('20230404-l2-layer0-bridge-forwarder', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    forwarder = await task.deployedInstance('L2LayerZeroBridgeForwarder');
  });

  before('setup accounts', async () => {
    [, admin, other] = await ethers.getSigners();
    delegation = randomAddress();
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());
  });

  before('grant set and kill delegation permissions to admin', async () => {
    const govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    await authorizer.connect(govMultisig).grantRole(await actionId(forwarder, 'setDelegation'), admin.address);
  });

  it('returns empty delegation', async () => {
    expect(await forwarder.getDelegationImplementation()).to.be.eq(ZERO_ADDRESS);
  });

  it('reverts if non-admin sets a new delegation', async () => {
    // SENDER_NOT_ALLOWED
    await expect(forwarder.connect(other).setDelegation(delegation)).to.be.revertedWith('BAL#401');
  });

  it('sets a new delegation', async () => {
    const tx = await forwarder.connect(admin).setDelegation(delegation);

    expectEvent.inReceipt(await tx.wait(), 'DelegationImplementationUpdated', {
      newImplementation: delegation,
    });

    expect(await forwarder.getDelegationImplementation()).to.be.eq(delegation);
  });
});
