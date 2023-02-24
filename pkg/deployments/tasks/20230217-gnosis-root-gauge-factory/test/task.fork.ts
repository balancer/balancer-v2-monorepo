import hre, { ethers } from 'hardhat';
import { defaultAbiCoder } from '@ethersproject/abi';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { GaugeType } from '@balancer-labs/balancer-js/src/types';
import { BigNumber, fp, FP_ONE } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import {
  advanceTime,
  currentTimestamp,
  currentWeekTimestamp,
  DAY,
  WEEK,
  MONTH,
} from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate } from '../../../src/signers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { ZERO_ADDRESS, MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { range } from 'lodash';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { describeForkTest } from '../../../src/forkTests';
import { deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';

describeForkTest('GnosisRootGaugeFactory', 'mainnet', 16627100, function () {
  let veBALHolder: SignerWithAddress, admin: SignerWithAddress, recipient: SignerWithAddress;
  let factory: Contract, gauge: Contract;
  let vault: Contract,
    authorizer: Contract,
    authorizerAdaptor: Contract,
    BALTokenAdmin: Contract,
    gaugeController: Contract,
    veBAL: Contract,
    bal80weth20Pool: Contract;
  let BAL: string;
  let task: Task;

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  const VEBAL_POOL = '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56';
  const VAULT_BOUNTY = fp(1000);

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

    veBALHolder = await impersonate((await getSigner(2)).address, VAULT_BOUNTY.add(fp(5))); // plus gas
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    const authorizerAdaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizerAdaptor = await authorizerAdaptorTask.deployedInstance('AuthorizerAdaptor');

    const balancerTokenAdminTask = new Task('20220325-balancer-token-admin', TaskMode.READ_ONLY, getForkedNetwork(hre));
    BALTokenAdmin = await balancerTokenAdminTask.deployedInstance('BalancerTokenAdmin');

    BAL = await BALTokenAdmin.getBalancerToken();

    const gaugeControllerTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    gaugeController = await gaugeControllerTask.deployedInstance('GaugeController');
  });

  before('update balancer token admin rate', async () => {
    // We move forward past the BAL minting epoch, so that it doesn't fall in the middle of the 'multiple weeks' test,
    // resulting in variable rates.

    await advanceTime(WEEK * 5);
    await BALTokenAdmin.update_mining_parameters();
  });

  before('create veBAL whale', async () => {
    const veBALTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    veBAL = await veBALTask.instanceAt('VotingEscrow', veBALTask.output({ network: 'mainnet' }).VotingEscrow);

    bal80weth20Pool = await deployedAt('v2-pool-weighted/WeightedPool', VEBAL_POOL);

    const poolId = await bal80weth20Pool.getPoolId();

    await vault.connect(veBALHolder).joinPool(
      poolId,
      veBALHolder.address,
      veBALHolder.address,
      {
        assets: [BAL, ZERO_ADDRESS],
        maxAmountsIn: [0, VAULT_BOUNTY],
        fromInternalBalance: false,
        userData: WeightedPoolEncoder.joinExactTokensInForBPTOut([0, VAULT_BOUNTY], 0),
      },
      { value: VAULT_BOUNTY }
    );

    await bal80weth20Pool.connect(veBALHolder).approve(veBAL.address, MAX_UINT256);
    const currentTime = await currentTimestamp();
    await veBAL
      .connect(veBALHolder)
      .create_lock(await bal80weth20Pool.balanceOf(veBALHolder.address), currentTime.add(MONTH * 12));
  });

  it('create gauge', async () => {
    const tx = await factory.create(recipient.address, weightCap);
    const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

    gauge = await task.instanceAt('GnosisRootGauge', event.args.gauge);

    expect(await factory.isGaugeFromFactory(gauge.address)).to.be.true;
    expect(await gauge.getRecipient()).to.equal(recipient.address);
  });

  it('grant permissions', async () => {
    // We need to grant permission to the admin to add gauges to the GaugeController.
    const govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    await authorizer
      .connect(govMultisig)
      .grantRole(await authorizerAdaptor.getActionId(gauge.interface.getSighash('checkpoint')), admin.address);

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

  it('add gauge to gauge controller', async () => {
    // Add gauge directly through the controller, since we can't use GaugeAdder V3 without the TimelockAuthorizer

    await authorizerAdaptor
      .connect(admin)
      .performAction(
        gaugeController.address,
        gaugeController.interface.encodeFunctionData('add_type(string,uint256)', ['Gnosis', 1])
      );

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

    expect(transferEvent.args.value).to.be.almostEqual(expectedEmissions);

    // And the gauge then deposits those in the predicate via the bridge mechanism
    const bridgeInterface = new ethers.utils.Interface([
      'event TokensBridgingInitiated(address indexed token, address indexed sender, uint256 value, bytes32 indexed messageId)',
    ]);

    const depositEvent = expectEvent.inIndirectReceipt(await tx.wait(), bridgeInterface, 'TokensBridgingInitiated', {
      token: BAL,
      sender: gauge.address,
    });

    expect(depositEvent.args.value).to.be.almostEqual(expectedEmissions);

    // The TokensBridgingInitiated event unfortunately doesn't include the L2 recipient address, so we check that by
    // looking at some of the data encoded in the UserRequestForAffirmation event. Said data is relatively complicated,
    // but the last bytes seem to be the ABI encoding of (token, recipient, amount). This is based on the event at index
    // 261 of mainnet transaction 0x6a0dcbf72db757f83bf1c9b42e5f940c31e3240479614635fcbe5a5f72091692.
    const ambInterface = new ethers.utils.Interface([
      'event UserRequestForAffirmation(bytes32 indexed messageId, bytes encodedData)',
    ]);

    const userRequestEvent = expectEvent.inIndirectReceipt(await tx.wait(), ambInterface, 'UserRequestForAffirmation');

    const expectedPartialEncodedData = defaultAbiCoder.encode(
      ['address', 'address', 'uint256'],
      [BAL, recipient.address, depositEvent.args.value]
    );

    // Remove the leading 0x when testing for substring inclusion
    expect(userRequestEvent.args.encodedData).to.include(expectedPartialEncodedData.slice(2));
  });
});
