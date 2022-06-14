import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { advanceToTimestamp, DAY } from '@balancer-labs/v2-helpers/src/time';

import Task, { TaskMode } from '../../../../src/task';
import { getForkedNetwork } from '../../../../src/test';
import { impersonate } from '../../../../src/signers';

describe('veBALDeploymentCoordinator', function () {
  let balMultisig: SignerWithAddress, govMultisig: SignerWithAddress;
  let coordinator: Contract, authorizer: Contract, BAL: Contract;

  const task = new Task('20220325-veBAL-deployment-coordinator', TaskMode.TEST, getForkedNetwork(hre));

  const BAL_TOKEN = '0xba100000625a3754423978a60c9317c58a424e3D';
  const BAL_MULTISIG = '0xCDcEBF1f28678eb4A1478403BA7f34C94F7dDBc5';
  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  before('run task', async () => {
    await task.run({ force: true });
    coordinator = await task.deployedInstance('veBALDeploymentCoordinator');
  });

  before('grant permissions', async () => {
    balMultisig = await impersonate(BAL_MULTISIG, fp(100));
    govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizer = await vaultTask.instanceAt('Authorizer', await coordinator.getAuthorizer());

    // We reuse this task as it contains an ABI similar to the one in the real BAL token
    const testBALTokenTask = new Task('20220325-test-balancer-token', TaskMode.READ_ONLY, getForkedNetwork(hre));
    BAL = await testBALTokenTask.instanceAt('TestBalancerToken', BAL_TOKEN);

    await authorizer
      .connect(govMultisig)
      .grantRole('0x0000000000000000000000000000000000000000000000000000000000000000', coordinator.address);
    await BAL.connect(balMultisig).grantRole(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      coordinator.address
    );
  });

  it('perform first stage', async () => {
    await advanceToTimestamp((await coordinator.getActivationScheduledTime()).add(1));
    await coordinator.performFirstStage();

    expect(await coordinator.getCurrentDeploymentStage()).to.equal(1);
  });

  it('perform second stage', async () => {
    await coordinator.performSecondStage();

    expect(await coordinator.getCurrentDeploymentStage()).to.equal(2);
  });

  it('perform third stage', async () => {
    await advanceToTimestamp((await coordinator.getActivationScheduledTime()).add(DAY * 10));
    await coordinator.performThirdStage();

    expect(await coordinator.getCurrentDeploymentStage()).to.equal(3);
  });
});
