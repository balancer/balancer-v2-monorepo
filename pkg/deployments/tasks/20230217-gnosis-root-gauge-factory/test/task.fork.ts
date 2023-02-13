import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { GaugeType } from '@balancer-labs/balancer-js/src/types';
import { BigNumber, fp, FP_ONE } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { advanceTime, currentTimestamp, currentWeekTimestamp, DAY, WEEK } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate } from '../../../src/signers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { range } from 'lodash';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { describeForkTest } from '../../../src/forkTests';

describeForkTest('GnosisRootGaugeFactory', 'mainnet', 16521970, function () {
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

  const VEBAL_HOLDER = '0x03de3132e3d448ce03ada2457f0bc779f18f553b';
  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  const weightCap = fp(0.001);

  before('run task', async () => {
    task = new Task('20230217-gnosis-root-gauge-factory', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    factory = await task.deployedInstance('GnosisRootGaugeFactory');
  });

  before('advance time', async () => {
    // This causes all voting cooldowns to expire, letting the veBAL holder vote again
    await advanceTime(DAY * 12);
  });

  before('setup accounts', async () => {
    admin = await getSigner(0);
    recipient = await getSigner(1);

    veBALHolder = await impersonate(VEBAL_HOLDER, fp(100));
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    const authorizerAdaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizerAdaptor = await authorizerAdaptorTask.deployedInstance('AuthorizerAdaptor');

    const gaugeAdderTask = new Task('20230109-gauge-adder-v3', TaskMode.READ_ONLY, getForkedNetwork(hre));
    gaugeAdder = await gaugeAdderTask.deployedInstance('GaugeAdder');

    const balancerTokenAdminTask = new Task('20220325-balancer-token-admin', TaskMode.READ_ONLY, getForkedNetwork(hre));
    BALTokenAdmin = await balancerTokenAdminTask.deployedInstance('BalancerTokenAdmin');

    BAL = await BALTokenAdmin.getBalancerToken();

    const gaugeControllerTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    gaugeController = await gaugeControllerTask.deployedInstance('GaugeController');
  });

  it('create gauge', async () => {
    const tx = await factory.create(recipient.address, weightCap);
    const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

    gauge = await task.instanceAt('GnosisRootGauge', event.args.gauge);

    expect(await factory.isGaugeFromFactory(gauge.address)).to.be.true;
    expect(await gauge.getRecipient()).to.equal(recipient.address);
  });

  it('grant permissions', async () => {
    // We need to grant permission to the admin to add the Optimism factory to the GaugeAdder, and also to then add
    // gauges from said factory to the GaugeController.
    const govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    const selectors = ['addGaugeFactory', 'addGnosisGauge'].map((method) => gaugeAdder.interface.getSighash(method));
    await Promise.all(
      selectors.map(
        async (selector) =>
          await authorizer.connect(govMultisig).grantRole(await gaugeAdder.getActionId(selector), admin.address)
      )
    );

    // We also need to grant permissions to mint in the gauges, which is done via the Authorizer Adaptor
    await authorizer
      .connect(govMultisig)
      .grantRole(await authorizerAdaptor.getActionId(gauge.interface.getSighash('checkpoint')), admin.address);

    // Currently we only have Gauge types defined up to Arbitrum. We need to add the Gnosis GaugeType to be able to add the factory
    // First grant permission to call add_type to the admin.
    await authorizer
      .connect(govMultisig)
      .grantRole(
        await authorizerAdaptor.getActionId(gaugeController.interface.getSighash('add_type(string,uint256)')),
        admin.address
      );

    await authorizer
      .connect(govMultisig)
      .grantRole(
        await authorizerAdaptor.getActionId(gaugeController.interface.getSighash('add_gauge(address,int128)')),
        admin.address
      );
  });

  it('add gauge factory', async () => {
    // Not actually using this, but leaving it in to document the process

    // Because the Vyper `add_type` function has a default argument, we need to access it using the full signature, in the Sighash for the
    // permission (above), and when actually calling it with arguments (below).
    await authorizerAdaptor
      .connect(admin)
      .performAction(
        gaugeController.address,
        gaugeController.interface.encodeFunctionData('add_type(string,uint256)', ['Gnosis', fp(0.7)])
      );

    await gaugeAdder.addGaugeFactory(factory.address, GaugeType.Gnosis);
  });

  it('add gauge to gauge controller', async () => {
    // Add gauge directly through the controller, since we can't use GaugeAdder V3 without the TimelockAuthorizer migration
    //await gaugeAdder.addGnosisGauge(gauge.address);

    await authorizerAdaptor
      .connect(admin)
      .performAction(
        gaugeController.address,
        gaugeController.interface.encodeFunctionData('add_gauge(address,int128)', [gauge.address, GaugeType.Gnosis])
      );

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
    //const gaugeRelativeWeight = await gaugeController['gauge_relative_weight(address)'](gauge.address);

    const calldata = gauge.interface.encodeFunctionData('checkpoint');

    // Even though the gauge has relative weight, it cannot mint yet as it needs for the epoch to finish
    const zeroMintTx = await authorizerAdaptor.connect(admin).performAction(gauge.address, calldata);
    expectEvent.inIndirectReceipt(await zeroMintTx.wait(), gauge.interface, 'Checkpoint', {
      periodTime: firstMintWeekTimestamp.sub(WEEK), // Process past week, which had zero votes
      periodEmissions: 0,
    });
    // No token transfers are performed if the emissions are zero, but we can't test for a lack of those

    await advanceTime(WEEK);

    // The gauge should now mint and send all minted tokens to the Gnosis bridge
    const mintTx = await authorizerAdaptor.connect(admin).performAction(gauge.address, calldata);
    const event = expectEvent.inIndirectReceipt(await mintTx.wait(), gauge.interface, 'Checkpoint', {
      periodTime: firstMintWeekTimestamp,
    });
    const actualEmissions = event.args.periodEmissions;

    // The amount of tokens minted should equal the weekly emissions rate times the relative weight of the gauge
    const weeklyRate = (await BALTokenAdmin.getInflationRate()).mul(WEEK);

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
      'event TokensBridgingInitiated(address indexed token, address indexed sender, uint256 value, bytes32 indexed messageId)',
    ]);

    expectEvent.inIndirectReceipt(await mintTx.wait(), bridgeInterface, 'TokensBridgingInitiated', {
      token: BAL,
      sender: gauge.address,
      value: actualEmissions,
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

    expectEqualWithError(transferEvent.args.value, expectedEmissions, 0.01);

    // And the gauge then deposits those in the predicate via the bridge mechanism
    const bridgeInterface = new ethers.utils.Interface([
      'event TokensBridgingInitiated(address indexed token, address indexed sender, uint256 value, bytes32 indexed messageId)',
    ]);

    const depositEvent = expectEvent.inIndirectReceipt(await tx.wait(), bridgeInterface, 'TokensBridgingInitiated', {
      token: BAL,
      sender: gauge.address,
    });

    expectEqualWithError(depositEvent.args.value, expectedEmissions, 0.01);
  });
});
