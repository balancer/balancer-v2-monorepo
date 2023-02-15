import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate } from '../../../src/signers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import TimelockAuthorizer from '@balancer-labs/v2-helpers/src/models/authorizer/TimelockAuthorizer';
import { advanceTime, DAY } from '@balancer-labs/v2-helpers/src/time';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describeForkTest('GaugeAdderV3', 'mainnet', 16370000, function () {
  let factory: Contract;
  let adaptorEntrypoint: Contract;
  let authorizer: Contract;
  let oldAuthorizer: Contract;
  let gaugeAdder: Contract;
  let daoMultisig: SignerWithAddress;
  let gaugeController: Contract;
  let migrator: Contract;
  let vault: Contract;

  let task: Task;

  const LM_MULTISIG = '0xc38c5f97b34e175ffd35407fc91a937300e33860';
  const LP_TOKEN = '0xbc5F4f9332d8415AAf31180Ab4661c9141CC84E4';
  const DAO_MULTISIG = '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f';

  const weightCap = fp(0.001);

  before('create timelock authorizer', async () => {
    const timelockTask = new Task('20221202-timelock-authorizer', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizer = await timelockTask.deployedInstance('TimelockAuthorizer');
    migrator = await timelockTask.deployedInstance('TimelockAuthorizerMigrator');

    const adaptorEntrypointTask = new Task('20221124-authorizer-adaptor-entrypoint', TaskMode.READ_ONLY, 'mainnet');
    adaptorEntrypoint = await adaptorEntrypointTask.deployedInstance('AuthorizerAdaptorEntrypoint');
  });

  before('change authorizer admin to the DAO multisig', async () => {
    await migrator.startRootTransfer();

    daoMultisig = await impersonate(DAO_MULTISIG, fp(100));
    await authorizer.connect(daoMultisig).claimRoot();

    const authorizerTask = new Task('20210418-authorizer', TaskMode.READ_ONLY, getForkedNetwork(hre));
    oldAuthorizer = await authorizerTask.deployedInstance('Authorizer');
    expect(await migrator.oldAuthorizer()).to.be.eq(oldAuthorizer.address);

    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');

    const setAuthorizerActionId = await actionId(vault, 'setAuthorizer');
    await oldAuthorizer.connect(daoMultisig).grantRolesToMany([setAuthorizerActionId], [migrator.address]);

    await migrator.finalizeMigration();
  });

  before('run Gauge Adder task', async () => {
    task = new Task('20230109-gauge-adder-v3', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    gaugeAdder = await task.deployedInstance('GaugeAdder');
  });

  context('construction', () => {
    it('stores the entrypoint', async () => {
      expect(await gaugeAdder.getAuthorizerAdaptorEntrypoint()).to.equal(adaptorEntrypoint.address);
    });

    it('stores the gauge controller', async () => {
      const gaugeControllerTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
      gaugeController = await gaugeControllerTask.deployedInstance('GaugeController');

      // Ensure we can call functions on the gaugeController
      const controllerAdmin = await gaugeController.admin();
      expect(controllerAdmin).to.not.equal(ZERO_ADDRESS);
      expect(await gaugeController.gauge_exists(ZERO_ADDRESS)).to.be.false;

      expect(await gaugeAdder.getGaugeController()).to.equal(gaugeController.address);
    });
  });

  context('advanced functions', () => {
    let lmMultisig: SignerWithAddress;
    let admin: SignerWithAddress;
    let gauge: Contract;

    before('load accounts', async () => {
      admin = await getSigner(0);
      lmMultisig = await impersonate(LM_MULTISIG, fp(100));
    });

    before('create gauge factory', async () => {
      const factoryTask = new Task('20220822-mainnet-gauge-factory-v2', TaskMode.TEST, getForkedNetwork(hre));
      await factoryTask.run({ force: true });
      factory = await factoryTask.deployedInstance('LiquidityGaugeFactory');

      expect(await factory.isGaugeFromFactory(ZERO_ADDRESS)).to.be.false;
    });

    // We need to grant permission to the admin to add the LiquidityGaugeFactory to the GaugeAdder, and also to add
    // gauges from said factory to the GaugeController.
    before('grant permissions', async () => {
      const addFactoryAction = await actionId(gaugeAdder, 'addGaugeFactory');
      const addGaugeAction = await actionId(gaugeAdder, 'addEthereumGauge');
      const gaugeControllerAddGaugeAction = await actionId(
        adaptorEntrypoint,
        'add_gauge(address,int128)',
        gaugeController.interface
      );

      await authorizer
        .connect(daoMultisig)
        .manageGranter(addFactoryAction, lmMultisig.address, TimelockAuthorizer.EVERYWHERE, true);
      await authorizer
        .connect(daoMultisig)
        .manageGranter(addGaugeAction, lmMultisig.address, TimelockAuthorizer.EVERYWHERE, true);
      await authorizer
        .connect(daoMultisig)
        .manageGranter(gaugeControllerAddGaugeAction, lmMultisig.address, TimelockAuthorizer.EVERYWHERE, true);

      let tx = await authorizer
        .connect(lmMultisig)
        .grantPermissions([addFactoryAction], admin.address, [TimelockAuthorizer.EVERYWHERE]);
      expectEvent.inReceipt(await tx.wait(), 'PermissionGranted', {
        actionId: addFactoryAction,
        account: admin.address,
        where: TimelockAuthorizer.EVERYWHERE,
      });

      tx = await authorizer
        .connect(lmMultisig)
        .grantPermissions([addGaugeAction], admin.address, [TimelockAuthorizer.EVERYWHERE]);
      expectEvent.inReceipt(await tx.wait(), 'PermissionGranted', {
        actionId: addGaugeAction,
        account: admin.address,
        where: TimelockAuthorizer.EVERYWHERE,
      });

      // Granting `GaugeController#add_gauge` permissions to the entrypoint has a delay, so the permission needs
      // to be scheduled and executed after the required time passes.
      tx = await authorizer
        .connect(lmMultisig)
        .scheduleGrantPermission(gaugeControllerAddGaugeAction, gaugeAdder.address, TimelockAuthorizer.EVERYWHERE, []);
      const event = expectEvent.inReceipt(await tx.wait(), 'ExecutionScheduled');
      const scheduledExecutionId = event.args.scheduledExecutionId;

      // The adder cannot add a gauge in the controller before the delay passes.
      expect(
        await authorizer.canPerform(gaugeControllerAddGaugeAction, gaugeAdder.address, TimelockAuthorizer.EVERYWHERE)
      ).to.be.false;

      await advanceTime(14 * DAY);
      await authorizer.connect(lmMultisig).execute(scheduledExecutionId);

      expect(await authorizer.canPerform(addFactoryAction, admin.address, TimelockAuthorizer.EVERYWHERE)).to.be.true;
      expect(await authorizer.canPerform(addGaugeAction, admin.address, TimelockAuthorizer.EVERYWHERE)).to.be.true;
      expect(
        await authorizer.canPerform(gaugeControllerAddGaugeAction, gaugeAdder.address, TimelockAuthorizer.EVERYWHERE)
      ).to.be.true;

      const entrypoint = await gaugeAdder.getAuthorizerAdaptorEntrypoint();
      const gaugeAdderAuthorizer = await adaptorEntrypoint.getAuthorizer();

      // Ensure the authorizer we just set the permissions on is the same one the gauge adder is using
      expect(entrypoint).to.equal(adaptorEntrypoint.address);
      expect(gaugeAdderAuthorizer).to.equal(authorizer.address);
    });

    it('can add factories for a gauge type', async () => {
      const tx = await gaugeAdder.connect(admin).addGaugeFactory(factory.address, 2); // Ethereum is type 2
      expectEvent.inReceipt(await tx.wait(), 'GaugeFactoryAdded', {
        gaugeType: 2,
        gaugeFactory: factory.address,
      });
    });

    it('can add gauge to controller', async () => {
      const tx = await factory.create(LP_TOKEN, weightCap);
      const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

      gauge = await task.instanceAt('LiquidityGaugeV5', event.args.gauge);

      await gaugeAdder.connect(admin).addEthereumGauge(gauge.address);

      expect(await gaugeController.gauge_exists(gauge.address)).to.be.true;
    });
  });
});
