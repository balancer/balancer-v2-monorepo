import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { advanceTime, currentWeekTimestamp, MONTH, WEEK } from '@balancer-labs/v2-helpers/src/time';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';

import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { impersonate } from '../../../src/signers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

describe('DistributionScheduler', function () {
  let lmCommittee: SignerWithAddress, distributor: SignerWithAddress;
  let scheduler: Contract, gauge: Contract, DAI: Contract, USDC: Contract;

  const task = new Task('20220422-distribution-scheduler', TaskMode.TEST, getForkedNetwork(hre));

  const LM_COMMITTEE_ADDRESS = '0xc38c5f97B34E175FFd35407fc91a937300E33860';
  const DISTRIBUTOR_ADDRESS = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503'; // Owns DAI and USDC

  const DAI_ADDRESS = '0x6b175474e89094c44da98b954eedeac495271d0f';
  const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

  const daiWeeklyAmount = fp(42);
  const usdcWeeklyAmount = bn(1337e6); // USDC has 6 tokens

  const GAUGE_ADDRESS = '0x4E3c048BE671852277Ad6ce29Fd5207aA12fabff';

  before('run task', async () => {
    await task.run({ force: true });
    scheduler = await task.instanceAt('DistributionScheduler', task.output({ network: 'test' }).DistributionScheduler);
  });

  before('setup accounts', async () => {
    lmCommittee = await impersonate(LM_COMMITTEE_ADDRESS, fp(100));
    distributor = await impersonate(DISTRIBUTOR_ADDRESS, fp(100));
  });

  before('setup contracts', async () => {
    // We reuse this task as it contains an ABI similar to the one in real ERC20 tokens
    const testBALTokenTask = new Task('20220325-test-balancer-token', TaskMode.READ_ONLY, getForkedNetwork(hre));
    DAI = await testBALTokenTask.instanceAt('TestBalancerToken', DAI_ADDRESS);
    USDC = await testBALTokenTask.instanceAt('TestBalancerToken', USDC_ADDRESS);

    const gaugeFactoryTask = new Task('20220325-mainnet-gauge-factory', TaskMode.READ_ONLY, getForkedNetwork(hre));
    gauge = await gaugeFactoryTask.instanceAt('LiquidityGaugeV5', GAUGE_ADDRESS);
  });

  before('add reward tokens to gauge', async () => {
    const authorizerAdaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, getForkedNetwork(hre));
    const authorizerAdaptor = await authorizerAdaptorTask.instanceAt(
      'AuthorizerAdaptor',
      authorizerAdaptorTask.output({ network: 'mainnet' }).AuthorizerAdaptor
    );

    await Promise.all(
      [DAI, USDC].map((token) =>
        authorizerAdaptor.connect(lmCommittee).performAction(
          gauge.address,
          // Note that we need to make the scheduler the distributor
          gauge.interface.encodeFunctionData('add_reward', [token.address, scheduler.address])
        )
      )
    );

    expect(await gauge.reward_count()).to.equal(2);
  });

  before('approve tokens', async () => {
    await USDC.connect(distributor).approve(scheduler.address, MAX_UINT256);
    await DAI.connect(distributor).approve(scheduler.address, MAX_UINT256);
  });

  it('schedules rewards', async () => {
    const nextWeek = (await currentWeekTimestamp()).add(WEEK);

    await scheduler.connect(distributor).scheduleDistribution(gauge.address, DAI.address, daiWeeklyAmount, nextWeek);

    await scheduler.connect(distributor).scheduleDistribution(gauge.address, USDC.address, usdcWeeklyAmount, nextWeek);
    await scheduler
      .connect(distributor)
      .scheduleDistribution(gauge.address, USDC.address, usdcWeeklyAmount, nextWeek.add(WEEK));

    // Fist week
    expect(await scheduler.getPendingRewardsAt(gauge.address, DAI.address, nextWeek)).to.equal(daiWeeklyAmount);
    expect(await scheduler.getPendingRewardsAt(gauge.address, USDC.address, nextWeek)).to.equal(usdcWeeklyAmount);

    // Second week
    expect(await scheduler.getPendingRewardsAt(gauge.address, USDC.address, nextWeek.add(WEEK))).to.equal(
      usdcWeeklyAmount.mul(2)
    );
  });

  it('does not distribute rewards until the scheduled time arrives', async () => {
    const daiBalanceBefore = await DAI.balanceOf(scheduler.address);
    const usdcBalanceBefore = await USDC.balanceOf(scheduler.address);

    await scheduler.startDistributions(gauge.address);

    const daiBalanceAfter = await DAI.balanceOf(scheduler.address);
    const usdcBalanceAfter = await USDC.balanceOf(scheduler.address);

    expect(daiBalanceAfter).to.equal(daiBalanceBefore);
    expect(usdcBalanceAfter).to.equal(usdcBalanceBefore);
  });

  it('distributes rewards', async () => {
    await advanceTime((await currentWeekTimestamp()).add(MONTH));
    const tx = await scheduler.startDistributions(gauge.address);

    // Ideally we'd look for events on the gauge as it processes the deposit, but deposit_reward_token emits no events.

    expectTransferEvent(
      await tx.wait(),
      { from: scheduler.address, to: gauge.address, value: daiWeeklyAmount },
      DAI.address
    );

    expectTransferEvent(
      await tx.wait(),
      { from: scheduler.address, to: gauge.address, value: usdcWeeklyAmount.mul(2) },
      USDC.address
    );
  });
});
