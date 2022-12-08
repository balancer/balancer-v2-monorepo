import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { range } from 'lodash';

import { BigNumber, fp, FP_ONE } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { advanceTime, currentTimestamp, currentWeekTimestamp, DAY, WEEK } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';

import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import { getSigner, impersonate, getForkedNetwork, Task, TaskMode, describeForkTest } from '../../../src';

describeForkTest('PolygonRootGaugeFactoryV2', 'mainnet', 15397200, function () {
  let veBALHolder: SignerWithAddress, admin: SignerWithAddress, recipient: SignerWithAddress;
  let factory: Contract, gauge: Contract;
  let vault: Contract,
    authorizer: Contract,
    authorizerAdaptor: Contract,
    BALTokenAdmin: Contract,
    gaugeController: Contract,
    gaugeAdder: Contract;
  let BAL: string;

  let task: Task;

  const VEBAL_HOLDER = '0xd519D5704B41511951C8CF9f65Fee9AB9beF2611';
  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  const weightCap = fp(0.001);

  before('run task', async () => {
    task = new Task('20220823-polygon-root-gauge-factory-v2', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    factory = await task.deployedInstance('PolygonRootGaugeFactory');
  });

  before('advance time', async () => {
    // This causes all voting cooldowns to expire, letting the veBAL holder vote again
    await advanceTime(DAY * 12);
  });

  before('setup accounts', async () => {
    admin = await getSigner(0);
    recipient = await getSigner(1);

    veBALHolder = await impersonate(VEBAL_HOLDER);
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

    const gaugeAdderTask = new Task('20220628-gauge-adder-v2', TaskMode.READ_ONLY, getForkedNetwork(hre));
    gaugeAdder = await gaugeAdderTask.instanceAt(
      'GaugeAdder',
      gaugeAdderTask.output({ network: 'mainnet' }).GaugeAdder
    );

    const balancerTokenAdminTask = new Task('20220325-balancer-token-admin', TaskMode.READ_ONLY, getForkedNetwork(hre));
    BALTokenAdmin = await balancerTokenAdminTask.instanceAt(
      'BalancerTokenAdmin',
      balancerTokenAdminTask.output({ network: 'mainnet' }).BalancerTokenAdmin
    );

    BAL = await BALTokenAdmin.getBalancerToken();

    const gaugeControllerTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    gaugeController = await gaugeControllerTask.instanceAt(
      'GaugeController',
      gaugeControllerTask.output({ network: 'mainnet' }).GaugeController
    );
  });

  it('create gauge', async () => {
    const tx = await factory.create(recipient.address, weightCap);
    const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

    gauge = await task.instanceAt('PolygonRootGauge', event.args.gauge);

    expect(await factory.isGaugeFromFactory(gauge.address)).to.be.true;
  });

  it('grant permissions', async () => {
    // We need to grant permission to the admin to add the Polygon factory to the GaugeAdder, and also to then add
    // gauges from said factory to the GaugeController.
    const govMultisig = await impersonate(GOV_MULTISIG);

    await Promise.all(
      ['addGaugeFactory', 'addPolygonGauge'].map(
        async (method) =>
          await authorizer.connect(govMultisig).grantRole(await actionId(gaugeAdder, method), admin.address)
      )
    );

    // We also need to grant permissions to mint in the gauges, which is done via the Authorizer Adaptor
    await authorizer
      .connect(govMultisig)
      .grantRole(await authorizerAdaptor.getActionId(gauge.interface.getSighash('checkpoint')), admin.address);
  });

  it('add gauge to gauge controller', async () => {
    await gaugeAdder.connect(admin).addGaugeFactory(factory.address, 3); // Polygon is Gauge Type 3
    await gaugeAdder.connect(admin).addPolygonGauge(gauge.address);

    expect(await gaugeController.gauge_exists(gauge.address)).to.be.true;
  });

  it('vote for gauge', async () => {
    expect(await gaugeController.get_gauge_weight(gauge.address)).to.equal(0);
    expect(await gauge.getCappedRelativeWeight(await currentTimestamp())).to.equal(0);

    await gaugeController.connect(veBALHolder).vote_for_gauge_weights(gauge.address, 10000); // Max voting power is 10k points

    // We now need to go through an epoch for the votes to be locked in
    await advanceTime(DAY * 8);

    await gaugeController.checkpoint();
    // Gauge weight is equal to the cap, and controller weight for the gauge is greater than the cap.
    expect(
      await gaugeController['gauge_relative_weight(address,uint256)'](gauge.address, await currentWeekTimestamp())
    ).to.be.gt(weightCap);
    expect(await gauge.getCappedRelativeWeight(await currentTimestamp())).to.equal(weightCap);
  });

  it('mint & bridge tokens', async () => {
    // The gauge has votes for this week, and it will mint the first batch of tokens. We store the current gauge
    // relative weight, as it will change as time goes by due to vote decay.
    const firstMintWeekTimestamp = await currentWeekTimestamp();

    const calldata = gauge.interface.encodeFunctionData('checkpoint');

    // Even though the gauge has relative weight, it cannot mint yet as it needs for the epoch to finish
    const zeroMintTx = await authorizerAdaptor.connect(admin).performAction(gauge.address, calldata);
    expectEvent.inIndirectReceipt(await zeroMintTx.wait(), gauge.interface, 'Checkpoint', {
      periodTime: firstMintWeekTimestamp.sub(WEEK), // Process past week, which had zero votes
      periodEmissions: 0,
    });
    // No token transfers are performed if the emissions are zero, but we can't test for a lack of those

    await advanceTime(WEEK);

    // The gauge should now mint and send all minted tokens to the Polygon bridge
    const mintTx = await authorizerAdaptor.connect(admin).performAction(gauge.address, calldata);
    const event = expectEvent.inIndirectReceipt(await mintTx.wait(), gauge.interface, 'Checkpoint', {
      periodTime: firstMintWeekTimestamp,
    });
    const actualEmissions = event.args.periodEmissions;

    // The amount of tokens minted should equal the weekly emissions rate times the relative weight of the gauge
    const weeklyRate = (await BALTokenAdmin.getInflationRate()).mul(WEEK);

    // Note that instead of the weight, we use the cap (since we expect for the weight to be larger than the cap)
    const expectedEmissions = weightCap.mul(weeklyRate).div(FP_ONE);
    expectEqualWithError(actualEmissions, expectedEmissions, 0.001);

    // Tokens are minted for the gauge
    expectTransferEvent(
      await mintTx.wait(),
      {
        from: ZERO_ADDRESS,
        to: gauge.address,
        value: actualEmissions,
      },
      BAL
    );

    // And the gauge then deposits those in the predicate via the bridge mechanism
    const bridgeInterface = new ethers.utils.Interface([
      'event LockedERC20(address indexed depositor, address indexed depositReceiver, address indexed rootToken, uint256 amount)',
    ]);

    expectEvent.inIndirectReceipt(await mintTx.wait(), bridgeInterface, 'LockedERC20', {
      depositor: gauge.address,
      depositReceiver: recipient.address,
      rootToken: BAL,
      amount: actualEmissions,
    });
  });

  it('mint multiple weeks', async () => {
    const numberOfWeeks = 5;
    await advanceTime(WEEK * numberOfWeeks);
    await gaugeController.checkpoint_gauge(gauge.address);

    const weekTimestamp = await currentWeekTimestamp();

    // We can query the relative weight of the gauge for each of the weeks that have passed
    const relativeWeights: BigNumber[] = await Promise.all(
      range(1, numberOfWeeks + 1).map(async (weekIndex) =>
        gaugeController['gauge_relative_weight(address,uint256)'](gauge.address, weekTimestamp.sub(WEEK * weekIndex))
      )
    );

    // We require that they're all above the cap for simplicity - this lets us use the cap as each week's weight (and
    // also tests cap behavior).
    for (const relativeWeight of relativeWeights) {
      expect(relativeWeight).to.be.gt(weightCap);
    }

    // The amount of tokens minted should equal the sum of the weekly emissions rate times the relative weight of the
    // gauge (this assumes we're not crossing an emissions rate epoch so that the inflation remains constant).
    const weeklyRate = (await BALTokenAdmin.getInflationRate()).mul(WEEK);
    // Note that instead of the weight, we use the cap (since we expect for the weight to be larger than the cap)
    const expectedEmissions = weightCap.mul(numberOfWeeks).mul(weeklyRate).div(FP_ONE);

    const calldata = gauge.interface.encodeFunctionData('checkpoint');
    const tx = await authorizerAdaptor.connect(admin).performAction(gauge.address, calldata);

    await Promise.all(
      range(1, numberOfWeeks + 1).map(async (weekIndex) =>
        expectEvent.inIndirectReceipt(await tx.wait(), gauge.interface, 'Checkpoint', {
          periodTime: weekTimestamp.sub(WEEK * weekIndex),
        })
      )
    );

    // Tokens are minted for the gauge
    const transferEvent = expectTransferEvent(
      await tx.wait(),
      {
        from: ZERO_ADDRESS,
        to: gauge.address,
      },
      BAL
    );

    expect(transferEvent.args.value).to.be.almostEqual(expectedEmissions);

    // And the gauge then deposits those in the predicate via the bridge mechanism
    const bridgeInterface = new ethers.utils.Interface([
      'event LockedERC20(address indexed depositor, address indexed depositReceiver, address indexed rootToken, uint256 amount)',
    ]);

    const depositEvent = expectEvent.inIndirectReceipt(await tx.wait(), bridgeInterface, 'LockedERC20', {
      depositor: gauge.address,
      depositReceiver: recipient.address,
      rootToken: BAL,
    });

    expect(depositEvent.args.amount).to.be.almostEqual(expectedEmissions);
  });
});
