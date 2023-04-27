import { ethers } from 'hardhat';
import { Contract } from 'ethers';

import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describe('ChildChainGaugeRegistry', () => {
  let gaugeImplementation: Contract;
  let gaugeFactory: Contract;
  let otherGaugeFactory: Contract;
  let gauge: Contract;
  let gauge2: Contract;
  let otherGauge: Contract;
  let admin: SignerWithAddress, other: SignerWithAddress;
  let registry: Contract;

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

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy gauge registry', async () => {
    const vault = await Vault.create();
    const balToken = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer', 'BAL'] });

    const mockVE = await deploy('v2-solidity-utils/TestToken', { args: ['Voting Escrow', 'veBAL', 18] });
    const mockBPT = await deploy('v2-solidity-utils/TestToken', { args: ['Balancer Pool Test token', 'BPTST', 18] });

    const veDelegationProxy = await deploy('VotingEscrowDelegationProxy', {
      args: [vault.address, mockVE.address, ZERO_ADDRESS],
    });

    const pseudoMinter = await deploy('L2BalancerPseudoMinter', { args: [vault.address, balToken.address] });

    gaugeImplementation = await deploy('ChildChainGauge', {
      args: [veDelegationProxy.address, pseudoMinter.address, vault.authorizerAdaptor.address, productVersion],
    });

    gaugeFactory = await deploy('ChildChainGaugeFactory', {
      args: [gaugeImplementation.address, factoryVersion, productVersion],
    });

    otherGaugeFactory = await deploy('ChildChainGaugeFactory', {
      args: [gaugeImplementation.address, factoryVersion, productVersion],
    });

    registry = await deploy('ChildChainGaugeRegistry', {
      args: [pseudoMinter.address, gaugeFactory.address],
    });

    await vault.grantPermissionGlobally(await actionId(pseudoMinter, 'addGaugeFactory'), admin.address);
    await vault.grantPermissionGlobally(await actionId(registry, 'addGauge'), admin.address);
    await vault.grantPermissionGlobally(await actionId(registry, 'removeGauge'), admin.address);

    await pseudoMinter.connect(admin).addGaugeFactory(gaugeFactory.address);

    let tx = await gaugeFactory.create(mockBPT.address);
    let event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');
    gauge = await deployedAt('ChildChainGauge', event.args.gauge);

    tx = await gaugeFactory.create(mockBPT.address);
    event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');
    gauge2 = await deployedAt('ChildChainGauge', event.args.gauge);

    tx = await otherGaugeFactory.create(mockBPT.address);
    event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');
    otherGauge = await deployedAt('ChildChainGauge', event.args.gauge);
  });

  describe('addGauge', () => {
    context('when the gauge, factory and caller are valid', () => {
      it('can add a valid gauge to the registry', async () => {
        await expect(registry.connect(admin).addGauge(gauge.address)).not.to.be.reverted;
      });

      it('emits an event', async () => {
        const tx = await registry.connect(admin).addGauge(gauge.address);

        expectEvent.inReceipt(await tx.wait(), 'GaugeAdded', { gauge: gauge.address });
      });

      it('increments total gauges', async () => {
        expect(await registry.totalGauges()).to.eq(0);

        await registry.connect(admin).addGauge(gauge.address);

        expect(await registry.totalGauges()).to.eq(1);
      });
    });

    it('only privileged account can add a gauge', async () => {
      await expect(registry.connect(other).addGauge(gauge.address)).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    it('cannot add the same gauge twice', async () => {
      await registry.connect(admin).addGauge(gauge.address);
      await expect(registry.connect(admin).addGauge(gauge.address)).to.be.revertedWith('GAUGE_ALREADY_REGISTERED');
    });

    it('reverts if gauge is not from the factory', async () => {
      const maliciousGauge = await deploy('MockChildChainGauge', { args: ['test'] });
      await maliciousGauge.setMockFactory(gaugeFactory.address);
      await expect(registry.connect(admin).addGauge(maliciousGauge.address)).to.be.revertedWith(
        'GAUGE_NOT_FROM_FACTORY'
      );
    });

    it('reverts if gauge factory is invalid', async () => {
      await expect(registry.connect(admin).addGauge(otherGauge.address)).to.be.revertedWith('INVALID_GAUGE_FACTORY');
    });
  });

  describe('removeGauge', () => {
    sharedBeforeEach('add gauge', async () => {
      await registry.connect(admin).addGauge(gauge.address);
    });

    it('can remove a valid gauge from the registry', async () => {
      const tx = await registry.connect(admin).removeGauge(gauge.address);

      expectEvent.inReceipt(await tx.wait(), 'GaugeRemoved', { gauge: gauge.address });
      expect(await registry.totalGauges()).to.eq(0);
      await expect(registry.getGauges(0, 1)).to.be.revertedWith('END_INDEX_OUT_OF_BOUNDS');
    });

    it('reverts if gauge is not present', async () => {
      await expect(registry.connect(admin).removeGauge(otherGaugeFactory.address)).to.be.revertedWith(
        'GAUGE_NOT_REGISTERED'
      );
    });

    it('only privileged account can remove a gauge', async () => {
      await expect(registry.connect(other).removeGauge(gauge.address)).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });

  describe('totalGauges', () => {
    it('returns the correct total number of gauges', async () => {
      expect(await registry.totalGauges()).to.equal(0);

      await registry.connect(admin).addGauge(gauge.address);
      expect(await registry.totalGauges()).to.equal(1);

      await registry.connect(admin).addGauge(gauge2.address);
      expect(await registry.totalGauges()).to.equal(2);
    });
  });

  describe('getGauges', () => {
    sharedBeforeEach('add gauges', async () => {
      await registry.connect(admin).addGauge(gauge.address);
      await registry.connect(admin).addGauge(gauge2.address);
    });

    it('returns a range of gauges', async () => {
      const startIndex = 0;
      const endIndex = 2;

      const gauges = await registry.getGauges(startIndex, endIndex);
      expect(gauges.length).to.equal(endIndex - startIndex);

      expect(gauges[0]).to.equal(gauge.address);
      expect(gauges[1]).to.equal(gauge2.address);
    });

    it('reverts if startIndex is greater than endIndex', async () => {
      const startIndex = 2;
      const endIndex = 1;

      await expect(registry.getGauges(startIndex, endIndex)).to.be.revertedWith('INVALID_INDICES');
    });

    it('reverts if endIndex is out of bounds', async () => {
      const startIndex = 1;
      const endIndex = 4;

      await expect(registry.getGauges(startIndex, endIndex)).to.be.revertedWith('END_INDEX_OUT_OF_BOUNDS');
    });
  });
});
