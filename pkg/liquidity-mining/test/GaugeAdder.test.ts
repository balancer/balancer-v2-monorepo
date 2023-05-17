import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expect } from 'chai';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { GaugeType } from '@balancer-labs/balancer-js/src/types';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('GaugeAdder', () => {
  let vault: Vault;
  let gaugeController: Contract;
  let gaugeImplementation: Contract;
  let gaugeFactory: Contract, otherGaugeFactory: Contract;
  let adaptorEntrypoint: Contract;
  let gaugeAdder: Contract;

  let admin: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    vault = await Vault.create({ admin });
    const adaptor = vault.authorizerAdaptor;
    adaptorEntrypoint = vault.authorizerAdaptorEntrypoint;

    gaugeController = await deploy('MockGaugeController', { args: [ZERO_ADDRESS, adaptor.address] });

    gaugeImplementation = await deploy('MockLiquidityGauge');
    gaugeFactory = await deploy('MockLiquidityGaugeFactory', { args: [gaugeImplementation.address] });
    otherGaugeFactory = await deploy('MockLiquidityGaugeFactory', { args: [gaugeImplementation.address] });
    gaugeAdder = await deploy('GaugeAdder', {
      args: [gaugeController.address, adaptorEntrypoint.address],
    });

    await gaugeController.add_type('LiquidityMiningCommittee', 0);
    await gaugeController.add_type('veBAL', 0);
    await gaugeController.add_type('Ethereum', 0);
    await gaugeController.add_type('Polygon', 0);
    await gaugeController.add_type('Arbitrum', 0);
  });

  sharedBeforeEach('set up permissions', async () => {
    const action = await actionId(adaptorEntrypoint, 'add_gauge', gaugeController.interface);
    await vault.grantPermissionGlobally(action, gaugeAdder);
  });

  async function deployGauge(gaugeFactory: Contract, poolAddress: string): Promise<string> {
    const tx = await gaugeFactory.create(poolAddress, fp(1)); // Weight cap can be anything; it's not under test.
    const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

    return event.args.gauge;
  }

  describe('addGaugeType', () => {
    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(gaugeAdder.connect(other).addGaugeType('Ethereum', GaugeType.Ethereum)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('when caller is authorized', () => {
      sharedBeforeEach(async () => {
        const action = await actionId(gaugeAdder, 'addGaugeType');
        await vault.grantPermissionGlobally(action, admin);
      });

      context('with invalid inputs', () => {
        it('reverts when the type number is invalid', async () => {
          await expect(gaugeAdder.connect(admin).addGaugeType('Any', -1)).to.be.revertedWith(
            'Gauge type number has to be greater than 0'
          );
        });

        it('reverts when the type number does not exist in the gauge controller', async () => {
          await expect(
            gaugeAdder.connect(admin).addGaugeType('Some network', (await gaugeController.n_gauge_types()).add(1))
          ).to.be.revertedWith('Gauge type number not present in gauge controller');
        });

        it('reverts when the type name is too long', async () => {
          await expect(
            gaugeAdder
              .connect(admin)
              .addGaugeType('VeryLongAndFancyZKOptimisticRollupPrivateFastScalableAINetwork', GaugeType.Ethereum)
          ).to.be.revertedWith('Input string should be between 1 and 32 characters long');
        });

        it('reverts when the type name empty', async () => {
          await expect(gaugeAdder.connect(admin).addGaugeType('', GaugeType.Ethereum)).to.be.revertedWith(
            'Input string should be between 1 and 32 characters long'
          );
        });
      });

      context('with valid inputs', () => {
        function itAddsNewTypeCorrectly(gaugeType: string, typeNumber: number) {
          it('adds new type correctly', async () => {
            await gaugeAdder.connect(admin).addGaugeType(gaugeType, typeNumber);

            expect(await gaugeAdder.getGaugeTypes()).to.be.deep.eq([gaugeType]);
            expect(await gaugeAdder.getGaugeTypeAtIndex(0)).to.be.eq(gaugeType);
            expect(await gaugeAdder.getGaugeTypesCount()).to.be.eq(1);
            expect(await gaugeAdder.getGaugeTypeNumber(gaugeType)).to.be.eq(typeNumber);
          });

          it('emits an event', async () => {
            const tx = await gaugeAdder.connect(admin).addGaugeType(gaugeType, typeNumber);
            const receipt = await tx.wait();

            // `expectEvent` does not work with indexed strings, so we decode the pieces we are interested in manually.
            // One event in receipt, named `GaugeTypeAdded`
            expect(receipt.events.length).to.be.eq(1);
            const event = receipt.events[0];
            expect(event.event).to.be.eq('GaugeTypeAdded');

            // Contains expected `gaugeType` and `gaugeFactory`.
            const decodedArgs = event.decode(event.data);
            expect(decodedArgs.gaugeType).to.be.eq(gaugeType);
            expect(decodedArgs.gaugeTypeNumber).to.be.eq(typeNumber);
          });

          it('reverts when adding the same type twice', async () => {
            await gaugeAdder.connect(admin).addGaugeType(gaugeType, typeNumber);

            await expect(gaugeAdder.connect(admin).addGaugeType(gaugeType, typeNumber)).to.be.revertedWith(
              'Gauge type already added'
            );
          });
        }

        context('with a regular type name', () => {
          itAddsNewTypeCorrectly('Ethereum', GaugeType.Ethereum);
        });

        context('minimum length type name', () => {
          itAddsNewTypeCorrectly('a', 0);
        });

        context('maximum length type name', () => {
          itAddsNewTypeCorrectly('0'.repeat(32), GaugeType.Ethereum);
        });
      });
    });
  });

  describe('setGaugeFactory', () => {
    sharedBeforeEach('authorize caller to add gauge type', async () => {
      const action = await actionId(gaugeAdder, 'addGaugeType');
      await vault.grantPermissionGlobally(action, admin);
    });

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(gaugeAdder.connect(other).setGaugeFactory(gaugeFactory.address, 'Ethereum')).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('when caller is authorized', () => {
      sharedBeforeEach('authorize caller', async () => {
        const action = await actionId(gaugeAdder, 'setGaugeFactory');
        await vault.grantPermissionGlobally(action, admin);
      });

      context('when gauge type is invalid', () => {
        it('reverts', async () => {
          await expect(gaugeAdder.connect(admin).setGaugeFactory(gaugeFactory.address, 'Polygon')).to.be.revertedWith(
            'Invalid gauge type'
          );
        });
      });

      context('when gauge type is valid', () => {
        let existingGaugeFactory: string, newGaugeFactory: string;

        function itSetsFactoryForGaugeTypeCorrectly() {
          it('stores the new factory address', async () => {
            expect(await gaugeAdder.getFactoryForGaugeType('Ethereum')).to.be.eq(existingGaugeFactory);

            await gaugeAdder.connect(admin).setGaugeFactory(newGaugeFactory, 'Ethereum');

            expect(await gaugeAdder.getFactoryForGaugeType('Ethereum')).to.be.eq(newGaugeFactory);
          });

          it('emits a GaugeFactorySet event', async () => {
            const tx = await gaugeAdder.connect(admin).setGaugeFactory(newGaugeFactory, 'Ethereum');
            const receipt = await tx.wait();

            // `expectEvent` does not work with indexed strings, so we decode the pieces we are interested in manually.
            // One event in receipt, named `GaugeFactorySet`
            expect(receipt.events.length).to.be.eq(1);
            const event = receipt.events[0];
            expect(event.event).to.be.eq('GaugeFactorySet');

            // Contains expected `gaugeType` and `gaugeFactory`.
            const decodedArgs = event.decode(event.data);
            expect(decodedArgs.gaugeType).to.be.eq('Ethereum');
            expect(decodedArgs.gaugeFactory).to.be.eq(newGaugeFactory);
          });
        }

        sharedBeforeEach(async () => {
          await gaugeAdder.connect(admin).addGaugeType('Ethereum', GaugeType.Ethereum);
        });

        context('when factory does not already exist on GaugeAdder', () => {
          sharedBeforeEach('add gauge factory', async () => {
            existingGaugeFactory = ZERO_ADDRESS;
            newGaugeFactory = otherGaugeFactory.address;
          });

          itSetsFactoryForGaugeTypeCorrectly();
        });

        context('when factory already exists on GaugeAdder', () => {
          sharedBeforeEach('add gauge factory', async () => {
            await gaugeAdder.connect(admin).setGaugeFactory(gaugeFactory.address, 'Ethereum');
            existingGaugeFactory = gaugeFactory.address;
            newGaugeFactory = otherGaugeFactory.address;
          });

          itSetsFactoryForGaugeTypeCorrectly();
        });
      });
    });
  });

  describe('isGaugeFromValidFactory', () => {
    let gauge: string;

    sharedBeforeEach('deploy gauge and setup adder', async () => {
      gauge = await deployGauge(gaugeFactory, ANY_ADDRESS);

      const action = await actionId(gaugeAdder, 'addGaugeType');
      await vault.grantPermissionGlobally(action, admin);

      await gaugeAdder.connect(admin).addGaugeType('Ethereum', GaugeType.Ethereum);
      await gaugeAdder.connect(admin).addGaugeType('Polygon', GaugeType.Polygon);
      await gaugeAdder.connect(admin).addGaugeType('Arbitrum', GaugeType.Arbitrum);
    });

    context('when factory has been added to GaugeAdder', () => {
      sharedBeforeEach('add gauge factory', async () => {
        const action = await actionId(gaugeAdder, 'setGaugeFactory');
        await vault.grantPermissionGlobally(action, admin);

        await gaugeAdder.connect(admin).setGaugeFactory(gaugeFactory.address, 'Ethereum');
      });

      it('returns the expected value', async () => {
        expect(await gaugeAdder.isGaugeFromValidFactory(gauge, 'Ethereum')).to.be.true;
        expect(await gaugeAdder.isGaugeFromValidFactory(gauge, 'Polygon')).to.be.false;
        expect(await gaugeAdder.isGaugeFromValidFactory(gauge, 'Arbitrum')).to.be.false;
      });
    });

    context('when factory has not been added to GaugeAdder', () => {
      it('returns the expected value', async () => {
        expect(await gaugeAdder.isGaugeFromValidFactory(gauge, 'Ethereum')).to.be.false;
      });
    });

    context('when the gauge type is invalid', () => {
      it('reverts', async () => {
        await expect(gaugeAdder.isGaugeFromValidFactory(gauge, 'Invalid')).to.be.revertedWith('Invalid gauge type');
      });
    });
  });

  describe('addGauge', () => {
    let gauge: string;

    sharedBeforeEach('deploy gauge', async () => {
      gauge = await deployGauge(gaugeFactory, ANY_ADDRESS);

      const action = await actionId(gaugeAdder, 'addGaugeType');
      await vault.grantPermissionGlobally(action, admin);

      await gaugeAdder.connect(admin).addGaugeType('Ethereum', GaugeType.Ethereum);
    });

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(gaugeAdder.connect(other).addGauge(gauge, 'Ethereum')).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when caller is authorized', () => {
      sharedBeforeEach('authorize caller', async () => {
        const action = await actionId(gaugeAdder, 'addGauge');
        await vault.grantPermissionGlobally(action, admin);
      });

      context('with invalid parameters', () => {
        it('reverts when gauge type is invalid', async () => {
          await expect(gaugeAdder.connect(admin).addGauge(gauge, 'Invalid')).to.be.revertedWith('Invalid gauge type');
        });

        it('reverts when gauge has not been deployed from a valid factory', async () => {
          await expect(gaugeAdder.connect(admin).addGauge(gauge, 'Ethereum')).to.be.revertedWith('Invalid gauge');
        });

        it("reverts when gauge belongs to GaugeController's pool in 'Ethereum' type", async () => {
          const gauge = await deployGauge(gaugeFactory, gaugeController.token());

          await expect(gaugeAdder.connect(admin).addGauge(gauge, 'Ethereum')).to.be.revertedWith(
            'Cannot add gauge for 80/20 BAL-WETH BPT'
          );
        });
      });

      context('when gauge has been deployed from a valid factory', () => {
        sharedBeforeEach('add gauge factory', async () => {
          const action = await actionId(gaugeAdder, 'setGaugeFactory');
          await vault.grantPermissionGlobally(action, admin);

          await gaugeAdder.connect(admin).setGaugeFactory(gaugeFactory.address, 'Ethereum');
        });

        it('registers the gauge on the GaugeController', async () => {
          const tx = await gaugeAdder.connect(admin).addGauge(gauge, 'Ethereum');

          expectEvent.inIndirectReceipt(await tx.wait(), gaugeController.interface, 'NewGauge', {
            addr: gauge,
            gauge_type: GaugeType.Ethereum,
            weight: 0,
          });
        });

        it('allows duplicate gauges for the same pool', async () => {
          const tx = await gaugeAdder.connect(admin).addGauge(gauge, 'Ethereum');
          expectEvent.inIndirectReceipt(await tx.wait(), gaugeController.interface, 'NewGauge', {
            addr: gauge,
            gauge_type: GaugeType.Ethereum,
            weight: 0,
          });

          const dupeGauge = await deployGauge(gaugeFactory, ANY_ADDRESS);
          const dupeTx = await gaugeAdder.connect(admin).addGauge(dupeGauge, 'Ethereum');
          expectEvent.inIndirectReceipt(await dupeTx.wait(), gaugeController.interface, 'NewGauge', {
            addr: dupeGauge,
            gauge_type: GaugeType.Ethereum,
            weight: 0,
          });
        });
      });
    });
  });

  describe('type getters', () => {
    sharedBeforeEach(async () => {
      const action = await actionId(gaugeAdder, 'addGaugeType');
      await vault.grantPermissionGlobally(action, admin);

      await gaugeAdder.connect(admin).addGaugeType('Ethereum', GaugeType.Ethereum);
      await gaugeAdder.connect(admin).addGaugeType('Polygon', GaugeType.Polygon);
      await gaugeAdder.connect(admin).addGaugeType('Arbitrum', GaugeType.Arbitrum);
    });

    describe('getGaugeTypes', () => {
      it('returns registered gauge types', async () => {
        expect(await gaugeAdder.getGaugeTypes()).to.be.deep.eq(['Ethereum', 'Polygon', 'Arbitrum']);
      });
    });

    describe('getGaugeTypeAtIndex', () => {
      context('with valid indexes', () => {
        it('returns registered gauge types', async () => {
          expect(await gaugeAdder.getGaugeTypeAtIndex(0)).to.be.eq('Ethereum');
          expect(await gaugeAdder.getGaugeTypeAtIndex(1)).to.be.eq('Polygon');
          expect(await gaugeAdder.getGaugeTypeAtIndex(2)).to.be.eq('Arbitrum');
        });
      });

      context('with invalid indexes', () => {
        it('reverts', async () => {
          await expect(gaugeAdder.getGaugeTypeAtIndex(3)).to.be.revertedWith('OUT_OF_BOUNDS');
        });
      });
    });

    describe('getGaugeTypesCount', () => {
      it('returns registered gauge types count', async () => {
        expect(await gaugeAdder.getGaugeTypesCount()).to.be.eq(3);
      });
    });

    describe('getGaugeTypeNumber', () => {
      context('with valid gauge types', () => {
        it('returns registered gauge type numbers', async () => {
          expect(await gaugeAdder.getGaugeTypeNumber('Ethereum')).to.be.eq(GaugeType.Ethereum);
          expect(await gaugeAdder.getGaugeTypeNumber('Polygon')).to.be.eq(GaugeType.Polygon);
          expect(await gaugeAdder.getGaugeTypeNumber('Arbitrum')).to.be.eq(GaugeType.Arbitrum);
        });
      });

      context('with invalid gauge types', () => {
        it('reverts', async () => {
          await expect(gaugeAdder.getGaugeTypeNumber('Invalid')).to.be.revertedWith('Invalid gauge type');
        });
      });
    });
  });
});
