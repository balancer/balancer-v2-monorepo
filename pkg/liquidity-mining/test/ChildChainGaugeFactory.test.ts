import { Contract } from 'ethers';

import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { deployedAt } from '@balancer-labs/v2-helpers/src/contract';

describe('ChildChainGaugeFactory', () => {
  let gaugeImplementation: Contract;
  let gaugeFactory: Contract;
  let lpToken: Contract;

  const factoryVersion = JSON.stringify({
    name: 'ChildChainGaugeFactory',
    version: '1',
    deployment: 'test-deployment',
  });
  const productVersion = JSON.stringify({
    name: 'ChildChainGauge',
    version: '0',
    deployment: 'test-deployment',
  });

  sharedBeforeEach('deploy gauge factory', async () => {
    const vault = await Vault.create();

    const mockVE = await deploy('TestBalancerToken', { args: [ANY_ADDRESS, 'Test VE', 'veTST'] });

    const veDelegationProxy = await deploy('VotingEscrowDelegationProxy', {
      args: [vault.address, mockVE.address, ZERO_ADDRESS],
    });

    const pseudoMinter = await deploy('L2BalancerPseudoMinter', { args: [vault.address, ANY_ADDRESS] });
    gaugeImplementation = await deploy('ChildChainGauge', {
      args: [veDelegationProxy.address, pseudoMinter.address, vault.authorizerAdaptor.address, productVersion],
    });

    gaugeFactory = await deploy('ChildChainGaugeFactory', {
      args: [gaugeImplementation.address, factoryVersion, productVersion],
    });

    // Mock BPT
    lpToken = await deploy('TestBalancerToken', { args: [ANY_ADDRESS, 'Test', 'TST'] });
  });

  describe('constructor', () => {
    it('reverts if constructor argument does not match gauge implementation version', async () => {
      await expect(
        deploy('ChildChainGaugeFactory', {
          args: [gaugeImplementation.address, factoryVersion, 'Wrong gauge version'],
        })
      ).to.be.revertedWith('VERSION_MISMATCH');
    });
  });

  describe('getters', () => {
    it('returns product version', async () => {
      expect(await gaugeFactory.getProductVersion()).to.be.eq(productVersion);
    });
  });

  describe('create', () => {
    let gauge: Contract;

    sharedBeforeEach(async () => {
      const tx = await gaugeFactory.create(lpToken.address);
      const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');
      gauge = await deployedAt('ChildChainGauge', event.args.gauge);
    });

    it('sets LP token', async () => {
      expect(await gauge.lp_token()).to.be.eq(lpToken.address);
    });

    it('sets version', async () => {
      expect(await gauge.version()).to.be.eq(productVersion);
    });
  });
});
