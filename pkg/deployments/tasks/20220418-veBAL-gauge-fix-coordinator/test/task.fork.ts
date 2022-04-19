import hre from 'hardhat';
import { expect } from 'chai';
import { Contract, ContractReceipt } from 'ethers';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Task from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { impersonate } from '../../../src/signers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { range } from 'lodash';

describe('veBALGaugeFixCoordinator', function () {
  let govMultisig: SignerWithAddress;
  let coordinator: Contract;

  let authorizer: Contract, gaugeController: Contract, BAL: Contract;

  const task = Task.forTest('20220418-veBAL-gauge-fix-coordinator', getForkedNetwork(hre));

  const BAL_TOKEN = '0xba100000625a3754423978a60c9317c58a424e3D';

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  const VEBAL_BAL_TOKEN_HOLDER = '0x3C1d00181ff86fbac0c3C52991fBFD11f6491D70';
  const ARBITRUM_BAL_TOKEN_HOLDER = '0x0C925fcE89a22E36EbD9B3C6E0262234E853d2F6';
  const POLYGON_BAL_TOKEN_HOLDER = '0x98087bf6A5CA828a6E09391aCE674DBaBB6a4C56';

  const LMC_GAUGE_TYPE = 0;

  let executeReceipt: ContractReceipt;

  before('run task', async () => {
    await task.run({ force: true });
    coordinator = await task.instanceAt(
      'veBALGaugeFixCoordinator',
      task.output({ network: 'test' }).veBALGaugeFixCoordinator
    );
  });

  before('setup contracts', async () => {
    const gaugeControllerTask = Task.forTest('20220325-gauge-controller', getForkedNetwork(hre));
    gaugeController = await gaugeControllerTask.instanceAt(
      'GaugeController',
      gaugeControllerTask.output({ network: 'mainnet' }).GaugeController
    );

    // We reuse this task as it contains an ABI similar to the one in the real BAL token
    const testBALTokenTask = Task.forTest('20220325-test-balancer-token', getForkedNetwork(hre));
    BAL = await testBALTokenTask.instanceAt('TestBalancerToken', BAL_TOKEN);
  });

  before('grant permissions', async () => {
    govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    const vaultTask = Task.forTest('20210418-vault', getForkedNetwork(hre));
    authorizer = await vaultTask.instanceAt('Authorizer', await coordinator.getAuthorizer());

    await authorizer
      .connect(govMultisig)
      .grantRole('0x0000000000000000000000000000000000000000000000000000000000000000', coordinator.address);
  });

  it('perform first stage', async () => {
    executeReceipt = await (await coordinator.performFirstStage()).wait();
    expect(await coordinator.getCurrentDeploymentStage()).to.equal(1);
  });

  it('sets zero weight for the LMC gauge type', async () => {
    expect(await gaugeController.gauge_type_names(LMC_GAUGE_TYPE)).to.equal('Liquidity Mining Committee');
    expect(await gaugeController.get_type_weight(LMC_GAUGE_TYPE)).to.equal(0);
  });

  it('sets equal weights for all other gauge types', async () => {
    for (const type of range(0, await gaugeController.n_gauge_types())) {
      if (type == LMC_GAUGE_TYPE) continue;

      expect(await gaugeController.get_type_weight(type)).to.equal(1);
    }
  });

  it('kills LCM SingleRecipient gauge', async () => {
    const singleRecipientGaugeFactoryTask = Task.forTest(
      '20220325-single-recipient-gauge-factory',
      getForkedNetwork(hre)
    );
    const gaugeFactory = await singleRecipientGaugeFactoryTask.instanceAt(
      'SingleRecipientGaugeFactory',
      singleRecipientGaugeFactoryTask.output({ network: 'mainnet' }).SingleRecipientGaugeFactory
    );

    const gaugeAddress = '0x7AA5475b2eA29a9F4a1B9Cf1cB72512D1B4Ab75e';
    expect(await gaugeFactory.isGaugeFromFactory(gaugeAddress)).to.equal(true);

    const gauge = await singleRecipientGaugeFactoryTask.instanceAt('SingleRecipientGauge', gaugeAddress);

    const BALHolderFactoryTask = Task.forTest('20220325-bal-token-holder-factory', getForkedNetwork(hre));
    expect(
      await (await BALHolderFactoryTask.instanceAt('BALTokenHolder', await gauge.getRecipient())).getName()
    ).to.equal('Liquidity Mining Committee BAL Holder');

    expect(await gauge.is_killed()).to.equal(true);
  });

  it('mints BAL for veBAL holders', async () => {
    expectEvent.inIndirectReceipt(executeReceipt, BAL.interface, 'Transfer', {
      from: ZERO_ADDRESS,
      to: VEBAL_BAL_TOKEN_HOLDER,
      value: bn('14500e18').mul(2),
    });
  });

  it('mints BAL for Arbitrum LPs', async () => {
    expectEvent.inIndirectReceipt(executeReceipt, BAL.interface, 'Transfer', {
      from: ZERO_ADDRESS,
      to: ARBITRUM_BAL_TOKEN_HOLDER,
      value: bn('10150e18').mul(2),
    });
  });

  it('mints BAL for Polygon LPs', async () => {
    expectEvent.inIndirectReceipt(executeReceipt, BAL.interface, 'Transfer', {
      from: ZERO_ADDRESS,
      to: POLYGON_BAL_TOKEN_HOLDER,
      value: bn('24650e18').mul(2),
    });
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
