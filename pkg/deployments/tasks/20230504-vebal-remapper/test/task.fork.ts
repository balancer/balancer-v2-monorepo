import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ZERO_ADDRESS, randomAddress } from '@balancer-labs/v2-helpers/src/constants';

import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { impersonate } from '../../../src/signers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

describeForkTest('VotingEscrowRemapper', 'mainnet', 17182400, function () {
  let vault: Contract, authorizer: Contract;
  let veRemapper: Contract, veBAL: Contract, smartWalletChecker: Contract, omniVotingEscrow: Contract;
  let omniVotingEscrowAdaptor: Contract;
  let admin: SignerWithAddress, other: SignerWithAddress, manager: SignerWithAddress;
  let local: SignerWithAddress, disallowedAccount: SignerWithAddress;

  let task: Task;

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';
  const VEBAL_HOLDER = '0xd519D5704B41511951C8CF9f65Fee9AB9beF2611';

  const chainId = 42161;
  const remoteAccount = randomAddress();
  const otherRemoteAccount = randomAddress();

  before('run task', async () => {
    task = new Task('20230504-vebal-remapper', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    veRemapper = await task.deployedInstance('VotingEscrowRemapper');
    omniVotingEscrowAdaptor = await task.deployedInstance('OmniVotingEscrowAdaptor');
  });

  before('setup accounts', async () => {
    [, other, disallowedAccount, admin, manager] = await ethers.getSigners();
    local = await impersonate(VEBAL_HOLDER, fp(100));
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    const gaugeControllerTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    veBAL = await gaugeControllerTask.deployedInstance('VotingEscrow');

    const smartWalletCheckerTask = new Task('20220420-smart-wallet-checker', TaskMode.READ_ONLY, getForkedNetwork(hre));
    smartWalletChecker = await smartWalletCheckerTask.deployedInstance('SmartWalletChecker');
    omniVotingEscrow = await deploy('MockOmniVotingEscrow');
  });

  before('grant register and rename permissions to admin', async () => {
    const govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    await authorizer
      .connect(govMultisig)
      .grantRole(await actionId(veRemapper, 'setNetworkRemappingManager'), admin.address);
    await authorizer
      .connect(govMultisig)
      .grantRole(await actionId(omniVotingEscrowAdaptor, 'setOmniVotingEscrow'), admin.address);
    await authorizer
      .connect(govMultisig)
      .grantRole(await actionId(smartWalletChecker, 'allowlistAddress'), admin.address);
    await authorizer
      .connect(govMultisig)
      .grantRole(await actionId(smartWalletChecker, 'denylistAddress'), admin.address);
  });

  before('allowlist L1 account to be remapped in smart wallet checker', async () => {
    await smartWalletChecker.connect(admin).allowlistAddress(local.address);
  });

  before('set omni voting escrow', async () => {
    await omniVotingEscrowAdaptor.connect(admin).setOmniVotingEscrow(omniVotingEscrow.address);
  });

  it('gets total supply', async () => {
    expect(await veRemapper.getTotalSupplyPoint()).to.be.deep.eq(await veBAL.point_history(await veBAL.epoch()));
  });

  it('gets locked end for user', async () => {
    expect(await veRemapper.getLockedEnd(local.address)).to.be.eq(await veBAL.locked__end(local.address));
  });

  it('remaps allowed account', async () => {
    const tx = await veRemapper.connect(local).setNetworkRemapping(local.address, remoteAccount, chainId);
    expectEvent.inReceipt(await tx.wait(), 'AddressMappingUpdated', {
      localUser: local.address,
      remoteUser: remoteAccount,
      chainId,
    });

    expect(await veRemapper.getRemoteUser(local.address, chainId)).to.be.eq(remoteAccount);
    expect(await veRemapper.getLocalUser(remoteAccount, chainId)).to.be.eq(local.address);
  });

  it('remaps using an appointed remapper', async () => {
    await veRemapper.connect(admin).setNetworkRemappingManager(local.address, manager.address);
    const tx = await veRemapper.connect(manager).setNetworkRemapping(local.address, otherRemoteAccount, chainId);
    expectEvent.inReceipt(await tx.wait(), 'AddressMappingUpdated', {
      localUser: local.address,
      remoteUser: otherRemoteAccount,
      chainId,
    });

    expect(await veRemapper.getRemoteUser(local.address, chainId)).to.be.eq(otherRemoteAccount);
    expect(await veRemapper.getLocalUser(otherRemoteAccount, chainId)).to.be.eq(local.address);

    // Cleans previous entry.
    expect(await veRemapper.getLocalUser(remoteAccount, chainId)).to.be.eq(ZERO_ADDRESS);
  });

  it('reverts clearing the mapping of an allowed account', async () => {
    await expect(veRemapper.clearNetworkRemapping(local.address, chainId)).to.be.revertedWith(
      'localUser is still in good standing'
    );
  });

  it('clears remapping of deny-listed account', async () => {
    await smartWalletChecker.connect(admin).denylistAddress(local.address);
    const receipt = await (await veRemapper.clearNetworkRemapping(local.address, chainId)).wait();

    expectEvent.inReceipt(receipt, 'AddressMappingUpdated', {
      localUser: local.address,
      remoteUser: ZERO_ADDRESS,
      chainId,
    });
    expectEvent.inReceipt(receipt, 'RemoteAddressMappingCleared', { remoteUser: otherRemoteAccount, chainId });
  });

  it('reverts with disallowed account', async () => {
    await expect(
      veRemapper.connect(disallowedAccount).setNetworkRemapping(disallowedAccount.address, other.address, chainId)
    ).to.be.revertedWith('Only contracts which can hold veBAL can set up a mapping');
  });
});
