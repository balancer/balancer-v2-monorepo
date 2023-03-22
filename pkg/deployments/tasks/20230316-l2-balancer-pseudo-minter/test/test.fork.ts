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
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describeForkTest('L2BalancerPseudoMinter', 'arbitrum', 70407500, function () {
  let vault: Contract, authorizer: Contract;
  let pseudoMinter: Contract;
  let admin: SignerWithAddress;

  let task: Task;

  const GOV_MULTISIG = '0xaf23dc5983230e9eeaf93280e312e57539d098d0';

  before('run task', async () => {
    task = new Task('20230316-l2-balancer-pseudo-minter', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    pseudoMinter = await task.deployedInstance('L2BalancerPseudoMinter');
  });

  before('setup accounts', async () => {
    [, admin] = await ethers.getSigners();
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());
  });

  before('grant register and rename permissions to admin', async () => {
    const govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    await authorizer.connect(govMultisig).grantRole(await actionId(pseudoMinter, 'addGaugeFactory'), admin.address);
    await authorizer.connect(govMultisig).grantRole(await actionId(pseudoMinter, 'removeGaugeFactory'), admin.address);
  });

  it('adds a gauge factory', async () => {
    const tx = await pseudoMinter.connect(admin).addGaugeFactory(ANY_ADDRESS);
    expectEvent.inReceipt(await tx.wait(), 'GaugeFactoryAdded', { factory: ANY_ADDRESS });
    expect(await pseudoMinter.isValidGaugeFactory(ANY_ADDRESS)).to.be.true;
  });

  it('remove a gauge factory', async () => {
    const tx = await pseudoMinter.connect(admin).removeGaugeFactory(ANY_ADDRESS);
    expectEvent.inReceipt(await tx.wait(), 'GaugeFactoryRemoved', { factory: ANY_ADDRESS });
    expect(await pseudoMinter.isValidGaugeFactory(ANY_ADDRESS)).to.be.false;
  });
});
