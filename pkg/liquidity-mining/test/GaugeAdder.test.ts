import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expect } from 'chai';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

enum GaugeType {
  LiquidityMiningCommittee = 0,
  veBAL,
  Ethereum,
  Polygon,
  Arbitrum,
}

describe('GaugeAdder', () => {
  let vault: Vault;
  let gaugeController: Contract;
  let gaugeFactory: Contract;
  let adaptor: Contract;
  let gaugeAdder: Contract;

  let admin: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    vault = await Vault.create({ admin });

    adaptor = await deploy('AuthorizerAdaptor', { args: [vault.address] });
    gaugeController = await deploy('MockGaugeController', { args: [ZERO_ADDRESS, adaptor.address] });

    gaugeFactory = await deploy('MockLiquidityGaugeFactory');
    gaugeAdder = await deploy('GaugeAdder', { args: [gaugeController.address, ZERO_ADDRESS] });

    await gaugeController.add_type('LiquidityMiningCommittee', 0);
    await gaugeController.add_type('veBAL', 0);
    await gaugeController.add_type('Ethereum', 0);
  });

  sharedBeforeEach('set up permissions', async () => {
    const action = await actionId(adaptor, 'add_gauge', gaugeController.interface);
    await vault.grantPermissionsGlobally([action], gaugeAdder);
  });

  async function deployGauge(gaugeFactory: Contract, poolAddress: string): Promise<string> {
    const tx = await gaugeFactory.create(poolAddress);
    const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

    return event.args.gauge;
  }

  describe('addGaugeFactory', () => {
    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(
          gaugeAdder.connect(other).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum)
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when caller is authorized', () => {
      sharedBeforeEach('authorize caller', async () => {
        const action = await actionId(gaugeAdder, 'addGaugeFactory');
        await vault.grantPermissionsGlobally([action], admin);
      });

      context('when gauge type does not exist on GaugeController', () => {
        it('reverts', async () => {
          await expect(
            gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Polygon)
          ).to.be.revertedWith('Invalid gauge type');
        });
      });

      context('when gauge type exists on GaugeController', () => {
        context('when factory already exists on GaugeAdder', () => {
          sharedBeforeEach('add gauge factory', async () => {
            await gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum);
          });

          it('reverts', async () => {
            await expect(
              gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum)
            ).to.be.revertedWith('Factory already added');
          });
        });

        context("when factory doesn't already exists on GaugeAdder", () => {
          it('stores the new factory address', async () => {
            expect(await gaugeAdder.getFactoryForGaugeTypeCount(GaugeType.Ethereum)).to.be.eq(0);
            await expect(gaugeAdder.getFactoryForGaugeType(GaugeType.Ethereum, 0)).to.be.revertedWith('OUT_OF_BOUNDS');

            await gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum);

            expect(await gaugeAdder.getFactoryForGaugeTypeCount(GaugeType.Ethereum)).to.be.eq(1);
            expect(await gaugeAdder.getFactoryForGaugeType(GaugeType.Ethereum, 0)).to.be.eq(gaugeFactory.address);
          });

          it('emits a GaugeFactoryAdded event', async () => {
            const tx = await gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum);
            const receipt = await tx.wait();
            expectEvent.inReceipt(receipt, 'GaugeFactoryAdded', {
              gaugeType: GaugeType.Ethereum,
              gaugeFactory: gaugeFactory.address,
            });
          });
        });
      });
    });
  });

  describe('isGaugeFromValidFactory', () => {
    let gauge: string;

    sharedBeforeEach('deploy gauge', async () => {
      gauge = await deployGauge(gaugeFactory, ZERO_ADDRESS);
    });

    context('when factory has been added to GaugeAdder', () => {
      sharedBeforeEach('add gauge factory', async () => {
        const action = await actionId(gaugeAdder, 'addGaugeFactory');
        await vault.grantPermissionsGlobally([action], admin);

        await gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum);
      });

      it('returns the expected value', async () => {
        expect(await gaugeAdder.isGaugeFromValidFactory(gauge, GaugeType.Ethereum)).to.be.true;
        expect(await gaugeAdder.isGaugeFromValidFactory(gauge, GaugeType.Polygon)).to.be.false;
        expect(await gaugeAdder.isGaugeFromValidFactory(gauge, GaugeType.Arbitrum)).to.be.false;
      });
    });

    context('when factory has not been added to GaugeAdder', () => {
      it('returns the expected value', async () => {
        expect(await gaugeAdder.isGaugeFromValidFactory(gauge, GaugeType.Ethereum)).to.be.false;
      });
    });
  });

  describe('addEthereumGauge', () => {
    let gauge: string;

    sharedBeforeEach('deploy gauge', async () => {
      gauge = await deployGauge(gaugeFactory, ANY_ADDRESS);
    });

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(gaugeAdder.connect(other).addEthereumGauge(gauge)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when caller is authorized', () => {
      sharedBeforeEach('authorize caller', async () => {
        const action = await actionId(gaugeAdder, 'addEthereumGauge');
        await vault.grantPermissionsGlobally([action], admin);
      });

      context('when gauge is for a pool which already has a gauge', () => {
        context('when gauge was deployed by the current GaugeAdder', () => {
          let duplicateGauge: string;

          sharedBeforeEach('add gauge factory', async () => {
            const action = await actionId(gaugeAdder, 'addGaugeFactory');
            await vault.grantPermissionsGlobally([action], admin);

            await gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum);
            await gaugeAdder.connect(admin).addEthereumGauge(gauge);

            const duplicateGaugeFactory = await deploy('MockLiquidityGaugeFactory');
            duplicateGauge = await deployGauge(duplicateGaugeFactory, ANY_ADDRESS);
          });

          it('reverts', async () => {
            await expect(gaugeAdder.connect(admin).addEthereumGauge(duplicateGauge)).to.be.revertedWith(
              'Duplicate gauge'
            );
          });
        });

        context('when gauge was deployed by the previous GaugeAdder', () => {
          let newGaugeAdder: Contract;

          sharedBeforeEach('add gauge on previous GaugeAdder', async () => {
            const action = await actionId(gaugeAdder, 'addGaugeFactory');
            await vault.grantPermissionsGlobally([action], admin);

            await gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum);
            await gaugeAdder.connect(admin).addEthereumGauge(gauge);
          });

          sharedBeforeEach('add gauge factory to new GaugeAdder', async () => {
            newGaugeAdder = await deploy('GaugeAdder', { args: [gaugeController.address, gaugeAdder.address] });

            const addGaugeFactoryAction = await actionId(newGaugeAdder, 'addGaugeFactory');
            await vault.grantPermissionsGlobally([addGaugeFactoryAction], admin);

            await newGaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum);

            // Authorize admin to add gauges through new GaugeAdder
            const addEthereumGaugeAction = await actionId(newGaugeAdder, 'addEthereumGauge');
            await vault.grantPermissionsGlobally([addEthereumGaugeAction], admin);
          });

          it('reverts', async () => {
            await expect(newGaugeAdder.connect(admin).addEthereumGauge(gauge)).to.be.revertedWith('Duplicate gauge');
          });
        });
      });

      context('when gauge is for a new pool', () => {
        context('when gauge has not been deployed from a valid factory', () => {
          it('reverts', async () => {
            await expect(gaugeAdder.connect(admin).addEthereumGauge(gauge)).to.be.revertedWith('Invalid gauge');
          });
        });

        context('when gauge has been deployed from a valid factory', () => {
          sharedBeforeEach('add gauge factory', async () => {
            const action = await actionId(gaugeAdder, 'addGaugeFactory');
            await vault.grantPermissionsGlobally([action], admin);

            await gaugeAdder.connect(admin).addGaugeFactory(gaugeFactory.address, GaugeType.Ethereum);
          });

          it('registers the gauge on the GaugeController', async () => {
            const tx = await gaugeAdder.connect(admin).addEthereumGauge(gauge);

            expectEvent.inIndirectReceipt(await tx.wait(), gaugeController.interface, 'NewGauge', {
              addr: gauge,
              gauge_type: GaugeType.Ethereum,
              weight: 0,
            });
          });
        });
      });
    });
  });
});
