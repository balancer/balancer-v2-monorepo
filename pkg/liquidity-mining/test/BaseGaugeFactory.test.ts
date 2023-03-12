import { Contract } from 'ethers';
import { expect } from 'chai';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('BaseGaugeFactory', () => {
  let gaugeImplementation: Contract;
  let gaugeFactory: Contract;

  sharedBeforeEach('deploy gauge factory', async () => {
    gaugeImplementation = await deploy('MockLiquidityGauge');
    gaugeFactory = await deploy('MockLiquidityGaugeFactory', { args: [gaugeImplementation.address] });
  });

  describe('getGaugeImplementation', () => {
    it('returns the implementation given in the constructor', async () => {
      expect(await gaugeFactory.getGaugeImplementation()).to.be.eq(gaugeImplementation.address);
    });
  });

  describe('create', () => {
    it('emits an event', async () => {
      const tx = await gaugeFactory.create(ANY_ADDRESS, fp(1)); // Weight cap can be anything; it's not under test.
      expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');
    });
  });

  describe('isGaugeFromFactory', () => {
    let gaugeAddress: string;
    sharedBeforeEach('create gauge', async () => {
      const tx = await gaugeFactory.create(ANY_ADDRESS, fp(1)); // Weight cap can be anything; it's not under test.
      const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

      gaugeAddress = event.args.gauge;
    });

    context('when the contract was not created by the factory', () => {
      it('returns false', async () => {
        expect(await gaugeFactory.isGaugeFromFactory(gaugeImplementation.address)).to.be.false;
      });
    });

    context('when the contract was created by the factory', () => {
      it('returns true', async () => {
        expect(await gaugeFactory.isGaugeFromFactory(gaugeAddress)).to.be.true;
      });
    });
  });
});
