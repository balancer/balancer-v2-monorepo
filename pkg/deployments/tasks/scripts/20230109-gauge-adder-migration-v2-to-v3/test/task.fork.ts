import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { describeForkTest } from '../../../../src/forkTests';
import Task, { TaskMode } from '../../../../src/task';
import { getForkedNetwork } from '../../../../src/test';
import { impersonate } from '../../../../src/signers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describeForkTest('GaugeAdderMigrationCoordinator', 'mainnet', 16378450, function () {
  let govMultisig: SignerWithAddress;
  let coordinator: Contract;

  let vault: Contract, authorizer: Contract, authorizerAdaptor: Contract, gaugeController: Contract;

  let oldGaugeAdder: Contract;
  let newGaugeAdder: Contract;

  let task: Task;

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  before('run task', async () => {
    task = new Task('20230109-gauge-adder-migration-v2-to-v3', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    coordinator = await task.deployedInstance('GaugeAdderMigrationCoordinator');
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    const authorizerAdaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizerAdaptor = await authorizerAdaptorTask.deployedInstance('AuthorizerAdaptor');

    const oldGaugeAdderTask = new Task('20220628-gauge-adder-v2', TaskMode.READ_ONLY, getForkedNetwork(hre));
    oldGaugeAdder = await oldGaugeAdderTask.deployedInstance('GaugeAdder');

    const newGaugeAdderTask = new Task('20230109-gauge-adder-v3', TaskMode.READ_ONLY, getForkedNetwork(hre));
    newGaugeAdder = await newGaugeAdderTask.deployedInstance('GaugeAdder');

    const gaugeControllerTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    gaugeController = await gaugeControllerTask.deployedInstance('GaugeController');
  });

  before('grant permissions', async () => {
    govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    await authorizer.connect(govMultisig).grantRole(await authorizer.DEFAULT_ADMIN_ROLE(), coordinator.address);
  });

  it('performs first stage', async () => {
    await coordinator.performNextStage();
    expect(await coordinator.getCurrentStage()).to.equal(1);
  });

  it('gauge adder has the expected factories set up', async () => {
    const ETHEREUM_GAUGE_TYPE = 2;
    expect(await newGaugeAdder.getFactoryForGaugeTypeCount(ETHEREUM_GAUGE_TYPE)).to.equal(1);
    expect(await newGaugeAdder.getFactoryForGaugeType(ETHEREUM_GAUGE_TYPE, 0)).to.equal(
      task.input().LiquidityGaugeFactory
    );

    const POLYGON_GAUGE_TYPE = 3;
    expect(await newGaugeAdder.getFactoryForGaugeTypeCount(POLYGON_GAUGE_TYPE)).to.equal(1);
    expect(await newGaugeAdder.getFactoryForGaugeType(POLYGON_GAUGE_TYPE, 0)).to.equal(
      task.input().PolygonRootGaugeFactory
    );

    const ARBITRUM_GAUGE_TYPE = 4;
    expect(await newGaugeAdder.getFactoryForGaugeTypeCount(ARBITRUM_GAUGE_TYPE)).to.equal(1);
    expect(await newGaugeAdder.getFactoryForGaugeType(ARBITRUM_GAUGE_TYPE, 0)).to.equal(
      task.input().ArbitrumRootGaugeFactory
    );

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

  it('renounces the admin role', async () => {
    expect(await authorizer.hasRole(await authorizer.DEFAULT_ADMIN_ROLE(), coordinator.address)).to.equal(false);
  });
});
