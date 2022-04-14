import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp, FP_SCALING_FACTOR } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { advanceTime, currentWeekTimestamp, DAY, WEEK } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Task from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate } from '../../../src/signers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('ArbitrumRootGaugeFactory', function () {
  let veBALHolder: SignerWithAddress, admin: SignerWithAddress, recipient: SignerWithAddress;
  let factory: Contract, gauge: Contract;
  let vault: Contract,
    authorizer: Contract,
    authorizerAdaptor: Contract,
    BAL: Contract,
    BALTokenAdmin: Contract,
    gaugeController: Contract,
    gaugeAdder: Contract;

  const task = Task.forTest('20220413-arbitrum-root-gauge-factory', getForkedNetwork(hre));

  const VEBAL_HOLDER = '0xCB3593C7c0dFe13129Ff2B6add9bA402f76c797e';
  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  before('run task', async () => {
    await task.run({ force: true });
    factory = await task.deployedInstance('ArbitrumRootGaugeFactory');
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
    const vaultTask = Task.forTest('20210418-vault', getForkedNetwork(hre));
    vault = await vaultTask.instanceAt('Vault', '0xBA12222222228d8Ba445958a75a0704d566BF2C8'); // vaultTask.output({ network: 'mainnet' }).Vault
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    const authorizerAdaptorTask = Task.forTest('20220325-authorizer-adaptor', getForkedNetwork(hre));
    authorizerAdaptor = await authorizerAdaptorTask.instanceAt(
      'AuthorizerAdaptor',
      '0x8f42adbba1b16eaae3bb5754915e0d06059add75' // authorizerAdaptorTask.output({ network: 'mainnet' }).AuthorizerAdaptor
    );

    const gaugeAdderTask = Task.forTest('20220325-gauge-adder', getForkedNetwork(hre));
    gaugeAdder = await gaugeAdderTask.instanceAt(
      'GaugeAdder',
      '0xEd5ba579bB5D516263ff6E1C10fcAc1040075Fe2' // gaugeAdderTask.output({ network: 'mainnet' }).GaugeAdder
    );

    const balancerTokenAdminTask = Task.forTest('20220325-balancer-token-admin', getForkedNetwork(hre));
    BALTokenAdmin = await balancerTokenAdminTask.instanceAt(
      'BalancerTokenAdmin',
      '0xf302f9F50958c5593770FDf4d4812309fF77414f' // balancerTokenAdminTask.output({ network: 'mainnet' }).BalancerTokenAdmin
    );

    // We reuse this task as it contains an ABI similar to the one in the real BAL token
    const testBALTokenTask = Task.forTest('20220325-test-balancer-token', getForkedNetwork(hre));
    BAL = await testBALTokenTask.instanceAt('TestBalancerToken', await BALTokenAdmin.getBalancerToken());

    const gaugeControllerTask = Task.forTest('20220325-gauge-controller', getForkedNetwork(hre));
    gaugeController = await gaugeControllerTask.instanceAt(
      'GaugeController',
      '0xC128468b7Ce63eA702C1f104D55A2566b13D3ABD' // gaugeControllerTask.output({ network: 'mainnet' }).GaugeController
    );
  });

  it('create gauge', async () => {
    const tx = await factory.create(recipient.address);
    const event = expectEvent.inReceipt(await tx.wait(), 'ArbitrumRootGaugeCreated');

    gauge = await task.instanceAt('ArbitrumRootGauge', event.args.gauge);
    expect(event.args.recipient).to.equal(recipient.address);

    expect(await factory.isGaugeFromFactory(gauge.address)).to.be.true;
    expect(await factory.getRecipientGauge(recipient.address)).to.equal(gauge.address);
    expect(await factory.getGaugeRecipient(gauge.address)).to.equal(recipient.address);
  });

  it('grant permissions', async () => {
    // We need to grant permission to the admin to add the Arbitrum factory to the GaugeAdder, and also to then add
    // gauges from said factory to the GaugeController.
    const govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    const selectors = ['addGaugeFactory', 'addArbitrumGauge'].map((method) => gaugeAdder.interface.getSighash(method));
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
  });

  it('add gauge to gauge controller', async () => {
    await gaugeAdder.addGaugeFactory(factory.address, 4); // Arbitrum is Gauge Type 4
    await gaugeAdder.addArbitrumGauge(gauge.address);

    expect(await gaugeController.gauge_exists(gauge.address)).to.be.true;
  });

  it('vote for gauge', async () => {
    expect(await gaugeController.get_gauge_weight(gauge.address)).to.equal(0);
    await gaugeController.connect(veBALHolder).vote_for_gauge_weights(gauge.address, 10000); // Max voting power is 10k points

    // We now need to go through an epoch for the votes to be locked in
    await advanceTime(DAY * 8);

    await gaugeController.checkpoint();
    expect(await gaugeController['gauge_relative_weight(address)'](gauge.address)).to.be.gt(0);
  });

  it('mint & bridge tokens', async () => {
    // The gauge has votes for this week, and it will mint the first batch of tokens. We store the current gauge
    // relative weight, as it will change as time goes by due to vote decay.
    const firstMintWeekTimestamp = await currentWeekTimestamp();
    const gaugeRelativeWeight = await gaugeController['gauge_relative_weight(address)'](gauge.address);

    const calldata = gauge.interface.encodeFunctionData('checkpoint');

    // Even though the gauge has relative weight, it cannot mint yet as it needs for the epoch to finish
    const bridgeETH = await gauge.getTotalBridgeCost();
    const zeroMintTx = await authorizerAdaptor
      .connect(admin)
      .performAction(gauge.address, calldata, { value: bridgeETH });
    expectEvent.inIndirectReceipt(await zeroMintTx.wait(), gauge.interface, 'Checkpoint', {
      periodTime: firstMintWeekTimestamp.sub(WEEK), // Process past week, which had zero votes
      periodEmissions: 0,
    });
    // No token transfers are performed if the emissions are zero, but we can't test for a lack of those

    await advanceTime(WEEK);

    // The gauge should now mint and send all minted tokens to the Arbitrum bridge
    const mintTx = await authorizerAdaptor.connect(admin).performAction(gauge.address, calldata, { value: bridgeETH });
    const event = expectEvent.inIndirectReceipt(await mintTx.wait(), gauge.interface, 'Checkpoint', {
      periodTime: firstMintWeekTimestamp,
    });
    const actualEmissions = event.args.periodEmissions;

    // The amount of tokens minted should equal the weekly emissions rate times the relative weight of the gauge
    const weeklyRate = (await BALTokenAdmin.getInflationRate()).mul(WEEK);

    const expectedEmissions = gaugeRelativeWeight.mul(weeklyRate).div(FP_SCALING_FACTOR);
    expectEqualWithError(actualEmissions, expectedEmissions, 0.001);

    // Tokens are minted for the gauge
    expectEvent.inIndirectReceipt(await mintTx.wait(), BAL.interface, 'Transfer', {
      from: ZERO_ADDRESS,
      to: gauge.address,
      value: actualEmissions,
    });

    // And the gauge then deposits those in the predicate via the bridge mechanism
    const bridgeInterface = new ethers.utils.Interface([
      'event DepositInitiated(address l1Token, address indexed from, address indexed to, uint256 indexed sequenceNumber, uint256 amount)',
    ]);

    expectEvent.inIndirectReceipt(await mintTx.wait(), bridgeInterface, 'DepositInitiated', {
      from: gauge.address,
      to: recipient.address,
      l1Token: BAL.address,
      amount: actualEmissions,
    });
  });
});
