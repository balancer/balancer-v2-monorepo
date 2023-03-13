import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { expect } from 'chai';
import { ANY_ADDRESS, randomAddress, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { GaugeType } from '@balancer-labs/balancer-js/src/types';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { range } from 'lodash';

describe('L2GaugeCheckpointer', () => {
  let vault: Vault;
  let adaptorEntrypoint: Contract;
  let gaugeController: Contract;
  let gaugeAdder: Contract;
  let L2GaugeCheckpointer: Contract;

  const gauges = new Map<number, string[]>();
  let admin: SignerWithAddress;

  let testGaugeType: GaugeType, otherGaugeType: GaugeType;
  let testGauges: string[], otherTypeGauges: string[];

  const GAUGES_PER_TYPE = 3;
  const FIRST_VALID_GAUGE = GaugeType.Polygon;

  // Allowed gauges: Polygon, Arbitrum, Optimism, Gnosis, ZKSync.
  const GAUGE_TYPES = Object.values(GaugeType)
    .filter((v) => !isNaN(Number(v)) && v >= FIRST_VALID_GAUGE)
    .map((t) => Number(t));

  const UNSUPPORTED_GAUGE_TYPES = Object.values(GaugeType)
    .filter((v) => !isNaN(Number(v)) && v < FIRST_VALID_GAUGE)
    .map((t) => Number(t));

  before('setup signers', async () => {
    [, admin] = await ethers.getSigners();
  });

  before('deploy dependencies: gauge controller and gauge factories', async () => {
    // Basics: vault, authorizer adaptor and gauge controller.
    vault = await Vault.create({ admin });
    const adaptor = vault.authorizerAdaptor;
    adaptorEntrypoint = vault.authorizerAdaptorEntrypoint;

    gaugeController = await deploy('MockGaugeController', { args: [ZERO_ADDRESS, adaptor.address] });
    // Allow all gauge types in the controller.
    await Promise.all(GAUGE_TYPES.concat(UNSUPPORTED_GAUGE_TYPES).map(() => gaugeController.add_type('0x', 0)));

    const gaugeImplementation = await deploy('MockLiquidityGauge');
    // Gauge factories creation: one per gauge type.
    const gaugeFactories = await Promise.all(
      GAUGE_TYPES.map(async (gaugeType) => {
        return {
          type: gaugeType,
          contract: await deploy('MockLiquidityGaugeFactory', { args: [gaugeImplementation.address] }),
        };
      })
    );

    // Gauge adder & add factories to gauge adder.
    gaugeAdder = await deploy('GaugeAdder', {
      args: [gaugeController.address, adaptorEntrypoint.address],
    });
    const action = await actionId(gaugeAdder, 'addGaugeFactory');
    await vault.grantPermissionGlobally(action, admin);

    await Promise.all(
      gaugeFactories.map((factory) => gaugeAdder.connect(admin).addGaugeFactory(factory.contract.address, factory.type))
    );

    // Create some gauges from each factory.
    await Promise.all(
      gaugeFactories.map(async (factory) =>
        gauges.set(factory.type, await createGauges(factory.contract, factory.type, GAUGES_PER_TYPE))
      )
    );
  });

  sharedBeforeEach('deploy L2 gauge checkpointer', async () => {
    L2GaugeCheckpointer = await deploy('L2GaugeCheckpointer', {
      args: [gaugeController.address, adaptorEntrypoint.address],
    });
  });

  GAUGE_TYPES.forEach((gaugeType) => {
    itAddsAndRemovesGaugesForType(gaugeType);
  });

  UNSUPPORTED_GAUGE_TYPES.forEach((gaugeType) => {
    itTestsUnsupportedGaugeType(gaugeType);
  });

  function itTestsUnsupportedGaugeType(gaugeType: GaugeType) {
    const REVERT_MSG = 'Unsupported gauge type';

    describe(`test unsupported gauge type: ${GaugeType[gaugeType]}`, () => {
      it('reverts adding gauge', async () => {
        await expect(L2GaugeCheckpointer.addGauges(gaugeType, [ANY_ADDRESS])).to.be.revertedWith(REVERT_MSG);
      });

      it('reverts removing gauge', async () => {
        await expect(L2GaugeCheckpointer.removeGauges(gaugeType, [ANY_ADDRESS])).to.be.revertedWith(REVERT_MSG);
      });

      it('reverts checking if it has gauge', async () => {
        await expect(L2GaugeCheckpointer.hasGauge(gaugeType, ANY_ADDRESS)).to.be.revertedWith(REVERT_MSG);
      });

      it('reverts getting total gauge gauges', async () => {
        await expect(L2GaugeCheckpointer.getTotalGauges(gaugeType)).to.be.revertedWith(REVERT_MSG);
      });

      it('reverts getting gauge at index', async () => {
        await expect(L2GaugeCheckpointer.getGaugeAtIndex(gaugeType, 0)).to.be.revertedWith(REVERT_MSG);
      });
    });
  }

  function itAddsAndRemovesGaugesForType(gaugeType: GaugeType) {
    sharedBeforeEach(`setup test gauges for ${GaugeType[gaugeType]}`, async () => {
      testGaugeType = gaugeType;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      testGauges = gauges.get(testGaugeType)!;
      otherGaugeType = getNextTestGaugeType(testGaugeType);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      otherTypeGauges = gauges.get(otherGaugeType)!;
    });

    describe(`add gauges for ${GaugeType[gaugeType]}`, () => {
      // Gauges must come from a valid factory to be added to the gauge controller, so gauges that don't pass the valid
      // factory check will be rejected by the controller.
      context('with incorrect factory and controller setup', () => {
        it('reverts', async () => {
          const otherGaugeType = GaugeType.Optimism;
          await expect(L2GaugeCheckpointer.addGauges(otherGaugeType, testGauges)).to.be.revertedWith(
            'Gauge was not added to the GaugeController'
          );
        });
      });

      context('with correct factory and wrong controller setup', () => {
        it('reverts', async () => {
          await expect(L2GaugeCheckpointer.addGauges(testGaugeType, testGauges)).to.be.revertedWith(
            'Gauge was not added to the GaugeController'
          );
        });
      });

      context('with correct factory and controller setup', () => {
        sharedBeforeEach('add gauges to controller', async () => {
          await addGaugesToController(gaugeController, testGauges);
        });

        it('adds stakeless gauges correctly', async () => {
          await L2GaugeCheckpointer.addGauges(testGaugeType, testGauges);
          await expectHasGauges(testGaugeType, testGauges);
        });

        it('does not modify any gauge to other gauge types', async () => {
          await expectOtherGaugeTypesEmpty([]);
          await L2GaugeCheckpointer.addGauges(testGaugeType, testGauges);
          await expectOtherGaugeTypesEmpty([testGaugeType]);
        });

        it('emits one event per added gauge', async () => {
          const tx = await L2GaugeCheckpointer.addGauges(testGaugeType, testGauges);
          const receipt = await tx.wait();
          for (const testGauge of testGauges) {
            expectEvent.inReceipt(receipt, 'GaugeAdded', { gaugeType: testGaugeType, gauge: testGauge });
          }
        });

        it('enumerates added gauges correctly', async () => {
          await L2GaugeCheckpointer.addGauges(testGaugeType, testGauges);
          await expectGaugesAt(testGaugeType, testGauges);
        });

        context('when one of the gauges to add was killed', () => {
          sharedBeforeEach('kill one gauge', async () => {
            const gaugeContract = await deployedAt('MockLiquidityGauge', testGauges[0]);
            await gaugeContract.killGauge();
          });

          it('reverts', async () => {
            await expect(L2GaugeCheckpointer.addGauges(testGaugeType, testGauges)).to.be.revertedWith(
              'Gauge was killed'
            );
          });
        });

        context('when one of the gauges to add was already added to the checkpointer', () => {
          sharedBeforeEach('add gauges beforehand', async () => {
            await L2GaugeCheckpointer.addGauges(testGaugeType, testGauges);
          });

          it('reverts', async () => {
            await expect(L2GaugeCheckpointer.addGauges(testGaugeType, testGauges)).to.be.revertedWith(
              'Gauge already added to the checkpointer'
            );
          });
        });
      });
    });

    describe(`remove gauges for ${GaugeType[gaugeType]}`, () => {
      sharedBeforeEach('add gauges to the gauge controller and the checkpointer', async () => {
        await addGaugesToController(gaugeController, testGauges);
        await L2GaugeCheckpointer.addGauges(testGaugeType, testGauges);
        await addGaugesToController(gaugeController, otherTypeGauges);
        await L2GaugeCheckpointer.addGauges(otherGaugeType, otherTypeGauges);
      });

      context('with stakeless gauges that were not killed', () => {
        it('reverts', async () => {
          await expect(L2GaugeCheckpointer.removeGauges(testGaugeType, testGauges)).to.be.revertedWith(
            'Gauge was not killed'
          );
        });
      });

      context('killing stakeless gauges before removing them', () => {
        sharedBeforeEach('kill stakeless gauges', async () => {
          const gaugeContracts = await Promise.all(testGauges.map((gauge) => deployedAt('MockLiquidityGauge', gauge)));
          await Promise.all(gaugeContracts.map((gaugeContract) => gaugeContract.killGauge()));
        });

        it('removes added stakeless gauges correctly', async () => {
          await expectHasGauges(testGaugeType, testGauges);
          await L2GaugeCheckpointer.removeGauges(testGaugeType, testGauges);
          await expectHasGauges(testGaugeType, []);
        });

        it('does not modify gauges from other types', async () => {
          await expectOtherGaugeTypesEmpty([testGaugeType, otherGaugeType]);
          await L2GaugeCheckpointer.removeGauges(testGaugeType, testGauges);
          await expectOtherGaugeTypesEmpty([otherGaugeType]);
          await expectHasGauges(otherGaugeType, otherTypeGauges);
        });

        it('emits one event per gauge removed', async () => {
          const tx = await L2GaugeCheckpointer.removeGauges(testGaugeType, testGauges);
          const receipt = await tx.wait();
          for (const testGauge of testGauges) {
            expectEvent.inReceipt(receipt, 'GaugeRemoved', { gaugeType: testGaugeType, gauge: testGauge });
          }
        });

        it('reverts if at least one gauge was not added to the checkpointer', async () => {
          const emptyGaugeType = getNextTestGaugeType(testGaugeType);
          await expect(L2GaugeCheckpointer.removeGauges(emptyGaugeType, testGauges)).to.be.revertedWith(
            'Gauge was not added to the checkpointer'
          );
        });
      });
    });
  }

  /**
   * Checks that the given addresses were added for a gauge type.
   * @param gaugeType Gauge type to check.
   * @param gauges Addresses to check for gauge type.
   */
  async function expectHasGauges(gaugeType: GaugeType, gauges: string[]) {
    expect(await L2GaugeCheckpointer.getTotalGauges(gaugeType)).to.be.eq(gauges.length);
    for (let i = 0; i < gauges.length; i++) {
      expect(await L2GaugeCheckpointer.hasGauge(gaugeType, gauges[i])).to.be.true;
    }
  }

  /**
   * Checks that a given array of addresses are an exact match of the gauges added for a gauge type.
   * @param gaugeType Gauge type to check.
   * @param gauges Addresses to match for gauge type.
   */
  async function expectGaugesAt(gaugeType: GaugeType, gauges: string[]) {
    expect(await L2GaugeCheckpointer.getTotalGauges(gaugeType)).to.be.eq(gauges.length);
    for (let i = 0; i < gauges.length; i++) {
      expect(await L2GaugeCheckpointer.getGaugeAtIndex(gaugeType, i)).to.be.eq(gauges[i]);
    }
  }

  /**
   * Checks that all gauge types not included in the given array have no added gauges.
   * @param testGaugeTypes Gauge types to exclude from the check.
   */
  async function expectOtherGaugeTypesEmpty(testGaugeTypes: GaugeType[]) {
    expect(
      await Promise.all(
        GAUGE_TYPES.filter((gaugeType) => !testGaugeTypes.includes(gaugeType)).map((gaugeType) =>
          L2GaugeCheckpointer.getTotalGauges(gaugeType)
        )
      )
    ).to.be.deep.eq([...Array(GAUGE_TYPES.length - testGaugeTypes.length).fill(0)]);
  }

  async function addGaugesToController(controller: Contract, gauges: string[]): Promise<void> {
    await Promise.all(gauges.map((gauge) => controller.add_gauge(gauge, 0)));
  }

  /**
   * Creates an array of gauges from the given factory, using pseudo random addresses as input pool addresses.
   * @param factory Gauge factory to create gauges.
   * @param seed Number to start generating the pseudo random addresses. Use different inputs to get different outputs.
   * @param amount Number of gauges to create.
   * @returns A promise with the array of addresses corresponding to the created gauges.
   */
  async function createGauges(factory: Contract, seed: number, amount: number): Promise<string[]> {
    const randomAddresses = await range(amount).map(randomAddress);
    const txArray = await Promise.all(randomAddresses.map((address) => factory.create(address, fp(1)))); // No weight cap.
    const receipts = await Promise.all(txArray.map((tx) => tx.wait()));
    return receipts.map((receipt) => expectEvent.inReceipt(receipt, 'GaugeCreated').args.gauge);
  }

  /**
   * Returns the next gauge type as in a circular array.
   */
  function getNextTestGaugeType(gaugeType: GaugeType): GaugeType {
    return GAUGE_TYPES[(gaugeType + 1) % GAUGE_TYPES.length];
  }
});
