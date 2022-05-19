import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { currentWeekTimestamp } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { impersonate } from '../../../src/signers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describe('FeeDistributorBALClaimer', function () {
  let authorizerAdaptor: Contract;
  let balTokenHolder: Contract;
  let feeDistributor: Contract;
  let feeDistributorBALClaimer: Contract;

  let BAL: Contract;

  const task = new Task('20220518-fee-distributor-BAL-claimer', TaskMode.TEST, getForkedNetwork(hre));

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';
  const BAL_ADDRESS = '0xba100000625a3754423978a60c9317c58a424e3D';

  const EXPECTED_GAUGE_EMISSIONS = BigNumber.from('14375600035874545749391');

  before('run task', async () => {
    await task.run({ force: true });
    feeDistributorBALClaimer = await task.instanceAt(
      'FeeDistributorBALClaimer',
      task.output({ network: 'test' }).FeeDistributorBALClaimer
    );
  });

  before('setup contracts', async () => {
    const authorizerAdaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizerAdaptor = await authorizerAdaptorTask.deployedInstance('AuthorizerAdaptor');

    const feeDistributorTask = new Task('20220420-fee-distributor', TaskMode.READ_ONLY, getForkedNetwork(hre));
    feeDistributor = await feeDistributorTask.deployedInstance('FeeDistributor');

    const balTokenHolderFactoryTask = new Task(
      '20220325-bal-token-holder-factory',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    );
    balTokenHolder = await balTokenHolderFactoryTask.instanceAt(
      'BALTokenHolder',
      await feeDistributorBALClaimer.getBALTokenHolder()
    );

    // We reuse this task as it contains an ABI similar to the one in real ERC20 tokens
    const testBALTokenTask = new Task('20220325-test-balancer-token', TaskMode.READ_ONLY, getForkedNetwork(hre));
    BAL = await testBALTokenTask.instanceAt('TestBalancerToken', BAL_ADDRESS);
  });

  before('grant permissions to feeDistributorBALClaimer', async () => {
    const govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    const vault = await vaultTask.deployedInstance('Vault');
    const authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    const singleRecipientGaugeFactoryTask = new Task(
      '20220325-single-recipient-gauge-factory',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    );
    const veBALGauge = await singleRecipientGaugeFactoryTask.instanceAt(
      'SingleRecipientGauge',
      feeDistributorBALClaimer.getGauge()
    );

    const checkpointRole = await actionId(authorizerAdaptor, 'checkpoint', veBALGauge.interface);
    const withdrawFundsRole = await actionId(balTokenHolder, 'withdrawFunds');
    await authorizer
      .connect(govMultisig)
      .grantRoles([checkpointRole, withdrawFundsRole], feeDistributorBALClaimer.address);
  });

  it('sends BAL to the FeeDistributor', async () => {
    const currentWeek = currentWeekTimestamp();

    const balToBeDistributedBefore = await feeDistributor.getTokensDistributedInWeek(BAL.address, currentWeek);
    const tx = await feeDistributorBALClaimer.distributeBAL();
    const balToBeDistributedAfter = await feeDistributor.getTokensDistributedInWeek(BAL.address, currentWeek);

    expect(balToBeDistributedAfter).to.be.eq(balToBeDistributedBefore.add(EXPECTED_GAUGE_EMISSIONS));

    expectEvent.inIndirectReceipt(
      await tx.wait(),
      feeDistributor.interface,
      'TokenCheckpointed',
      {
        token: BAL.address,
        amount: EXPECTED_GAUGE_EMISSIONS,
      },
      feeDistributor.address
    );
  });
});
