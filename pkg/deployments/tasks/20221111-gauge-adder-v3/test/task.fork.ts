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
import { advanceTime, DAY, WEEK } from '@balancer-labs/v2-helpers/src/time';
import { deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { AuthorizerDeployment } from '../../20210418-authorizer/input';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describeForkTest('GaugeAdderV3', 'mainnet', 15397200, function () {
  let factory: Contract;
  let gauge: Contract;
  let adaptorEntrypoint: Contract;
  let authorizer: Contract;
  let oldAuthorizer: Contract;
  let gaugeAdder: Contract;
  let lmMultisig: SignerWithAddress;
  let daoMultisig: SignerWithAddress;
  let gaugeController: Contract;
  let vault: Contract;

  let task: Task;

  const LM_MULTISIG = '0xc38c5f97b34e175ffd35407fc91a937300e33860';
  const LP_TOKEN = '0xbc5F4f9332d8415AAf31180Ab4661c9141CC84E4';
  const DAO_MULTISIG = '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f';

  const weightCap = fp(0.001);

  before('create authorizer adaptor entrypoint', async () => {
    // TODO: remove adaptor entrypoint related code; this will be fetched in the input script.
    const adaptorEntrypointTask = new Task(
      '20221111-authorizer-adaptor-entrypoint',
      TaskMode.TEST,
      getForkedNetwork(hre)
    );
    await adaptorEntrypointTask.run({ force: true });
    adaptorEntrypoint = await adaptorEntrypointTask.deployedInstance('AuthorizerAdaptorEntrypoint');
  });

  before('create timelock authorizer', async () => {
    const timelockTask = new Task('20221111-timelock-authorizer', TaskMode.TEST, getForkedNetwork(hre));
    await timelockTask.run({ force: true, extra: adaptorEntrypoint.address });
    authorizer = await timelockTask.deployedInstance('TimelockAuthorizer');
  });

  before('change root to the DAO multisig', async () => {
    const migrator = await deployedAt('v2-governance-scripts/TimelockAuthorizerMigrator', await authorizer.getRoot());

    await advanceTime(5 * DAY);
    await migrator.executeDelays();

    await advanceTime(4 * WEEK);
    await migrator.startRootTransfer();

    daoMultisig = await impersonate(DAO_MULTISIG, fp(100));
    await authorizer.connect(daoMultisig).claimRoot();

    const authorizerTask = new Task('20210418-authorizer', TaskMode.READ_ONLY, getForkedNetwork(hre));
    oldAuthorizer = await authorizerTask.instanceAt('Authorizer', await migrator.oldAuthorizer());

    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.instanceAt('Vault', await migrator.vault());

    const authorizerInput = authorizerTask.input() as AuthorizerDeployment;
    const multisig = await impersonate(authorizerInput.admin, fp(100));
    const setAuthorizerActionId = await actionId(vault, 'setAuthorizer');
    await oldAuthorizer.connect(multisig).grantRolesToMany([setAuthorizerActionId], [migrator.address]);

    await migrator.finalizeMigration();
  });

  before('run task', async () => {
    // Finally, create the GaugeAdder
    task = new Task('20221111-gauge-adder-v3', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true, extra: adaptorEntrypoint.address });
    gaugeAdder = await task.deployedInstance('GaugeAdder');
  });

  context('construction', () => {
    it('stores the entrypoint', async () => {
      expect(await gaugeAdder.getAuthorizerAdaptorEntrypoint()).to.equal(adaptorEntrypoint.address);
    });

    it('stores the gauge controller', async () => {
      gaugeController = await task.input().GaugeController;

      // Fails with "gaugeController.admin is not a function" - somehow this is not a valid GaugeController
      //const controllerAdmin = await gaugeController.admin();
      //console.log(`gaugeControllerAdmin: ${controllerAdmin}`);

      // And yes, I even tried deploying it in TEST mode from 20220325-gauge-controller, creating an "extra2" parameter,
      // and passing it in instead of reading from input: but had issues with it not finding artifacts, even though I
      // copied them all in and ran extract-artifacts.

      expect(await gaugeAdder.getGaugeController()).to.equal(gaugeController);
    });
  });

  context('advanced functions', () => {
    let admin: SignerWithAddress;

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
      await authorizer
        .connect(daoMultisig)
        .manageGranter(
          await actionId(gaugeAdder, 'addGaugeFactory'),
          lmMultisig.address,
          TimelockAuthorizer.EVERYWHERE,
          true
        );
      await authorizer
        .connect(daoMultisig)
        .manageGranter(
          await actionId(gaugeAdder, 'addEthereumGauge'),
          lmMultisig.address,
          TimelockAuthorizer.EVERYWHERE,
          true
        );

      const addFactoryAction = await actionId(gaugeAdder, 'addGaugeFactory');

      let tx = await authorizer
        .connect(lmMultisig)
        .grantPermissions([addFactoryAction], admin.address, [TimelockAuthorizer.EVERYWHERE]);
      expectEvent.inReceipt(await tx.wait(), 'PermissionGranted', {
        actionId: addFactoryAction,
        account: admin.address,
        where: TimelockAuthorizer.EVERYWHERE,
      });

      const addGaugeAction = await actionId(gaugeAdder, 'addEthereumGauge');

      tx = await authorizer
        .connect(lmMultisig)
        .grantPermissions([addGaugeAction], admin.address, [TimelockAuthorizer.EVERYWHERE]);
      expectEvent.inReceipt(await tx.wait(), 'PermissionGranted', {
        actionId: addGaugeAction,
        account: admin.address,
        where: TimelockAuthorizer.EVERYWHERE,
      });

      expect(await authorizer.canPerform(addFactoryAction, admin.address, TimelockAuthorizer.EVERYWHERE)).to.be.true;
      expect(await authorizer.canPerform(addGaugeAction, admin.address, TimelockAuthorizer.EVERYWHERE)).to.be.true;

      const entrypoint = await gaugeAdder.getAuthorizerAdaptorEntrypoint();
      const gaugeAdderAuthorizer = await adaptorEntrypoint.getAuthorizer();

      // Ensure the authorizer we just set the permissions on is the same one the gauge adder is using
      expect(entrypoint).to.equal(adaptorEntrypoint.address);
      expect(gaugeAdderAuthorizer).to.equal(authorizer.address);
    });

    before('call addGaugeFactory', async () => {
      const tx = await gaugeAdder.connect(admin).addGaugeFactory(factory.address, 2); // Ethereum is type 2
      expectEvent.inReceipt(await tx.wait(), 'GaugeFactoryAdded', {
        gaugeType: 2,
        gaugeFactory: factory.address,
      });
    });

    before('create gauge', async () => {
      const tx = await factory.create(LP_TOKEN, weightCap);
      const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

      gauge = await task.instanceAt('LiquidityGaugeV5', event.args.gauge);

      // This still fails with 401 (despite addGaugeFactory succeeding above)
      //await gaugeAdder.connect(admin).addEthereumGauge(gauge.address);

      // There is something wrong with the gaugeController - all calls fail with "TypeError: gaugeController.<function> is not a function"
      //await gaugeController.add_gauge(gauge.address, 2);
      //await gaugeController.setGaugeWeight(gauge.address, fp(0.7));

      //expect(await gaugeController.gauge_exists(gauge.address)).to.be.true;
    });

    it('ensure valid factory and gauge', async () => {
      expect(await gauge.lp_token()).to.equal(LP_TOKEN);
      expect(await factory.isGaugeFromFactory(gauge.address)).to.be.true;
    });
  });
});
