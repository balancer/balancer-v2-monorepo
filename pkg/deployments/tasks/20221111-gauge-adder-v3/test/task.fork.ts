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

describeForkTest('GaugeAdderV3', 'mainnet', 15397200, function () {
  let admin: SignerWithAddress;
  let factory: Contract, gauge: Contract;
  let adaptorEntrypoint: Contract;
  let authorizer: Contract;
  let gaugeController: Contract;
  let gaugeAdder: Contract;
  let root: SignerWithAddress;

  let task: Task;

  const LM_MULTISIG = '0xc38c5f97b34e175ffd35407fc91a937300e33860';
  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';
  const LP_TOKEN = '0xbc5F4f9332d8415AAf31180Ab4661c9141CC84E4';

  const weightCap = fp(0.001);

  before('run task', async () => {
    // TODO: remove adaptor entrypoint related code; this will be fetched in the input script.
    const adaptorEntrypointTask = new Task(
      '20221111-authorizer-adaptor-entrypoint',
      TaskMode.TEST,
      getForkedNetwork(hre)
    );
    await adaptorEntrypointTask.run({ force: true });
    adaptorEntrypoint = await adaptorEntrypointTask.deployedInstance('AuthorizerAdaptorEntrypoint');

    const timelockTask = new Task('20221111-timelock-authorizer', TaskMode.TEST, getForkedNetwork(hre));
    await timelockTask.run({ force: true, extra: adaptorEntrypoint.address });
    authorizer = await timelockTask.deployedInstance('TimelockAuthorizer');
    root = await getSigner(await authorizer.getRoot());

    task = new Task('20221111-gauge-adder-v3', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true, extra: adaptorEntrypoint.address });
    gaugeAdder = await task.deployedInstance('GaugeAdder');
  });

  context('construction', () => {
    it('stores the entrypoint', async () => {
      expect(await gaugeAdder.getAuthorizerAdaptorEntrypoint()).to.equal(adaptorEntrypoint.address);
    });

    it('stores the gauge controller', async () => {
      const expectedGaugeController = await task.input().GaugeController;

      expect(await gaugeAdder.getGaugeController()).to.equal(expectedGaugeController);
    })
  });

  context('advanced functions', () => {
    before('load accounts', async () => {
      admin = await getSigner(0);
    });

    before('load gauge factory', async () => {
      const factoryTask = new Task('20220822-mainnet-gauge-factory-v2', TaskMode.READ_ONLY, getForkedNetwork(hre));
      factory = await factoryTask.deployedInstance('LiquidityGaugeFactory');
    });
  
    before('grant permissions', async () => {
      // We need to grant permission to the admin to add the LiquidityGaugeFactory to the GaugeAdder, and also to add
      // gauges from said factory to the GaugeController.
      const multisig = await impersonate(LM_MULTISIG, fp(100));
      
      //await authorizer.connect(root).grantPermissions([await actionId(gaugeAdder, 'addGaugeFactory(address,uint8)')], admin.address, [TimelockAuthorizer.EVERYWHERE]);
      //await authorizer.connect(root).grantPermissions([await actionId(gaugeAdder, 'addEthereumGauge(address)')], admin.address, [TimelockAuthorizer.EVERYWHERE]);
      
      await Promise.all(
        ['addGaugeFactory', 'addEthereumGauge'].map(
          async (method) =>
            await authorizer.connect(multisig).grantPermissions([await actionId(gaugeAdder, method)], admin.address, [TimelockAuthorizer.EVERYWHERE])
        )
      );
    });

    it('creates gauge', async () => {
      const tx = await factory.create(LP_TOKEN, weightCap);
      const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');
  
      gauge = await task.instanceAt('LiquidityGaugeV5', event.args.gauge);
      expect(await gauge.lp_token()).to.equal(LP_TOKEN);
  
      expect(await factory.isGaugeFromFactory(gauge.address)).to.be.true;
    });
  
    it('add gauge to gauge controller', async () => {
      await gaugeAdder.connect(admin).addGaugeFactory(factory.address, 2); // Ethereum is type 2.
      await gaugeAdder.connect(admin).addEthereumGauge(gauge.address);
  
      expect(await gaugeController.gauge_exists(gauge.address)).to.be.true;
    });
  });
});
