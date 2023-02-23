import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { takeSnapshot, SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';

import { BigNumber, FP_ONE, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import {
  advanceTime,
  currentTimestamp,
  currentWeekTimestamp,
  DAY,
  MONTH,
  WEEK,
} from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { range } from 'lodash';

import { describeForkTest, impersonate, getForkedNetwork, Task, TaskMode, getSigners } from '../../../src';
import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';

describeForkTest('SingleRecipientGaugeFactory V2', 'mainnet', 16686000, function () {
  let admin: SignerWithAddress, other: SignerWithAddress, balWhale: SignerWithAddress;
  let vault: Contract,
    authorizer: Contract,
    authorizerAdaptor: Contract,
    bal80weth20Pool: Contract,
    BALTokenAdmin: Contract,
    gaugeController: Contract,
    balToken: Contract,
    veBAL: Contract,
    factory: Contract,
    gauge: Contract;

  let BAL: string;

  let task: Task;

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  const BAL_WHALE = '0x740a4AEEfb44484853AA96aB12545FC0290805F3';
  const BAL80WETH20_POOL = '0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56';

  const weightCap = fp(0.001);

  before('run task', async () => {
    task = new Task('20230215-single-recipient-gauge-factory-v2', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    factory = await task.deployedInstance('SingleRecipientGaugeFactory');
  });

  before('advance time', async () => {
    // This causes all voting cooldowns to expire, letting the veBAL holder vote again
    await advanceTime(DAY * 12);
  });

  before('setup accounts', async () => {
    [, admin, other] = await getSigners();
    balWhale = await impersonate(BAL_WHALE, fp(10000));
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    const authorizerAdaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizerAdaptor = await authorizerAdaptorTask.deployedInstance('AuthorizerAdaptor');

    const weightedPoolTask = new Task('20210418-weighted-pool', TaskMode.READ_ONLY, getForkedNetwork(hre));
    bal80weth20Pool = await weightedPoolTask.instanceAt('WeightedPool2Tokens', BAL80WETH20_POOL);

    const balancerTokenAdminTask = new Task('20220325-balancer-token-admin', TaskMode.READ_ONLY, getForkedNetwork(hre));
    BALTokenAdmin = await balancerTokenAdminTask.deployedInstance('BalancerTokenAdmin');

    BAL = await BALTokenAdmin.getBalancerToken();

    const gaugeControllerTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    gaugeController = await gaugeControllerTask.deployedInstance('GaugeController');
    veBAL = await gaugeControllerTask.deployedInstance('VotingEscrow');

    // We use test balancer token to make use of the ERC-20 interface.
    const testBALTokenTask = new Task('20220325-test-balancer-token', TaskMode.READ_ONLY, getForkedNetwork(hre));
    balToken = await testBALTokenTask.instanceAt('TestBalancerToken', BAL);
  });

  before('get veBAL from BAL', async () => {
    const ethToJoin = fp(100);
    await balToken.connect(balWhale).approve(vault.address, MAX_UINT256);
    const poolId = await bal80weth20Pool.getPoolId();

    await vault.connect(balWhale).joinPool(
      poolId,
      balWhale.address,
      balWhale.address,
      {
        assets: [BAL, ZERO_ADDRESS], // Using sentinel value to join with ETH instead of WETH.
        maxAmountsIn: [MAX_UINT256, MAX_UINT256],
        fromInternalBalance: false,
        userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(
          [await balToken.balanceOf(balWhale.address), ethToJoin],
          0
        ),
      },
      { value: ethToJoin }
    );

    await bal80weth20Pool.connect(balWhale).approve(veBAL.address, MAX_UINT256);
    const currentTime = await currentTimestamp();
    await veBAL
      .connect(balWhale)
      .create_lock(await bal80weth20Pool.balanceOf(balWhale.address), currentTime.add(MONTH * 12));
  });

  // This block number is close to an epoch change, so we first move to the next one and update the emission rates
  // in the BAL token admin. This is not strictly necessary, but completing the whole test within the same epoch
  // simplifies the math for the expected emissions down below.
  before('update balancer token admin rate', async () => {
    await advanceTime(WEEK * 5);
    await BALTokenAdmin.update_mining_parameters();
  });

  enum RecipientMode {
    BasicRecipient,
    FeeDistributorRecipient,
  }

  describe('getters', () => {
    const expectedGaugeVersion = {
      name: 'SingleRecipientGauge',
      version: 2,
      deployment: '20230215-single-recipient-gauge-factory-v2',
    };

    it('check gauge version', async () => {
      const tx = await factory.create(ZERO_ADDRESS, fp(0), false);
      const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');
      const gauge = await task.instanceAt('SingleRecipientGauge', event.args.gauge);
      expect(await gauge.version()).to.equal(JSON.stringify(expectedGaugeVersion));
    });

    it('check gauge version from factory', async () => {
      expect(await factory.getProductVersion()).to.equal(JSON.stringify(expectedGaugeVersion));
    });

    it('check factory version', async () => {
      const expectedFactoryVersion = {
        name: 'SingleRecipientGaugeFactory',
        version: 2,
        deployment: '20230215-single-recipient-gauge-factory-v2',
      };

      expect(await factory.version()).to.equal(JSON.stringify(expectedFactoryVersion));
    });
  });

  context('with a basic recipient', () => {
    itWorksLikeACappedSingleRecipientGauge(RecipientMode.BasicRecipient);
  });

  context('with a FeeDistributor recipient', () => {
    itWorksLikeACappedSingleRecipientGauge(RecipientMode.FeeDistributorRecipient);
  });

  function itWorksLikeACappedSingleRecipientGauge(mode: RecipientMode) {
    // We're going to create gauges, vote for them, have time pass, etc. Because of that, we take a snapshot before we
    // do any of that, and restore it at the end.
    let snapshot: SnapshotRestorer;

    before(async () => {
      snapshot = await takeSnapshot();
    });

    after(async () => {
      await snapshot.restore();
    });

    let recipient: string;
    before(() => {
      if (mode == RecipientMode.BasicRecipient) {
        recipient = other.address;
      } else {
        const feeDistributorTask = new Task('20220714-fee-distributor-v2', TaskMode.READ_ONLY, getForkedNetwork(hre));
        recipient = feeDistributorTask.output({ network: 'mainnet' }).FeeDistributor;
      }
    });

    it('create gauge', async () => {
      // We use an EOA as the single recipient; in practice it will probably be a contract.
      const tx = await factory.create(recipient, weightCap, mode == RecipientMode.FeeDistributorRecipient);

      const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

      gauge = await task.instanceAt('SingleRecipientGauge', event.args.gauge);
      expect(await gauge.getRecipient()).to.equal(recipient);
      expect(await gauge.isRecipientFeeDistributor()).to.equal(mode == RecipientMode.FeeDistributorRecipient);

      expect(await factory.isGaugeFromFactory(gauge.address)).to.be.true;
    });

    it('grant permissions', async () => {
      // We are not using the GaugeAdder at the moment, so gauges shall be added to the gauge controller directly.
      // Therefore, we just grant the admin the permission to add the gauge to the controller, and perform a checkpoint.
      const govMultisig = await impersonate(GOV_MULTISIG);
      const gaugeControllerTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
      await authorizer
        .connect(govMultisig)
        .grantRole(gaugeControllerTask.actionId('GaugeController', 'add_gauge(address,int128)'), admin.address);

      await authorizer
        .connect(govMultisig)
        .grantRole(await authorizerAdaptor.getActionId(gauge.interface.getSighash('checkpoint')), admin.address);
    });

    it('add gauge to gauge controller directly via AuthorizerAdaptor', async () => {
      // Using 2 as Ethereum gauge type, but it could be any of the existing types since they all have the same
      // relative weight in the controller.
      const calldata = gaugeController.interface.encodeFunctionData('add_gauge(address,int128)', [gauge.address, 2]);
      await authorizerAdaptor.connect(admin).performAction(gaugeController.address, calldata);

      expect(await gaugeController.gauge_exists(gauge.address)).to.be.true;
    });

    it('vote for gauge so that weight is above cap', async () => {
      expect(await gaugeController.get_gauge_weight(gauge.address)).to.equal(0);
      expect(await gauge.getCappedRelativeWeight(await currentTimestamp())).to.equal(0);

      // Max voting power is 10k points
      await gaugeController.connect(balWhale).vote_for_gauge_weights(gauge.address, 10000);

      // We now need to go through an epoch for the votes to be locked in
      await advanceTime(DAY * 8);

      await gaugeController.checkpoint();
      // Gauge weight is equal to the cap, and controller weight for the gauge is greater than the cap.
      expect(
        await gaugeController['gauge_relative_weight(address,uint256)'](gauge.address, await currentWeekTimestamp())
      ).to.be.gt(weightCap);
      expect(await gauge.getCappedRelativeWeight(await currentTimestamp())).to.equal(weightCap);
    });

    it('mint & transfer tokens', async () => {
      // The gauge has votes for this week, and it will mint the first batch of tokens. We store the current gauge
      // relative weight, as it will change as time goes by due to vote decay.
      const firstMintWeekTimestamp = await currentWeekTimestamp();

      const calldata = gauge.interface.encodeFunctionData('checkpoint');

      const zeroMintTx = await authorizerAdaptor.connect(admin).performAction(gauge.address, calldata);
      expectEvent.inIndirectReceipt(await zeroMintTx.wait(), gauge.interface, 'Checkpoint', {
        periodTime: firstMintWeekTimestamp.sub(WEEK), // Process past week, which had zero votes
        periodEmissions: 0,
      });
      // No token transfers are performed if the emissions are zero, but we can't test for a lack of those

      await advanceTime(WEEK);

      // The gauge should now mint and send all minted tokens to the Arbitrum bridge
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

      // And then forwarded to the recipient
      expectTransferEvent(
        await mintTx.wait(),
        {
          from: gauge.address,
          to: recipient,
          value: actualEmissions,
        },
        BAL
      );
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
      const gaugeTransferEvent = expectTransferEvent(
        await tx.wait(),
        {
          from: ZERO_ADDRESS,
          to: gauge.address,
        },
        BAL
      );
      expect(gaugeTransferEvent.args.value).to.be.almostEqual(expectedEmissions);

      // And then forwarded to the recipient
      expectTransferEvent(
        await tx.wait(),
        {
          from: gauge.address,
          to: recipient,
          value: gaugeTransferEvent.args.value,
        },
        BAL
      );
    });
  }
});
