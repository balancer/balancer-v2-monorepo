import { ethers } from 'hardhat';
import { Contract } from 'ethers';

import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('AvalancheRootGauge', () => {
  let rootGauge: Contract;
  let gaugeController: Contract;
  let vault: Vault;
  let BAL: Contract;
  let admin: SignerWithAddress;

  const MIN_BRIDGE_LIMIT = fp(1.459854);
  const MAX_BRIDGE_LIMIT = fp(729927.007299);

  before('setup signers', async () => {
    [, admin] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault and gauge controller', async () => {
    vault = await Vault.create({ admin });
    const adaptor = vault.authorizerAdaptor;

    gaugeController = await deploy('MockGaugeController', { args: [ZERO_ADDRESS, adaptor.address] });
  });

  sharedBeforeEach('deploy mock factory and gauge', async () => {
    BAL = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer', 'BAL'] });
    const balTokenAdmin = await deploy('MockBalancerTokenAdmin', { args: [vault.address, BAL.address] });
    const balMinter = await deploy('MainnetBalancerMinter', { args: [balTokenAdmin.address, gaugeController.address] });

    // Because the limits are stored in the factory, we need both factory and root gauge mocks.
    const factory = await deploy('MockAvalancheRootGaugeFactory', {
      args: [balMinter.address, ZERO_ADDRESS, MIN_BRIDGE_LIMIT, MAX_BRIDGE_LIMIT],
    });

    rootGauge = await deployedAt('MockAvalancheRootGauge', factory.getImplementation());
  });

  it('reverts if the mint amount is too small', async () => {
    await expect(rootGauge.bridge(MIN_BRIDGE_LIMIT.sub(1))).to.be.revertedWith('Below Bridge Limit');
  });

  it('reverts if the mint amount is too large', async () => {
    await expect(rootGauge.bridge(MAX_BRIDGE_LIMIT.add(1))).to.be.revertedWith('Above Bridge Limit');
  });
});
