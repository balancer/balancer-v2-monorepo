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
  let veDelegationProxy: Contract;
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

    gaugeImplementation = await deploy('ChildChainGauge', {
      args: [ANY_ADDRESS, ANY_ADDRESS, vault.authorizerAdaptor.address, productVersion],
    });

    const mockVE = await deploy('TestBalancerToken', { args: [ANY_ADDRESS, 'Test VE', 'veTST'] });

    veDelegationProxy = await deploy('VotingEscrowDelegationProxy', {
      args: [vault.address, mockVE.address, ZERO_ADDRESS],
    });
    gaugeFactory = await deploy('ChildChainGaugeFactory', {
      args: [gaugeImplementation.address, veDelegationProxy.address, factoryVersion, productVersion],
    });

    // Mock BPT
    lpToken = await deploy('TestBalancerToken', { args: [ANY_ADDRESS, 'Test', 'TST'] });
  });

  describe('getProductVersion', () => {
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

    it('sets voting escrow', async () => {
      expect(await gauge.voting_escrow()).to.be.eq(veDelegationProxy.address);
    });

    it('sets version', async () => {
      expect(await gauge.version()).to.be.eq(productVersion);
    });
  });
});
