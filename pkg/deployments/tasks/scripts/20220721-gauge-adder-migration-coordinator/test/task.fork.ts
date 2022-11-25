import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { describeForkTest } from '../../../../src/forkTests';
import Task, { TaskMode } from '../../../../src/task';
import { getForkedNetwork } from '../../../../src/test';
import { impersonate } from '../../../../src/signers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describeForkTest('GaugeAdderMigrationCoordinator', 'mainnet', 15150000, function () {
  let govMultisig: SignerWithAddress;
  let coordinator: Contract;

  let vault: Contract, authorizer: Contract, authorizerAdaptor: Contract, gaugeController: Contract;

  let oldGaugeAdder: Contract;
  let newGaugeAdder: Contract;

  let arbitrumRootGaugeFactory: Contract;
  let optimismRootGaugeFactory: Contract;

  let task: Task;

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  before('run task', async () => {
    task = new Task('20220721-gauge-adder-migration-coordinator', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    coordinator = await task.deployedInstance('GaugeAdderMigrationCoordinator');
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    const authorizerAdaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizerAdaptor = await authorizerAdaptorTask.deployedInstance('AuthorizerAdaptor');

    const gaugeAdderTask = new Task('20220325-gauge-adder', TaskMode.READ_ONLY, getForkedNetwork(hre));
    oldGaugeAdder = await gaugeAdderTask.deployedInstance('GaugeAdder');

    const gaugeAdderV2Task = new Task('20220628-gauge-adder-v2', TaskMode.READ_ONLY, getForkedNetwork(hre));
    newGaugeAdder = await gaugeAdderV2Task.deployedInstance('GaugeAdder');

    const gaugeControllerTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    gaugeController = await gaugeControllerTask.deployedInstance('GaugeController');

    const arbitrumRootGaugeFactoryTask = new Task(
      '20220413-arbitrum-root-gauge-factory',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    );
    arbitrumRootGaugeFactory = await arbitrumRootGaugeFactoryTask.deployedInstance('ArbitrumRootGaugeFactory');

    const optimismRootGaugeFactoryTask = new Task(
      '20220628-optimism-root-gauge-factory',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    );
    optimismRootGaugeFactory = await optimismRootGaugeFactoryTask.deployedInstance('OptimismRootGaugeFactory');
  });

  before('grant permissions', async () => {
    govMultisig = await impersonate(GOV_MULTISIG);

    await authorizer.connect(govMultisig).grantRole(await authorizer.DEFAULT_ADMIN_ROLE(), coordinator.address);
  });

  it('performs first stage', async () => {
    await coordinator.performNextStage();
    expect(await coordinator.getCurrentStage()).to.equal(1);
  });

  it('adds the Optimism gauge type to the GaugeController', async () => {
    const OPTIMISM_GAUGE_TYPE = 5;

    expect(await gaugeController.gauge_type_names(OPTIMISM_GAUGE_TYPE)).to.equal('Optimism');
  });

  it('adds the Optimism root gauge factory to the gauge adder', async () => {
    const OPTIMISM_GAUGE_TYPE = 5;

    expect(await newGaugeAdder.getFactoryForGaugeTypeCount(OPTIMISM_GAUGE_TYPE)).to.equal(1);
    expect(await newGaugeAdder.getFactoryForGaugeType(OPTIMISM_GAUGE_TYPE, 0)).to.equal(
      task.input().OptimismRootGaugeFactory
    );
  });

  it('transfers the rights to add new gauges to the new GaugeAdder', async () => {
    const addGaugePermission = await authorizerAdaptor.getActionId(
      gaugeController.interface.getSighash('add_gauge(address,int128)')
    );

    expect(await authorizer.canPerform(addGaugePermission, oldGaugeAdder.address, authorizerAdaptor.address)).to.be
      .false;
    expect(await authorizer.canPerform(addGaugePermission, newGaugeAdder.address, authorizerAdaptor.address)).to.be
      .true;
  });

  it('grants permissions to the multisig to add gauges of existing types on the new GaugeAdder', async () => {
    const multisig = task.input().LiquidityMiningMultisig;

    const activeAddGaugeFunctions = [
      'addEthereumGauge(address)',
      'addPolygonGauge(address)',
      'addArbitrumGauge(address)',
      'addOptimismGauge(address)',
    ];
    for (const addGaugeFunction of activeAddGaugeFunctions) {
      const permission = await actionId(newGaugeAdder, addGaugeFunction);
      expect(await authorizer.canPerform(permission, multisig, newGaugeAdder.address)).to.be.true;
    }
  });

  it("doesn't grant permissions to add gauges for the gauge types which haven't been created yet.", async () => {
    const multisig = task.input().LiquidityMiningMultisig;

    const inactiveAddGaugeFunctions = ['addGnosisGauge(address)', 'addZKSyncGauge(address)'];
    for (const addGaugeFunction of inactiveAddGaugeFunctions) {
      const permission = await actionId(newGaugeAdder, addGaugeFunction);
      expect(await authorizer.canPerform(permission, multisig, newGaugeAdder.address)).to.be.false;
    }
  });

  it('grants permissions for checkpointing multisig to set the bridge parameters', async () => {
    const multisig = task.input().GaugeCheckpointingMultisig;

    const setArbitrumFeesAction = await actionId(
      arbitrumRootGaugeFactory,
      'setArbitrumFees(uint64 gasLimit,uint64 gasPrice,uint64 maxSubmissionCost)'
    );
    expect(await authorizer.canPerform(setArbitrumFeesAction, multisig, arbitrumRootGaugeFactory.address)).to.be.true;

    const setOptimismGasLimitAction = await actionId(optimismRootGaugeFactory, 'setOptimismGasLimit(uint32 gasLimit)');
    expect(await authorizer.canPerform(setOptimismGasLimitAction, multisig, optimismRootGaugeFactory.address)).to.be
      .true;
  });

  it('renounces the admin role', async () => {
    expect(await authorizer.hasRole(await authorizer.DEFAULT_ADMIN_ROLE(), coordinator.address)).to.equal(false);
  });
});
