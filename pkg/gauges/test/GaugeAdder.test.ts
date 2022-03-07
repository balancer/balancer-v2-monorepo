import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expect } from 'chai';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';

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

    const token = await Token.create('BPT');
    const veToken = await deploy('VotingEscrow', { args: [token.address, 'Voting Escrow BPT', 'veBAL'] });

    gaugeController = await deploy('GaugeController', { args: [veToken.address] });
    adaptor = await deploy('AuthorizerAdaptor', { args: [vault.address] });
    gaugeAdder = await deploy('GaugeAdder', { args: [gaugeController.address, adaptor.address] });
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
      it('reverts');
    });

    context('when caller is authorized', () => {
      context('when gauge type does not exist on GaugeController', () => {
        it('reverts');
      });

      context('when gauge type exists on gauge controller', () => {
        context('when factory is a duplicate of an existing factory', () => {
          it('reverts');
        });

        context('when factory is not a duplicate of an existing factory', () => {
          it('stores the new factory address');
          it('emits a GaugeFactoryAdded event');
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
      it('reverts');
    });

    context('when caller is authorized', () => {
      context('when gauge has not been deployed from a valid factory', () => {
        it('reverts');
      });

      context('when gauge has been deployed from a valid factory', () => {
        it('registers the gauge on the GaugeController');
      });
    });
  });
});
