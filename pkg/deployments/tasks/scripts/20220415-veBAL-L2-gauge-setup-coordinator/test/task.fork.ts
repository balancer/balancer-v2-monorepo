import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Task, { TaskMode } from '../../../../src/task';
import { getForkedNetwork } from '../../../../src/test';
import { impersonate } from '../../../../src/signers';
import { advanceTime, WEEK } from '@balancer-labs/v2-helpers/src/time';

describe('veBALL2GaugeSetupCoordinator', function () {
  let govMultisig: SignerWithAddress, checkpointMultisig: SignerWithAddress;
  let coordinator: Contract;

  let vault: Contract,
    authorizer: Contract,
    authorizerAdaptor: Contract,
    gaugeController: Contract,
    polygonRootGaugeFactory: Contract,
    arbitrumRootGaugeFactory: Contract,
    gaugeAdder: Contract;

  const task = new Task('20220415-veBAL-L2-gauge-setup-coordinator', TaskMode.TEST, getForkedNetwork(hre));

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  before('run task', async () => {
    await task.run({ force: true });
    coordinator = await task.deployedInstance('veBALL2GaugeSetupCoordinator');
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.instanceAt('Vault', vaultTask.output({ network: 'mainnet' }).Vault);
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    const authorizerAdaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizerAdaptor = await authorizerAdaptorTask.instanceAt(
      'AuthorizerAdaptor',
      authorizerAdaptorTask.output({ network: 'mainnet' }).AuthorizerAdaptor
    );

    const gaugeAdderTask = new Task('20220325-gauge-adder', TaskMode.READ_ONLY, getForkedNetwork(hre));
    gaugeAdder = await gaugeAdderTask.instanceAt(
      'GaugeAdder',
      gaugeAdderTask.output({ network: 'mainnet' }).GaugeAdder
    );

    const gaugeControllerTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    gaugeController = await gaugeControllerTask.instanceAt(
      'GaugeController',
      gaugeControllerTask.output({ network: 'mainnet' }).GaugeController
    );

    const polygonRootGaugeFactoryTask = new Task(
      '20220413-polygon-root-gauge-factory',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    );
    polygonRootGaugeFactory = await polygonRootGaugeFactoryTask.instanceAt(
      'PolygonRootGaugeFactory',
      polygonRootGaugeFactoryTask.output({ network: 'mainnet' }).PolygonRootGaugeFactory
    );

    const arbitrumRootGaugeFactoryTask = new Task(
      '20220413-arbitrum-root-gauge-factory',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    );
    arbitrumRootGaugeFactory = await arbitrumRootGaugeFactoryTask.instanceAt(
      'ArbitrumRootGaugeFactory',
      arbitrumRootGaugeFactoryTask.output({ network: 'mainnet' }).ArbitrumRootGaugeFactory
    );
  });

  before('grant permissions', async () => {
    govMultisig = await impersonate(GOV_MULTISIG, fp(100));
    checkpointMultisig = await impersonate(await coordinator.GAUGE_CHECKPOINTER_MULTISIG(), fp(100));

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

  it('perform second stage', async () => {
    await coordinator.performSecondStage();
    expect(await coordinator.getCurrentDeploymentStage()).to.equal(2);
  });

  it('kills temporary SingleRecipient Polygon and Arbitrum gauges', async () => {
    const singleRecipientGaugeFactoryTask = new Task(
      '20220325-single-recipient-gauge-factory',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    );
    const gaugeFactory = await singleRecipientGaugeFactoryTask.instanceAt(
      'SingleRecipientGaugeFactory',
      singleRecipientGaugeFactoryTask.output({ network: 'mainnet' }).SingleRecipientGaugeFactory
    );

    const gauges = await Promise.all(
      ['0x9fb8312CEdFB9b35364FF06311B429a2f4Cdf422', '0x3F829a8303455CB36B7Bcf3D1bdc18D5F6946aeA'].map(
        async (gaugeAddress) => {
          expect(await gaugeFactory.isGaugeFromFactory(gaugeAddress)).to.equal(true);

          const gauge = await singleRecipientGaugeFactoryTask.instanceAt('SingleRecipientGauge', gaugeAddress);
          expect(await gauge.is_killed()).to.equal(true);

          return gauge;
        }
      )
    );

    const BALHolderFactoryTask = new Task(
      '20220325-bal-token-holder-factory',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    );
    expect(
      await (await BALHolderFactoryTask.instanceAt('BALTokenHolder', await gauges[0].getRecipient())).getName()
    ).to.equal('Temporary Polygon Liquidity Mining BAL Holder');
    expect(
      await (await BALHolderFactoryTask.instanceAt('BALTokenHolder', await gauges[1].getRecipient())).getName()
    ).to.equal('Temporary Arbitrum Liquidity Mining BAL Holder');
  });

  it('adds the Polygon root gauge factory to the gauge adder', async () => {
    const polygonRootGaugeFactoryTask = new Task(
      '20220413-polygon-root-gauge-factory',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    );

    const POLYGON_GAUGE_TYPE = 3;
    expect(await gaugeController.gauge_type_names(POLYGON_GAUGE_TYPE)).to.equal('Polygon');

    expect(await gaugeAdder.getFactoryForGaugeTypeCount(POLYGON_GAUGE_TYPE)).to.equal(1);
    expect(await gaugeAdder.getFactoryForGaugeType(POLYGON_GAUGE_TYPE, 0)).to.equal(
      polygonRootGaugeFactoryTask.output({ network: 'mainnet' }).PolygonRootGaugeFactory
    );
  });

  it('adds the Arbitrum root gauge factory to the gauge adder', async () => {
    const arbitrumRootGaugeFactoryTask = new Task(
      '20220413-arbitrum-root-gauge-factory',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    );

    const ARBITRUM_GAUGE_TYPE = 4;
    expect(await gaugeController.gauge_type_names(ARBITRUM_GAUGE_TYPE)).to.equal('Arbitrum');

    expect(await gaugeAdder.getFactoryForGaugeTypeCount(ARBITRUM_GAUGE_TYPE)).to.equal(1);
    expect(await gaugeAdder.getFactoryForGaugeType(ARBITRUM_GAUGE_TYPE, 0)).to.equal(
      arbitrumRootGaugeFactoryTask.output({ network: 'mainnet' }).ArbitrumRootGaugeFactory
    );
  });

  it('sets the multisig as the checkpointer of root gauges', async () => {
    const totalGauges = await gaugeController.n_gauges();
    // Arbitrum gauges are added before Polygon gauges, so the last gauge should be a Polygon one, and one of the
    // prior gauges should be an Arbitrum one.
    const polygonGaugeAddress = await gaugeController.gauges(totalGauges.sub(1));
    const arbitrumGaugeAddress = await gaugeController.gauges(totalGauges.sub(20));

    expect(await polygonRootGaugeFactory.isGaugeFromFactory(polygonGaugeAddress)).to.equal(true);
    expect(await arbitrumRootGaugeFactory.isGaugeFromFactory(arbitrumGaugeAddress)).to.equal(true);

    // A new epoch needs to begin for gauges to be checkpointable
    await advanceTime(WEEK);

    const gaugeInterface = new ethers.utils.Interface([
      'function checkpoint()',
      'event Checkpoint(uint256 indexed periodTime, uint256 periodEmissions)',
    ]);

    for (const gaugeAddress of [arbitrumGaugeAddress, polygonGaugeAddress]) {
      const tx = await authorizerAdaptor
        .connect(checkpointMultisig)
        .performAction(gaugeAddress, gaugeInterface.encodeFunctionData('checkpoint'));

      expectEvent.inIndirectReceipt(await tx.wait(), gaugeInterface, 'Checkpoint');
    }
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
