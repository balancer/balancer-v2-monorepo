import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Task, { TaskMode } from '../../../../src/task';
import { getForkedNetwork } from '../../../../src/test';
import { getSigner, impersonate } from '../../../../src/signers';

describe('SmartWalletCheckerCoordinator', function () {
  let govMultisig: SignerWithAddress, other: SignerWithAddress;
  let coordinator: Contract;

  let vault: Contract, authorizer: Contract, veBAL: Contract, smartWalletChecker: Contract;

  const task = new Task('20220421-smart-wallet-checker-coordinator', TaskMode.TEST, getForkedNetwork(hre));

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  before('run task', async () => {
    await task.run({ force: true });
    coordinator = await task.instanceAt(
      'SmartWalletCheckerCoordinator',
      task.output({ network: 'test' }).SmartWalletCheckerCoordinator
    );
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.instanceAt('Vault', vaultTask.output({ network: 'mainnet' }).Vault);
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    const veBALTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    veBAL = await veBALTask.instanceAt('VotingEscrow', veBALTask.output({ network: 'mainnet' }).VotingEscrow);

    const SmartWalletCheckerTask = new Task('20220420-smart-wallet-checker', TaskMode.READ_ONLY, getForkedNetwork(hre));
    smartWalletChecker = await SmartWalletCheckerTask.instanceAt(
      'SmartWalletChecker',
      SmartWalletCheckerTask.output({ network: 'mainnet' }).SmartWalletChecker
    );
  });

  before('grant permissions', async () => {
    govMultisig = await impersonate(GOV_MULTISIG, fp(100));
    other = await getSigner(1);

    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizer = await vaultTask.instanceAt('Authorizer', await coordinator.getAuthorizer());

    await authorizer
      .connect(govMultisig)
      .grantRole('0x0000000000000000000000000000000000000000000000000000000000000000', coordinator.address);
  });

  it('perform first stage', async () => {
    await coordinator.performFirstStage();
    expect(await coordinator.getCurrentDeploymentStage()).to.equal(1);
  });

  it('sets the smart wallet checker in veBAL', async () => {
    expect(await veBAL.smart_wallet_checker()).to.equal(smartWalletChecker.address);
  });

  it('authorizes the multisig to add contracts to the smart wallet checker', async () => {
    const tx = await smartWalletChecker.connect(govMultisig).allowlistAddress(other.address);
    expectEvent.inReceipt(await tx.wait(), 'ContractAddressAdded', { contractAddress: other.address });

    expect(await smartWalletChecker.check(other.address)).to.equal(true);
  });

  it('authorizes the multisig to remove contracts from the smart wallet checker', async () => {
    const tx = await smartWalletChecker.connect(govMultisig).denylistAddress(other.address);
    expectEvent.inReceipt(await tx.wait(), 'ContractAddressRemoved', { contractAddress: other.address });

    expect(await smartWalletChecker.check(other.address)).to.equal(false);
  });

  it('renounces the admin role', async () => {
    expect(
      await authorizer.hasRole(
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        coordinator.address
      )
    ).to.equal(false);
  });
});
