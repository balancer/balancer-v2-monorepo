import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { BigNumber, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { GaugeType } from '@balancer-labs/balancer-js/src/types';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { impersonate } from '../../../src/signers';

// This block number is before the manual weekly checkpoint. This ensures gauges will actually be checkpointed.
describeForkTest('L2GaugeCheckpointer', 'mainnet', 15272610, function () {
  /* eslint-disable @typescript-eslint/no-non-null-assertion */

  let L2GaugeCheckpointer: Contract;
  let vault: Contract, authorizer: Contract, authorizerAdaptor: Contract;

  let task: Task;

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  // Gauges that are NOT killed.
  const polygonRootGauges: [address: string, expectedCheckpoints: number][] = [
    ['0xa5a0b6598b90d214eaf4d7a6b72d5a89c3b9a72c', 1],
    ['0x88d07558470484c03d3bb44c3ecc36cafcf43253', 1],
    ['0xfbf87d2c22d1d298298ab5b0ec957583a2731d15', 1],
    ['0xc6fb8c72d3bd24fc4891c51c2cb3a13f49c11335', 1],
    ['0x5a3970e3145bbba4838d1a3a31c79bcd35a16a9e', 1],
    ['0xc3bb46b8196c3f188c6a373a6c4fde792ca78653', 1],
    ['0xa80d514734e57691f45af76bb44d1202858fd1f0', 1],
    ['0x211c27a32e686659566c3cee6035c2343d823aab', 1],
    ['0x397649ff00de6d90578144103768aaa929ef683d', 1],
    ['0xd27cb689083e97847dc91c64efc91c4445d46d47', 1],
    ['0xf01541837cf3a64bc957f53678b0ab113e92911b', 1],
    ['0xead3c3b6c829d54ad0a4c18762c567f728ef0535', 1],
    ['0xcf5938ca6d9f19c73010c7493e19c02acfa8d24d', 1],
    ['0xd13a839bb48d69a296a1fa6d615b6c39b170096b', 2],
  ];

  const arbitrumRootGauges: [address: string, expectedCheckpoints: number][] = [
    ['0xF0ea3559Cf098455921d74173dA83fF2f6979495', 1],
    ['0xB0de49429fBb80c635432bbAD0B3965b28560177', 1],
    ['0x359EA8618c405023Fc4B98dAb1B01F373792a126', 1],
    ['0xc77E5645Dbe48d54afC06655e39D3Fe17eB76C1c', 1],
    ['0x899F737750db562b88c1E412eE1902980D3a4844', 1],
    ['0x6cb1A77AB2e54d4560fda893E9c738ad770da0B0', 1],
    ['0x6823DcA6D70061F2AE2AAA21661795A2294812bF', 1],
    ['0xACFDA9Fd773C23c01f5d0CAE304CBEbE6b449677', 1],
    ['0x68EBB057645258Cc62488fD198A0f0fa3FD6e8fb', 1],
  ];

  // This one was not added to the GaugeController, so we will not be using it. Adding it here for completion only.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const optimismRootGauges = ['0x0256B02F3b19e71AF03B4e2A6731ca35106f5439'];

  type GaugeData = {
    address: string;
    weight: BigNumber;
    expectedCheckpoints: number;
  };

  const gauges = new Map<GaugeType, GaugeData[]>();

  before('run task', async () => {
    task = new Task('202208xx-l2-gauge-checkpointer', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    L2GaugeCheckpointer = await task.deployedInstance('L2GaugeCheckpointer');
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());
    const authorizerAdaptorTask = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizerAdaptor = await authorizerAdaptorTask.instanceAt(
      'AuthorizerAdaptor',
      '0x8f42adbba1b16eaae3bb5754915e0d06059add75' // authorizerAdaptorTask.output({ network: 'mainnet' }).AuthorizerAdaptor
    );
  });

  before('get gauge relative weights and associate them with their respective address', async () => {
    const gaugeControllerTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    const gaugeController = await gaugeControllerTask.instanceAt(
      'GaugeController',
      '0xC128468b7Ce63eA702C1f104D55A2566b13D3ABD' // gaugeControllerTask.output({ network: 'mainnet' }).GaugeController
    );

    const getGaugesData = async (gaugeInputs: [string, number][]) => {
      return Promise.all(
        gaugeInputs.map(async (gaugeInput) => {
          return {
            address: gaugeInput[0],
            weight: await gaugeController['gauge_relative_weight(address)'](gaugeInput[0]),
            expectedCheckpoints: gaugeInput[1],
          };
        })
      );
    };
    const polygonRootGaugesData: GaugeData[] = await getGaugesData(polygonRootGauges);
    const arbitrumRootGaugesData: GaugeData[] = await getGaugesData(arbitrumRootGauges);

    // There are no optimism gauges that are correctly added to the Gauge Adder and the Gauge Controller at this point.
    gauges.set(GaugeType.Polygon, polygonRootGaugesData);
    gauges.set(GaugeType.Arbitrum, arbitrumRootGaugesData);
  });

  before('add gauges to checkpointer', async () => {
    await Promise.all(
      Array.from(gauges).map(([gaugeType, gaugesData]) => {
        L2GaugeCheckpointer.addGauges(
          gaugeType,
          gaugesData.map((gaugeData) => gaugeData.address)
        );
      })
    );
  });

  before('grant checkpoint permission to fees gauge checkpointer', async () => {
    // Any gauge works; we just need the interface.
    const gauge = await task.instanceAt('IStakelessGauge', gauges.get(GaugeType.Polygon)![0].address);
    const govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    await authorizer
      .connect(govMultisig)
      .grantRole(
        await authorizerAdaptor.getActionId(gauge.interface.getSighash('checkpoint')),
        L2GaugeCheckpointer.address
      );
  });

  it('checks that gauges were added correctly', async () => {
    for (const [gaugeType, gaugesData] of gauges.entries()) {
      expect(await L2GaugeCheckpointer.getTotalGauges(gaugeType)).to.be.eq(gaugesData.length);
    }
  });

  describe('getTotalBridgeCost', () => {
    context('when threshold is 1', () => {
      itChecksTotalBridgeCost(fp(1));
    });

    context('when threshold is 0.0001', () => {
      itChecksTotalBridgeCost(fp(0.0001));
    });

    context('when threshold is 0', () => {
      itChecksTotalBridgeCost(fp(0));
    });
  });

  describe('checkpoint', () => {
    const checkpointedGauges: GaugeData[] = [];
    let gaugeDataAboveMinWeight: GaugeData[] = [];
    let minRelativeWeight: BigNumber;

    // Gauges won't be checkpointed twice, so when the threshold is lowered and more gauges get above the threshold
    // we need to filter out those that have already been checkpointed.
    beforeEach('get non-checkpointed gauges above min weight', () => {
      gaugeDataAboveMinWeight = [
        ...getGaugeDataAboveMinWeight(GaugeType.Polygon, minRelativeWeight),
        ...getGaugeDataAboveMinWeight(GaugeType.Arbitrum, minRelativeWeight),
      ];
    });

    afterEach('mark checkpointed gauges to consider in the next iteration', () => {
      checkpointedGauges.push(...gaugeDataAboveMinWeight);
    });

    context('when threshold is 1', () => {
      minRelativeWeight = fp(1);
      itCheckpointsGaugesAboveRelativeWeight();
    });

    context('when threshold is 0.0001', () => {
      minRelativeWeight = fp(0.0001);
      itCheckpointsGaugesAboveRelativeWeight();
    });

    context('when threshold is 0', () => {
      minRelativeWeight = fp(0);
      itCheckpointsGaugesAboveRelativeWeight();
    });

    function itCheckpointsGaugesAboveRelativeWeight() {
      const checkpointInterface = new ethers.utils.Interface([
        'function checkpoint()',
        'event Checkpoint(uint256 indexed periodTime, uint256 periodEmissions)',
      ]);

      it('performs a checkpoint for (non-checkpointed) gauges', async () => {
        const tx = await L2GaugeCheckpointer.checkpointGaugesAboveRelativeWeight(minRelativeWeight, {
          value: await L2GaugeCheckpointer.getTotalBridgeCost(minRelativeWeight),
        });
        const receipt = await tx.wait();

        // Only gauges that haven't been checkpointed so far should have been covered in this test iteration.
        const gaugesToCheckpoint = gaugeDataAboveMinWeight.filter((data) => !checkpointedGauges.includes(data));

        // Check that the right amount of checkpoints were actually performed for every gauge that required them.
        gaugesToCheckpoint.forEach((gaugeData) => {
          expectEvent.inIndirectReceipt(
            receipt,
            checkpointInterface,
            'Checkpoint',
            {},
            gaugeData.address,
            gaugeData.expectedCheckpoints
          );
        });
      });
    }
  });

  function itChecksTotalBridgeCost(minRelativeWeight: BigNumber) {
    it('checks total bridge cost', async () => {
      const arbitrumGauge = await task.instanceAt('ArbitrumRootGauge', gauges.get(GaugeType.Arbitrum)![0].address);

      const gaugesAmountAboveMinWeight = getGaugeDataAboveMinWeight(GaugeType.Arbitrum, minRelativeWeight).length;
      const singleGaugeBridgeCost = await arbitrumGauge.getTotalBridgeCost();

      // Bridge cost per gauge is always the same, so total cost is (single gauge cost) * (number of gauges).
      expect(await L2GaugeCheckpointer.getTotalBridgeCost(minRelativeWeight)).to.be.almostEqual(
        singleGaugeBridgeCost * gaugesAmountAboveMinWeight
      );
    });
  }

  function getGaugeDataAboveMinWeight(gaugeType: GaugeType, fpMinRelativeWeight: BigNumber): GaugeData[] {
    return gauges.get(gaugeType)!.filter((addressWeight) => addressWeight.weight.gte(fpMinRelativeWeight));
  }
});
