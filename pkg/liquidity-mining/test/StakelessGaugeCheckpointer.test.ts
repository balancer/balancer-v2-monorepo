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
import { WEEK, currentWeekTimestamp } from '@balancer-labs/v2-helpers/src/time';

describe('StakelessGaugeCheckpointer', () => {
  let vault: Vault;
  let adaptorEntrypoint: Contract;
  let gaugeController: Contract;
  let gaugeAdder: Contract;
  let stakelessGaugeCheckpointer: Contract;

  const gauges = new Map<string, string[]>();
  let admin: SignerWithAddress, other: SignerWithAddress;

  let testGaugeType: string, otherGaugeType: string;
  let testGauges: string[], otherTypeGauges: string[];

  const GAUGES_PER_TYPE = 3;
  const FIRST_VALID_GAUGE = GaugeType.Ethereum;

  // Allowed gauges: Ethereum, Polygon, Arbitrum, Optimism, Gnosis, ZKSync.
  const GAUGE_TYPES = Object.values(GaugeType)
    .filter((v) => !isNaN(Number(v)) && Number(v) >= FIRST_VALID_GAUGE)
    .map((t) => GaugeType[Number(t)]);

  const UNSUPPORTED_GAUGE_TYPES = ['Extra network not present in GaugeAdder'];

  before('setup signers', async () => {
    [, other, admin] = await ethers.getSigners();
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

    const addGaugeTypeAction = await actionId(gaugeAdder, 'addGaugeType');
    await vault.grantPermissionGlobally(addGaugeTypeAction, admin);

    const action = await actionId(gaugeAdder, 'setGaugeFactory');
    await vault.grantPermissionGlobally(action, admin);

    await Promise.all(GAUGE_TYPES.map((gaugeType) => gaugeAdder.connect(admin).addGaugeType(gaugeType)));

    await Promise.all(
      gaugeFactories.map((factory) => gaugeAdder.connect(admin).setGaugeFactory(factory.contract.address, factory.type))
    );

    // Create some gauges from each factory.
    await Promise.all(
      gaugeFactories.map(async (factory) =>
        gauges.set(factory.type, await createGauges(factory.contract, GAUGES_PER_TYPE))
      )
    );
  });

  sharedBeforeEach(async () => {
    stakelessGaugeCheckpointer = await deploy('StakelessGaugeCheckpointer', {
      args: [gaugeAdder.address, adaptorEntrypoint.address],
    });
  });

  describe('getters', () => {
    it('returns gauge adder', async () => {
      expect(await stakelessGaugeCheckpointer.getGaugeAdder()).to.be.eq(gaugeAdder.address);
    });

    it('returns rounded down block timestamp', async () => {
      expect(await stakelessGaugeCheckpointer.getRoundedDownBlockTimestamp()).to.be.eq(
        (await currentWeekTimestamp()).sub(WEEK)
      );
    });
  });

  GAUGE_TYPES.forEach((gaugeType) => {
    itAddsAndRemovesGaugesForType(gaugeType);
  });

  UNSUPPORTED_GAUGE_TYPES.forEach((gaugeType) => {
    itTestsUnsupportedGaugeType(gaugeType);
  });

  function itTestsUnsupportedGaugeType(gaugeType: string) {
    describe(`test unsupported gauge type: ${gaugeType}`, () => {
      it('reverts adding gauge', async () => {
        await expect(stakelessGaugeCheckpointer.addGauges(gaugeType, [ANY_ADDRESS])).to.be.revertedWith(
          'Invalid gauge type'
        );
      });

      it('reverts removing gauge', async () => {
        await expect(stakelessGaugeCheckpointer.removeGauges(gaugeType, [ANY_ADDRESS])).to.be.revertedWith(
          'Invalid gauge type'
        );
      });

      it('reverts checking if it has gauge', async () => {
        await expect(stakelessGaugeCheckpointer.hasGauge(gaugeType, ANY_ADDRESS)).to.be.revertedWith(
          'Invalid gauge type'
        );
      });

      it('reverts getting total gauge gauges', async () => {
        await expect(stakelessGaugeCheckpointer.getTotalGauges(gaugeType)).to.be.revertedWith('Invalid gauge type');
      });

      it('reverts getting gauge at index', async () => {
        await expect(stakelessGaugeCheckpointer.getGaugeAtIndex(gaugeType, 0)).to.be.revertedWith('Invalid gauge type');
      });
    });
  }

  function itAddsAndRemovesGaugesForType(gaugeType: string) {
    let addGauges: (gaugeType: string, gauges: string[]) => Promise<Contract>;

    sharedBeforeEach(`setup test gauges for ${gaugeType}`, async () => {
      testGaugeType = gaugeType;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      testGauges = gauges.get(testGaugeType)!;
      otherGaugeType = getNextTestGaugeType(testGaugeType);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      otherTypeGauges = gauges.get(otherGaugeType)!;
    });

    describe('addGauge', () => {
      sharedBeforeEach(async () => {
        addGauges = (gaugeType, gauges) => stakelessGaugeCheckpointer.addGauges(gaugeType, gauges);
      });

      function itRevertsAddingMismatchingType() {
        it("reverts if the given gauge type does not match gauges' type registered in gauge adder", async () => {
          await expect(addGauges(otherGaugeType, testGauges)).to.be.revertedWith(
            'Gauge does not correspond to the selected type'
          );
        });
      }

      itAddsGauges(itRevertsAddingMismatchingType);
    });

    describe('addGaugeWithVerifiedType', () => {
      sharedBeforeEach(async () => {
        const action = await actionId(stakelessGaugeCheckpointer, 'addGaugesWithVerifiedType');
        await vault.grantPermissionGlobally(action, admin);

        addGauges = (gaugeType, gauges) =>
          stakelessGaugeCheckpointer.connect(admin).addGaugesWithVerifiedType(gaugeType, gauges);
      });

      function itAddsMismatchingType() {
        it('works even if the gauge does not come from the factory registered in gauge adder', async () => {
          await addGauges(otherGaugeType, testGauges);
          await expectHasGauges(otherGaugeType, testGauges);
        });
      }

      itAddsGauges(itAddsMismatchingType);

      it('reverts when caller is not authorized', async () => {
        await expect(
          stakelessGaugeCheckpointer.connect(other).addGaugesWithVerifiedType(gaugeType, testGauges)
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    function itAddsGauges(handleAddMismatchingTypeGauges: () => void) {
      describe(`add gauges for ${gaugeType}`, () => {
        // Gauges must come from a valid factory to be added to the gauge controller, so gauges that don't pass the valid
        // factory check will be rejected by the controller.
        context('with incorrect factory and controller setup', () => {
          it('reverts', async () => {
            await expect(addGauges(otherGaugeType, testGauges)).to.be.revertedWith(
              'Gauge was not added to the GaugeController'
            );
          });
        });

        context('with correct factory and wrong controller setup', () => {
          it('reverts', async () => {
            await expect(addGauges(testGaugeType, testGauges)).to.be.revertedWith(
              'Gauge was not added to the GaugeController'
            );
          });
        });

        context('with correct factory and controller setup', () => {
          sharedBeforeEach('add gauges to controller', async () => {
            await addGaugesToController(gaugeController, testGauges);
          });

          it('adds stakeless gauges correctly', async () => {
            await addGauges(testGaugeType, testGauges);
            await expectHasGauges(testGaugeType, testGauges);
          });

          it('does not modify any gauge to other gauge types', async () => {
            await expectOtherGaugeTypesEmpty([]);
            await addGauges(testGaugeType, testGauges);
            await expectOtherGaugeTypesEmpty([testGaugeType]);
          });

          it('emits one event per added gauge', async () => {
            const tx = await addGauges(testGaugeType, testGauges);
            const receipt = await tx.wait();
            expect(receipt.events.length).to.be.eq(testGauges.length);

            for (let i = 0; i < testGauges.length; ++i) {
              const testGauge = testGauges[i];

              // `expectEvent` does not work with indexed strings, so we decode the pieces we are interested in manually.
              // Each event should be named `GaugeAdded`
              const event = receipt.events[i];
              expect(event.event).to.be.eq('GaugeAdded');

              // Contains expected `gaugeType` (decoded) and `gauge` (first argument, raw).
              const decodedArgs = event.decode(event.data);
              expect(decodedArgs.gaugeType).to.be.eq(testGaugeType);
              expect(event.args[0]).to.be.eq(testGauge);
            }
          });

          it('enumerates added gauges correctly', async () => {
            await addGauges(testGaugeType, testGauges);
            await expectGaugesAt(testGaugeType, testGauges);
          });

          handleAddMismatchingTypeGauges();

          context('when one of the gauges to add was killed', () => {
            sharedBeforeEach('kill one gauge', async () => {
              const gaugeContract = await deployedAt('MockLiquidityGauge', testGauges[0]);
              await gaugeContract.killGauge();
            });

            it('reverts', async () => {
              await expect(addGauges(testGaugeType, testGauges)).to.be.revertedWith('Gauge was killed');
            });
          });

          context('when one of the gauges to add was already added to the checkpointer', () => {
            sharedBeforeEach('add gauges beforehand', async () => {
              await addGauges(testGaugeType, testGauges);
            });

            it('reverts', async () => {
              await expect(addGauges(testGaugeType, testGauges)).to.be.revertedWith(
                'Gauge already added to the checkpointer'
              );
            });
          });
        });
      });
    }

    describe(`remove gauges for ${gaugeType}`, () => {
      sharedBeforeEach('add gauges to the gauge controller and the checkpointer', async () => {
        await addGaugesToController(gaugeController, testGauges);
        await stakelessGaugeCheckpointer.addGauges(testGaugeType, testGauges);
        await addGaugesToController(gaugeController, otherTypeGauges);
        await stakelessGaugeCheckpointer.addGauges(otherGaugeType, otherTypeGauges);
      });

      context('with stakeless gauges that were not killed', () => {
        it('reverts', async () => {
          await expect(stakelessGaugeCheckpointer.removeGauges(testGaugeType, testGauges)).to.be.revertedWith(
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
          await stakelessGaugeCheckpointer.removeGauges(testGaugeType, testGauges);
          await expectHasGauges(testGaugeType, []);
        });

        it('does not modify gauges from other types', async () => {
          await expectOtherGaugeTypesEmpty([testGaugeType, otherGaugeType]);
          await stakelessGaugeCheckpointer.removeGauges(testGaugeType, testGauges);
          await expectOtherGaugeTypesEmpty([otherGaugeType]);
          await expectHasGauges(otherGaugeType, otherTypeGauges);
        });

        it('emits one event per gauge removed', async () => {
          const tx = await stakelessGaugeCheckpointer.removeGauges(testGaugeType, testGauges);
          const receipt = await tx.wait();
          for (let i = 0; i < testGauges.length; ++i) {
            const testGauge = testGauges[i];

            // `expectEvent` does not work with indexed strings, so we decode the pieces we are interested in manually.
            // Each event should be named `GaugeAdded`
            const event = receipt.events[i];
            expect(event.event).to.be.eq('GaugeRemoved');

            // Contains expected `gaugeType` (decoded) and `gauge` (first argument, raw).
            const decodedArgs = event.decode(event.data);
            expect(decodedArgs.gaugeType).to.be.eq(testGaugeType);
            expect(event.args[0]).to.be.eq(testGauge);
          }
        });

        it('reverts if at least one gauge was not added to the checkpointer', async () => {
          const emptyGaugeType = getNextTestGaugeType(testGaugeType);
          await expect(stakelessGaugeCheckpointer.removeGauges(emptyGaugeType, testGauges)).to.be.revertedWith(
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
  async function expectHasGauges(gaugeType: string, gauges: string[]) {
    expect(await stakelessGaugeCheckpointer.getTotalGauges(gaugeType)).to.be.eq(gauges.length);
    for (let i = 0; i < gauges.length; i++) {
      expect(await stakelessGaugeCheckpointer.hasGauge(gaugeType, gauges[i])).to.be.true;
    }
  }

  /**
   * Checks that a given array of addresses are an exact match of the gauges added for a gauge type.
   * @param gaugeType Gauge type to check.
   * @param gauges Addresses to match for gauge type.
   */
  async function expectGaugesAt(gaugeType: string, gauges: string[]) {
    expect(await stakelessGaugeCheckpointer.getTotalGauges(gaugeType)).to.be.eq(gauges.length);
    for (let i = 0; i < gauges.length; i++) {
      expect(await stakelessGaugeCheckpointer.getGaugeAtIndex(gaugeType, i)).to.be.eq(gauges[i]);
    }
  }

  /**
   * Checks that all gauge types not included in the given array have no added gauges.
   * @param testGaugeTypes Gauge types to exclude from the check.
   */
  async function expectOtherGaugeTypesEmpty(testGaugeTypes: string[]) {
    expect(
      await Promise.all(
        GAUGE_TYPES.filter((gaugeType) => !testGaugeTypes.includes(gaugeType)).map((gaugeType) =>
          stakelessGaugeCheckpointer.getTotalGauges(gaugeType)
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
   * @param amount Number of gauges to create.
   * @returns A promise with the array of addresses corresponding to the created gauges.
   */
  async function createGauges(factory: Contract, amount: number): Promise<string[]> {
    const randomAddresses = await range(amount).map(randomAddress);
    const txArray = await Promise.all(randomAddresses.map((address) => factory.create(address, fp(1)))); // No weight cap.
    const receipts = await Promise.all(txArray.map((tx) => tx.wait()));
    return receipts.map((receipt) => expectEvent.inReceipt(receipt, 'GaugeCreated').args.gauge);
  }

  /**
   * Returns the next gauge type as in a circular array.
   */
  function getNextTestGaugeType(gaugeType: string): string {
    return GAUGE_TYPES[(GAUGE_TYPES.indexOf(gaugeType) + 1) % GAUGE_TYPES.length];
  }
});
