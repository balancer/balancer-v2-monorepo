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
  let L2GaugeCheckpointer: Contract;
  let vault: Contract, authorizer: Contract, authorizerAdaptor: Contract;

  let task: Task;

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  // Gauges that are NOT killed.
  const polygonRootGauges = [
    '0xa5a0b6598b90d214eaf4d7a6b72d5a89c3b9a72c',
    '0x88d07558470484c03d3bb44c3ecc36cafcf43253',
    '0xfbf87d2c22d1d298298ab5b0ec957583a2731d15',
    '0xc6fb8c72d3bd24fc4891c51c2cb3a13f49c11335',
    '0x5a3970e3145bbba4838d1a3a31c79bcd35a16a9e',
    '0xc3bb46b8196c3f188c6a373a6c4fde792ca78653',
    '0xa80d514734e57691f45af76bb44d1202858fd1f0',
    '0x211c27a32e686659566c3cee6035c2343d823aab',
    '0x397649ff00de6d90578144103768aaa929ef683d',
    '0xd27cb689083e97847dc91c64efc91c4445d46d47',
    '0xf01541837cf3a64bc957f53678b0ab113e92911b',
    '0xead3c3b6c829d54ad0a4c18762c567f728ef0535',
    '0xcf5938ca6d9f19c73010c7493e19c02acfa8d24d',
    '0xd13a839bb48d69a296a1fa6d615b6c39b170096b',
  ];

  const arbitrumRootGauges = [
    '0xF0ea3559Cf098455921d74173dA83fF2f6979495',
    '0xB0de49429fBb80c635432bbAD0B3965b28560177',
    '0x359EA8618c405023Fc4B98dAb1B01F373792a126',
    '0xc77E5645Dbe48d54afC06655e39D3Fe17eB76C1c',
    '0x899F737750db562b88c1E412eE1902980D3a4844',
    '0x6cb1A77AB2e54d4560fda893E9c738ad770da0B0',
    '0x6823DcA6D70061F2AE2AAA21661795A2294812bF',
    '0xACFDA9Fd773C23c01f5d0CAE304CBEbE6b449677',
    '0x68EBB057645258Cc62488fD198A0f0fa3FD6e8fb',
  ];

  // This one was not added to the GaugeController, so we will not be using it. Adding it here for completion only.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const optimismRootGauges = ['0x0256B02F3b19e71AF03B4e2A6731ca35106f5439'];

  type AddressWeightPair = {
    address: string;
    weight: BigNumber;
  };

  const gauges = new Map<GaugeType, AddressWeightPair[]>();

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

    const getGaugesAddressPair = async (gaugeAddresses: string[]) => {
      return Promise.all(
        gaugeAddresses.map(async (gaugeAddress) => {
          return {
            address: gaugeAddress,
            weight: await gaugeController['gauge_relative_weight(address)'](gaugeAddress),
          };
        })
      );
    };
    const polygonRootGaugesAddressWeights: AddressWeightPair[] = await getGaugesAddressPair(polygonRootGauges);
    const arbitrumRootGaugesAddressWeights: AddressWeightPair[] = await getGaugesAddressPair(arbitrumRootGauges);

    // There are no optimism gauges that are correctly added to the Gauge Adder and the Gauge Controller at this point.
    gauges.set(GaugeType.Polygon, polygonRootGaugesAddressWeights);
    gauges.set(GaugeType.Arbitrum, arbitrumRootGaugesAddressWeights);
  });

  before('add gauges to checkpointer', async () => {
    await Promise.all(
      Array.from(gauges).map(([gaugeType, addressWeightPairs]) => {
        L2GaugeCheckpointer.addGauges(
          gaugeType,
          addressWeightPairs.map((addressWeightPair) => addressWeightPair.address)
        );
      })
    );
  });

  before('grant checkpoint permission to fees gauge checkpointer', async () => {
    // Any gauge works; we just need the interface.
    const gauge = await task.instanceAt('IStakelessGauge', polygonRootGauges[0]);
    const govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    await authorizer
      .connect(govMultisig)
      .grantRole(
        await authorizerAdaptor.getActionId(gauge.interface.getSighash('checkpoint')),
        L2GaugeCheckpointer.address
      );
  });

  it('checks that gauges were added correctly', async () => {
    for (const [gaugeType, gaugeAddresses] of gauges.entries()) {
      expect(await L2GaugeCheckpointer.getTotalGauges(gaugeType)).to.be.eq(gaugeAddresses.length);
    }
  });

  itChecksTotalBridgeCost([1, 0.0001, 0]);

  describe('performs checkpoints with successively lower minimum relative weights', () => {
    itCheckpointsGaugesAboveRelativeWeight([1, 0.0001, 0]);
  });

  function itChecksTotalBridgeCost(minRelativeWeights: number[]) {
    minRelativeWeights.forEach((minRelativeWeight) => {
      const normalizedMinRelativeWeight = fp(minRelativeWeight);
      it(`checks total bridge cost for min weight: ${minRelativeWeight}`, async () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const gaugesAboveMinWeight = getGaugeAddressesAboveMinWeight(GaugeType.Arbitrum, normalizedMinRelativeWeight);
        const arbitrumGauge = await task.instanceAt('ArbitrumRootGauge', arbitrumRootGauges[0]);
        const singleGaugeBridgeCost = await arbitrumGauge.getTotalBridgeCost();

        expect(await L2GaugeCheckpointer.getTotalBridgeCost(normalizedMinRelativeWeight)).to.be.almostEqual(
          singleGaugeBridgeCost * gaugesAboveMinWeight.length
        );
      });
    });
  }

  function itCheckpointsGaugesAboveRelativeWeight(minRelativeWeights: number[]) {
    const checkpointedAddresses: string[] = [];
    let addressesAboveMinWeight: string[] = [];
    let fpMinRelativeWeight: BigNumber;
    const gaugeCheckpointInterface = new ethers.utils.Interface([
      'function checkpoint()',
      'event Checkpoint(uint256 indexed periodTime, uint256 periodEmissions)',
    ]);

    minRelativeWeights.forEach((minRelativeWeight) => {
      context(`with min relative weight ${minRelativeWeight}`, () => {
        before('get gauges above min weight', () => {
          fpMinRelativeWeight = fp(minRelativeWeight);
          addressesAboveMinWeight = [
            ...getGaugeAddressesAboveMinWeight(GaugeType.Polygon, fpMinRelativeWeight),
            ...getGaugeAddressesAboveMinWeight(GaugeType.Arbitrum, fpMinRelativeWeight),
          ];
        });

        after('mark checkpointed gauges to consider in the next iteration', () => {
          checkpointedAddresses.push(...addressesAboveMinWeight);
        });

        it('performs a checkpoint for (non-checkpointed) gauges', async () => {
          const tx = await L2GaugeCheckpointer.checkpointGaugesAboveRelativeWeight(fpMinRelativeWeight, {
            value: await L2GaugeCheckpointer.getTotalBridgeCost(fpMinRelativeWeight),
          });
          const receipt = await tx.wait();

          // Only gauges that haven't been checkpointed so far should have been covered in this test iteration.
          const gaugesToCheckpoint = addressesAboveMinWeight.filter(
            (address) => !checkpointedAddresses.includes(address)
          );
          gaugesToCheckpoint.forEach((address) => {
            expectEvent.inIndirectReceipt(receipt, gaugeCheckpointInterface, 'Checkpoint', {}, address);
          });
        });
      });
    });
  }

  function getGaugeAddressesAboveMinWeight(gaugeType: GaugeType, fpMinRelativeWeight: BigNumber): string[] {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return gauges
      .get(gaugeType)!
      .filter((addressWeight) => {
        return addressWeight.weight.gte(fpMinRelativeWeight);
      })
      .map((addressWeights) => addressWeights.address);
  }
});
