import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expect } from 'chai';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

enum GaugeType {
  LiquidityMiningCommittee = 0,
  veBAL,
  Ethereum,
  Polygon,
  Arbitrum,
}

describe('GaugeAdder', () => {
  let vault: Vault;
  let authorizer: Contract;
  let gaugeController: Contract;
  let adaptor: Contract;
  let gaugeAdder: Contract;

  let admin: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    vault = await Vault.create({ admin });
    if (!vault.authorizer) throw Error('Vault has no Authorizer');
    authorizer = vault.authorizer;

    adaptor = await deploy('AuthorizerAdaptor', { args: [vault.address] });
    gaugeController = await deploy('MockGaugeController', {});
    gaugeAdder = await deploy('GaugeAdder', { args: [gaugeController.address, adaptor.address] });

    await gaugeController.add_type('LiquidityMiningCommittee');
    await gaugeController.add_type('veBAL');
    await gaugeController.add_type('Ethereum');
  });

  sharedBeforeEach('set up permissions', async () => {
    const action = await actionId(adaptor, 'add_gauge', gaugeController.interface);
    await vault.grantPermissionsGlobally([action], gaugeAdder);
  });

  describe('constructor', () => {
    it('sets the vault address', async () => {
      expect(await gaugeAdder.getVault()).to.be.eq(vault.address);
    });

    it('sets the authorizer adaptor address', async () => {
      expect(await gaugeAdder.getAuthorizerAdaptor()).to.be.eq(adaptor.address);
    });

    it('uses the authorizer of the vault', async () => {
      expect(await gaugeAdder.getAuthorizer()).to.equal(authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      const action = await actionId(vault.instance, 'setAuthorizer');
      await vault.grantPermissionsGlobally([action], admin.address);

      await vault.instance.connect(admin).setAuthorizer(other.address);

      expect(await gaugeAdder.getAuthorizer()).to.equal(other.address);
    });
  });

  describe('addGaugeFactory', () => {
    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(gaugeAdder.connect(other).addGaugeFactory(ZERO_ADDRESS, GaugeType.Ethereum)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('when caller is authorized', () => {
      sharedBeforeEach('authorize caller', async () => {
        const action = await actionId(gaugeAdder, 'addGaugeFactory');
        await vault.grantPermissionsGlobally([action], admin);
      });

      context('when gauge type does not exist on GaugeController', () => {
        it('reverts', async () => {
          await expect(gaugeAdder.connect(admin).addGaugeFactory(ZERO_ADDRESS, GaugeType.Polygon)).to.be.revertedWith(
            'Invalid gauge type'
          );
        });
      });

      context('when gauge type exists on gauge controller', () => {
        context('when factory is a duplicate of an existing factory', () => {
          sharedBeforeEach('add gauge factory', async () => {
            await gaugeAdder.connect(admin).addGaugeFactory(ZERO_ADDRESS, GaugeType.Ethereum);
          });

          it('reverts', async () => {
            await expect(
              gaugeAdder.connect(admin).addGaugeFactory(ZERO_ADDRESS, GaugeType.Ethereum)
            ).to.be.revertedWith('Factory already added');
          });
        });

        context('when factory is not a duplicate of an existing factory', () => {
          it('stores the new factory address');
          it('emits a GaugeFactoryAdded event', async () => {
            const tx = await gaugeAdder.connect(admin).addGaugeFactory(ZERO_ADDRESS, GaugeType.Ethereum);
            const receipt = await tx.wait();
            expectEvent.inReceipt(receipt, 'GaugeFactoryAdded', {
              gaugeType: GaugeType.Ethereum,
              gaugeFactory: ZERO_ADDRESS,
            });
          });
        });
      });
    });
  });

  describe('isGaugeFromValidFactory', () => {
    context('when factory has been added to GaugeAdder', () => {
      it('returns the expected value');
    });

    context('when factory has not been added to GaugeAdder', () => {
      it('returns the expected value');
    });
  });

  describe('addEthereumGauge', () => {
    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(gaugeAdder.connect(other).addEthereumGauge(ZERO_ADDRESS)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when caller is authorized', () => {
      sharedBeforeEach('authorize caller', async () => {
        const action = await actionId(gaugeAdder, 'addEthereumGauge');
        await vault.grantPermissionsGlobally([action], admin);
      });

      context('when gauge has not been deployed from a valid factory', () => {
        it('reverts', async () => {
          await expect(gaugeAdder.connect(admin).addEthereumGauge(ZERO_ADDRESS)).to.be.revertedWith('Invalid gauge');
        });
      });

      context('when gauge has been deployed from a valid factory', () => {
        it('registers the gauge on the GaugeController');
      });
    });
  });
});
