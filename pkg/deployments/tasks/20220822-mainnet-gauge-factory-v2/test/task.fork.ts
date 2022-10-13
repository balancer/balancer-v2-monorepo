import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { BigNumber, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import {
  advanceTime,
  advanceToTimestamp,
  currentTimestamp,
  currentWeekTimestamp,
  DAY,
  WEEK,
} from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate } from '../../../src/signers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { range } from 'lodash';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describeForkTest('LiquidityGaugeFactoryV2', 'mainnet', 15397200, function () {
  let veBALHolder: SignerWithAddress, admin: SignerWithAddress, lpTokenHolder: SignerWithAddress;
  let factory: Contract, gauge: Contract;
  let vault: Contract,
    authorizer: Contract,
    BALTokenAdmin: Contract,
    gaugeController: Contract,
    gaugeAdder: Contract,
    lpToken: Contract,
    balancerMinter: Contract;

  let BAL: string;

  let task: Task;

  const VEBAL_HOLDER = '0xd519D5704B41511951C8CF9f65Fee9AB9beF2611';
  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  const LP_TOKEN = '0xbc5F4f9332d8415AAf31180Ab4661c9141CC84E4';
  const LP_TOKEN_HOLDER = '0x24Dd242c3c4061b1fCaA5119af608B56afBaEA95';

  const weightCap = fp(0.001);

  before('run task', async () => {
    task = new Task('20220822-mainnet-gauge-factory-v2', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    factory = await task.deployedInstance('LiquidityGaugeFactory');
  });

  before('advance time', async () => {
    // This causes all voting cooldowns to expire, letting the veBAL holder vote again
    await advanceTime(DAY * 12);
  });

  before('setup accounts', async () => {
    admin = await getSigner(0);
    veBALHolder = await impersonate(VEBAL_HOLDER, fp(100));
    lpTokenHolder = await impersonate(LP_TOKEN_HOLDER, fp(100));
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.instanceAt('Vault', vaultTask.output({ network: 'mainnet' }).Vault);
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

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

    balancerMinter = await gaugeControllerTask.instanceAt(
      'BalancerMinter',
      gaugeControllerTask.output({ network: 'mainnet' }).BalancerMinter
    );

    // We use test balancer token to make use of the ERC-20 interface.
    const testBALTokenTask = new Task('20220325-test-balancer-token', TaskMode.READ_ONLY, getForkedNetwork(hre));
    lpToken = await testBALTokenTask.instanceAt('TestBalancerToken', LP_TOKEN);
  });

  it('create gauge', async () => {
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

  it('stake LP tokens in gauge', async () => {
    await lpToken.connect(lpTokenHolder).approve(gauge.address, MAX_UINT256);
    await gauge.connect(lpTokenHolder)['deposit(uint256)'](await lpToken.balanceOf(lpTokenHolder.address));
  });

  it('vote for gauge so that weight is above cap', async () => {
    expect(await gaugeController.get_gauge_weight(gauge.address)).to.equal(0);
    expect(await gauge.getCappedRelativeWeight(await currentTimestamp())).to.equal(0);

    // Max voting power is 10k points
    await gaugeController.connect(veBALHolder).vote_for_gauge_weights(gauge.address, 10000);

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
    // For simplicty, we're going to move to the end of the week so that we mint a full week's worth of tokens.
    const firstMintWeekTimestamp = await currentWeekTimestamp();
    await advanceToTimestamp(firstMintWeekTimestamp.add(WEEK));

    const tx = await balancerMinter.connect(lpTokenHolder).mint(gauge.address);
    const event = expectTransferEvent(
      await tx.wait(),
      {
        from: ZERO_ADDRESS,
        to: lpTokenHolder.address,
      },
      BAL
    );

    // The amount of tokens minted should equal the weekly emissions rate times the relative weight of the gauge.
    const weeklyRate = (await BALTokenAdmin.getInflationRate()).mul(WEEK);

    // Note that we use the cap instead of the weight, since we're testing a scenario in which the weight is larger than
    // the cap.
    const expectedGaugeEmissions = weeklyRate.mul(weightCap).div(fp(1));

    // Since the LP token holder is the only account staking in the gauge, they'll receive the full amount destined to
    // the gauge.
    const actualEmissions = event.args.value;
    expectEqualWithError(actualEmissions, expectedGaugeEmissions, 0.001);
  });

  it('mint multiple weeks', async () => {
    // Since we're at the beginning of a week, we can simply advance a whole number of weeks for them to be complete.
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

    const tx = await balancerMinter.connect(lpTokenHolder).mint(gauge.address);
    const event = expectTransferEvent(
      await tx.wait(),
      {
        from: ZERO_ADDRESS,
        to: lpTokenHolder.address,
      },
      BAL
    );

    // The amount of tokens allocated to the gauge should equal the sum of the weekly emissions rate times the weight
    // cap.
    const weeklyRate = (await BALTokenAdmin.getInflationRate()).mul(WEEK);
    const expectedGaugeEmissions = weeklyRate.mul(numberOfWeeks).mul(weightCap).div(fp(1));

    // Since the LP token holder is the only account staking in the gauge, they'll receive the full amount destined to
    // the gauge.
    const actualEmissions = event.args.value;
    expectEqualWithError(actualEmissions, expectedGaugeEmissions, 0.001);
  });
});
