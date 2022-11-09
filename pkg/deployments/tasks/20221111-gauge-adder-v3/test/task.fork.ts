import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import {
  advanceTime,
  DAY,
} from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate } from '../../../src/signers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describeForkTest('GaugeAdderV3', 'mainnet', 15397200, function () {
  let veBALHolder: SignerWithAddress, admin: SignerWithAddress;
  let factory: Contract, gauge: Contract;
  let adaptorEntrypoint: Contract;
  let vault: Contract,
    authorizer: Contract,
    gaugeController: Contract,
    gaugeAdder: Contract;

  let task: Task;

  const VEBAL_HOLDER = '0xd519D5704B41511951C8CF9f65Fee9AB9beF2611';
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

    task = new Task('20221111-gauge-adder-v3', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true, extra: adaptorEntrypoint.address });
    gaugeAdder = await task.instanceAt(
      'GaugeAdder',
      task.output({ network: 'mainnet' }).GaugeAdder
    );
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
    before('load gauge factory', async () => {
      const factoryTask = new Task('20220822-mainnet-gauge-factory-v2', TaskMode.READ_ONLY, getForkedNetwork(hre));
      await factoryTask.run({ force: true });
      factory = await factoryTask.deployedInstance('LiquidityGaugeFactory');
    });
  
    before('advance time', async () => {
      // This causes all voting cooldowns to expire, letting the veBAL holder vote again
      await advanceTime(DAY * 12);
    });
  
    before('setup accounts', async () => {
      admin = await getSigner(0);
      veBALHolder = await impersonate(VEBAL_HOLDER, fp(100));
    });
  
    before('setup contracts', async () => {
      const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
      vault = await vaultTask.instanceAt('Vault', vaultTask.output({ network: 'mainnet' }).Vault);
      authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());
    });
  
    it('creates gauge', async () => {
      const tx = await factory.create(LP_TOKEN, weightCap);
      const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');
  
      gauge = await task.instanceAt('LiquidityGaugeV5', event.args.gauge);
      expect(await gauge.lp_token()).to.equal(LP_TOKEN);
  
      expect(await factory.isGaugeFromFactory(gauge.address)).to.be.true;
    });
  
    it('grant permissions', async () => {
      // We need to grant permission to the admin to add the LiquidityGaugeFactory to the GaugeAdder, and also to add
      // gauges from said factory to the GaugeController.
      const govMultisig = await impersonate(GOV_MULTISIG, fp(100));
  
      await Promise.all(
        ['addGaugeFactory', 'addEthereumGauge'].map(
          async (method) =>
            await authorizer.connect(govMultisig).grantRole(await actionId(gaugeAdder, method), admin.address)
        )
      );
    });
  
    it('add gauge to gauge controller', async () => {
      await gaugeAdder.connect(admin).addGaugeFactory(factory.address, 2); // Ethereum is type 2.
      await gaugeAdder.connect(admin).addEthereumGauge(gauge.address);
  
      expect(await gaugeController.gauge_exists(gauge.address)).to.be.true;
    });
  });
});
