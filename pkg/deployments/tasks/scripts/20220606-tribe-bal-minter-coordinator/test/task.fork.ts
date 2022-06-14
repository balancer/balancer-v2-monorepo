import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Task, { TaskMode } from '../../../../src/task';
import { getForkedNetwork } from '../../../../src/test';
import { impersonate } from '../../../../src/signers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('TribeBALMinterCoordinator', function () {
  let govMultisig: SignerWithAddress;
  let coordinator: Contract;

  let authorizer: Contract;
  let balToken: Contract;

  let mintRole: string;

  const task = new Task('20220606-tribe-bal-minter-coordinator', TaskMode.TEST, getForkedNetwork(hre));

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';
  const BAL = '0xba100000625a3754423978a60c9317c58a424e3D';

  const TRIBE_BAL_RECIPIENT = '0xc5bb8F0253776beC6FF450c2B40f092f7e7f5b57';
  const TRIBE_BAL_MINT_AMOUNT = '34343783425791862574551';

  before('run task', async () => {
    await task.run({ force: true });
    coordinator = await task.deployedInstance('TribeBALMinterCoordinator');
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    const vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    // We reuse this task as it contains an ABI similar to the one in real ERC20 tokens
    const testBALTokenTask = new Task('20220325-test-balancer-token', TaskMode.READ_ONLY, getForkedNetwork(hre));
    balToken = await testBALTokenTask.instanceAt('TestBalancerToken', BAL);
  });

  before('grant permissions', async () => {
    govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    const balancerTokenAdminTask = new Task('20220325-balancer-token-admin', TaskMode.READ_ONLY, getForkedNetwork(hre));
    const balancerTokenAdmin = await balancerTokenAdminTask.deployedInstance('BalancerTokenAdmin');

    // Gov approval for relayer
    mintRole = await actionId(balancerTokenAdmin, 'mint');
    await authorizer.connect(govMultisig).grantRoles([mintRole], coordinator.address);
  });

  it('mints BAL', async () => {
    const tx = await coordinator.performNextStage();

    expectEvent.inIndirectReceipt(
      await tx.wait(),
      balToken.interface,
      'Transfer',
      { from: ZERO_ADDRESS, to: TRIBE_BAL_RECIPIENT, value: TRIBE_BAL_MINT_AMOUNT },
      balToken.address
    );
  });

  it('renounces its permission to mint BAL', async () => {
    expect(await authorizer.hasRole(mintRole, coordinator.address)).to.be.false;
  });

  it('fails on future attempts to mint BAL', async () => {
    await expect(coordinator.performNextStage()).to.be.revertedWith('All stages completed');
  });
});
