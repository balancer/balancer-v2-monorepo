import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { impersonate } from '../../../src/signers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describeForkTest('ProtocolIdRegistry', 'mainnet', 16691900, function () {
  let vault: Contract, authorizer: Contract;
  let protocolIdRegistry: Contract;
  let admin: SignerWithAddress, other: SignerWithAddress;

  let task: Task;

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  before('run task', async () => {
    task = new Task('20230223-protocol-id-registry', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    protocolIdRegistry = await task.deployedInstance('ProtocolIdRegistry');
  });

  before('setup accounts', async () => {
    [, other, admin] = await ethers.getSigners();
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());
  });

  before('grant register and rename permissions to admin', async () => {
    const govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    await authorizer
      .connect(govMultisig)
      .grantRole(await actionId(protocolIdRegistry, 'registerProtocolId'), admin.address);
    await authorizer
      .connect(govMultisig)
      .grantRole(await actionId(protocolIdRegistry, 'renameProtocolId'), admin.address);
  });

  it('gets default protocol IDs', async () => {
    expect(await protocolIdRegistry.isValidProtocolId(0)).to.be.true;
    expect(await protocolIdRegistry.getProtocolName(0)).to.be.eq('Aave v1');

    expect(await protocolIdRegistry.isValidProtocolId(18)).to.be.true;
    expect(await protocolIdRegistry.getProtocolName(18)).to.be.eq('Agave');

    expect(await protocolIdRegistry.isValidProtocolId(19)).to.be.false;
  });

  it('reverts when adding or renaming protocol IDs without permission', async () => {
    await expect(protocolIdRegistry.connect(other).registerProtocolId(20, 'test')).to.be.revertedWith('BAL#401');
    await expect(protocolIdRegistry.connect(other).renameProtocolId(1, 'test')).to.be.revertedWith('BAL#401');
  });

  it('adds new protocols', async () => {
    await protocolIdRegistry.connect(admin).registerProtocolId(20, 'new protocol');

    expect(await protocolIdRegistry.isValidProtocolId(20)).to.be.true;
    expect(await protocolIdRegistry.getProtocolName(20)).to.be.eq('new protocol');
  });

  it('renames existing protocols', async () => {
    await protocolIdRegistry.connect(admin).renameProtocolId(20, 'new protocol V2');

    expect(await protocolIdRegistry.isValidProtocolId(20)).to.be.true;
    expect(await protocolIdRegistry.getProtocolName(20)).to.be.eq('new protocol V2');
  });
});
