import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { BigNumber, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { GaugeType } from '@balancer-labs/balancer-js/src/types';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { impersonate } from '../../../src/signers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

// This block number is before the manual weekly checkpoint. This ensures gauges will actually be checkpointed.
// This test verifies the checkpointer against the manual transactions for the given period.
describeForkTest('L2GaugeCheckpointer', 'mainnet', 16341300, function () {
  /* eslint-disable @typescript-eslint/no-non-null-assertion */

  let L2GaugeCheckpointer: Contract;
  let vault: Contract, oldAuthorizer: Contract, authorizer: Contract, adaptorEntrypoint: Contract, migrator: Contract;

  let task: Task;
  let daoMultisig: SignerWithAddress;

  const DAO_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  // Gauges that are NOT killed for the given test block number.
  // See tx: 0xeb4fe40d2dbc9ca0780439f2817bcc795ef0ea5f26cf5bd67fc8e3bedd601312
  const polygonRootGauges: [address: string, expectedCheckpoints: number][] = [
    ['0x2c967d6611c60274db45e0bb34c64fb5f504ede7', 1],
    ['0x88d07558470484c03d3bb44c3ecc36cafcf43253', 1],
    ['0xa5a0b6598b90d214eaf4d7a6b72d5a89c3b9a72c', 1],
    ['0xe42382d005a620faaa1b82543c9c04ed79db03ba', 1],
    ['0xcf5938ca6d9f19c73010c7493e19c02acfa8d24d', 1],
    ['0xf7c3b4e1edcb00f0230bfe03d937e26a5e654fd4', 1],
    ['0xfbf87d2c22d1d298298ab5b0ec957583a2731d15', 1],
    ['0xb34d43ada4105ff71e89b8b22a8b9562e78f01e3', 1],
    ['0xbbcd2045ac43f79e8494600e72ca8af455e309dd', 1],
    ['0x1e0c21296bf29ee2d56e0abbdfbbedf2530a7c9a', 1],
  ];

  // See tx: 0xeb4fe40d2dbc9ca0780439f2817bcc795ef0ea5f26cf5bd67fc8e3bedd601312
  const arbitrumRootGauges: [address: string, expectedCheckpoints: number][] = [
    ['0x359ea8618c405023fc4b98dab1b01f373792a126', 1],
    ['0xf0ea3559cf098455921d74173da83ff2f6979495', 1],
    ['0x68ebb057645258cc62488fd198a0f0fa3fd6e8fb', 1],
    ['0x6f825c8bbf67ebb6bc35cf2071dacd2864c3258e', 1],
    ['0x87ae77a8270f223656d9dc40ad51aabfab424b30', 1],
  ];

  // See tx: 0xeb4fe40d2dbc9ca0780439f2817bcc795ef0ea5f26cf5bd67fc8e3bedd601312
  const optimismRootGauges: [address: string, expectedCheckpoints: number][] = [
    ['0xfb0265841c49a6b19d70055e596b212b0da3f606', 1],
    ['0x8b815a11d0d9eeee6861d1c5510d6faa2c6e3feb', 1],
    ['0x78f50cf01a2fd78f04da1d9acf14a51487ec0347', 1],
  ];

  type GaugeData = {
    address: string;
    weight: BigNumber;
    expectedCheckpoints: number;
  };

  const gauges = new Map<GaugeType, GaugeData[]>();

  before('run task', async () => {
    task = new Task('20230123-l2-gauge-checkpointer-v2', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    L2GaugeCheckpointer = await task.deployedInstance('L2GaugeCheckpointer');
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
  });

  before('get timelock authorizer', async () => {
    const timelockTask = new Task('20221202-timelock-authorizer', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizer = await timelockTask.deployedInstance('TimelockAuthorizer');
    migrator = await timelockTask.deployedInstance('TimelockAuthorizerMigrator');

    const adaptorEntrypointTask = new Task('20221124-authorizer-adaptor-entrypoint', TaskMode.READ_ONLY, 'mainnet');
    adaptorEntrypoint = await adaptorEntrypointTask.deployedInstance('AuthorizerAdaptorEntrypoint');
  });

  before('change authorizer admin to the DAO multisig', async () => {
    await migrator.startRootTransfer();

    daoMultisig = await impersonate(DAO_MULTISIG, fp(100));
    await authorizer.connect(daoMultisig).claimRoot();

    const authorizerTask = new Task('20210418-authorizer', TaskMode.READ_ONLY, getForkedNetwork(hre));
    oldAuthorizer = await authorizerTask.deployedInstance('Authorizer');
    expect(await migrator.oldAuthorizer()).to.be.eq(oldAuthorizer.address);

    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');

    const setAuthorizerActionId = await actionId(vault, 'setAuthorizer');
    await oldAuthorizer.connect(daoMultisig).grantRolesToMany([setAuthorizerActionId], [migrator.address]);

    await migrator.finalizeMigration();
  });

  before('get gauge relative weights and associate them with their respective address', async () => {
    const gaugeControllerTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    const gaugeController = await gaugeControllerTask.deployedInstance('GaugeController');

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
    const optimismRootGaugesData: GaugeData[] = await getGaugesData(optimismRootGauges);

    gauges.set(GaugeType.Polygon, polygonRootGaugesData);
    gauges.set(GaugeType.Arbitrum, arbitrumRootGaugesData);
    gauges.set(GaugeType.Optimism, optimismRootGaugesData);
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
    const govMultisig = await impersonate(DAO_MULTISIG, fp(100));

    await authorizer
      .connect(govMultisig)
      .grantPermissions(
        [await adaptorEntrypoint.getActionId(gauge.interface.getSighash('checkpoint'))],
        L2GaugeCheckpointer.address,
        [await authorizer.EVERYWHERE()]
      );
  });

  it('checks that gauges were added correctly', async () => {
    for (const [gaugeType, gaugesData] of gauges.entries()) {
      expect(await L2GaugeCheckpointer.getTotalGauges(gaugeType)).to.be.eq(gaugesData.length);
    }
  });

  describe('getTotalBridgeCost', () => {
    function itChecksTotalBridgeCost(minRelativeWeight: BigNumber) {
      it('checks total bridge cost', async () => {
        const arbitrumGauge = await task.instanceAt('ArbitrumRootGauge', gauges.get(GaugeType.Arbitrum)![0].address);

        const gaugesAmountAboveMinWeight = getGaugeDataAboveMinWeight(GaugeType.Arbitrum, minRelativeWeight).length;
        const singleGaugeBridgeCost = await arbitrumGauge.getTotalBridgeCost();

        // Bridge cost per gauge is always the same, so total cost is (single gauge cost) * (number of gauges).
        expect(await L2GaugeCheckpointer.getTotalBridgeCost(minRelativeWeight)).to.be.eq(
          singleGaugeBridgeCost.mul(gaugesAmountAboveMinWeight)
        );
      });
    }

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
    let gaugeDataAboveMinWeight: GaugeData[] = [];

    sharedBeforeEach(() => {
      // Gauges that are above a threshold will get another checkpoint attempt when the threshold is lowered.
      // This block takes a snapshot so that gauges can be repeatedly checkpointed without skipping.
    });

    context('when threshold is 1', () => {
      itCheckpointsGaugesAboveRelativeWeight(fp(1), 0);
    });

    context('when threshold is 0.0001', () => {
      itCheckpointsGaugesAboveRelativeWeight(fp(0.0001), 15);
    });

    context('when threshold is 0', () => {
      itCheckpointsGaugesAboveRelativeWeight(fp(0), 18);
    });

    function itCheckpointsGaugesAboveRelativeWeight(minRelativeWeight: BigNumber, gaugesAboveThreshold: number) {
      beforeEach('get non-checkpointed gauges above min weight', async () => {
        gaugeDataAboveMinWeight = [
          ...getGaugeDataAboveMinWeight(GaugeType.Polygon, minRelativeWeight),
          ...getGaugeDataAboveMinWeight(GaugeType.Arbitrum, minRelativeWeight),
          ...getGaugeDataAboveMinWeight(GaugeType.Optimism, minRelativeWeight),
        ];

        expect(gaugeDataAboveMinWeight.length).to.be.eq(gaugesAboveThreshold);
      });

      const checkpointInterface = new ethers.utils.Interface([
        'function checkpoint()',
        'event Checkpoint(uint256 indexed periodTime, uint256 periodEmissions)',
      ]);

      it('performs a checkpoint for (non-checkpointed) gauges', async () => {
        const tx = await L2GaugeCheckpointer.checkpointGaugesAboveRelativeWeight(minRelativeWeight, {
          value: await L2GaugeCheckpointer.getTotalBridgeCost(minRelativeWeight),
        });
        const receipt = await tx.wait();

        // Check that the right amount of checkpoints were actually performed for every gauge that required them.
        gaugeDataAboveMinWeight.forEach((gaugeData) => {
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

  function getGaugeDataAboveMinWeight(gaugeType: GaugeType, fpMinRelativeWeight: BigNumber): GaugeData[] {
    return gauges.get(gaugeType)!.filter((addressWeight) => addressWeight.weight.gte(fpMinRelativeWeight));
  }
});
