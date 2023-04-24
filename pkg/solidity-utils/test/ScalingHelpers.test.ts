import { expect } from 'chai';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('ScalingHelpers', function () {
  let lib: Contract;

  sharedBeforeEach(async () => {
    lib = await deploy('MockScalingHelpers');
  });

  describe('upscale', () => {
    it('returns the amount multiplied by the scaling factor', async () => {
      expect(await lib.upscale(fp(42), fp(1.6))).to.equal(fp(67.2));
    });

    it('rounds down', async () => {
      expect(await lib.upscale(1, 1)).to.equal(0);
    });
  });

  describe('upscaleArray', () => {
    it('returns the amounts multiplied by the scaling factors', async () => {
      expect(await lib.upscaleArray([fp(42), fp(15)], [fp(1.6), fp(2)])).to.deep.equal([fp(67.2), fp(30)]);
    });

    it('rounds down', async () => {
      expect(await lib.upscaleArray([1], [1])).to.deep.equal([0]);
    });

    it('reverts if the arrays have different lengths', async () => {
      await expect(lib.upscaleArray([fp(42), fp(15)], [fp(1.6)])).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });
  });

  describe('downscaleDown', () => {
    it('returns the amount divided by the scaling factor', async () => {
      expect(await lib.downscaleDown(fp(60), fp(1.6))).to.equal(fp(37.5));
    });

    it('rounds down', async () => {
      expect(await lib.downscaleDown(5, fp(2))).to.equal(2);
    });
  });

  describe('downscaleDownArray', () => {
    it('returns the amounts divided by the scaling factors', async () => {
      expect(await lib.downscaleDownArray([fp(60), fp(30)], [fp(1.6), fp(2)])).to.deep.equal([fp(37.5), fp(15)]);
    });

    it('rounds down', async () => {
      expect(await lib.downscaleDownArray([5], [fp(2)])).to.deep.equal([2]);
    });

    it('reverts if the arrays have different lengths', async () => {
      await expect(lib.downscaleDownArray([fp(42), fp(15)], [fp(1.6)])).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });
  });

  describe('downscaleUp', () => {
    it('returns the amount divided by the scaling factor', async () => {
      expect(await lib.downscaleUp(fp(60), fp(1.6))).to.equal(fp(37.5));
    });

    it('rounds up', async () => {
      expect(await lib.downscaleUp(5, fp(2))).to.equal(3);
    });
  });

  describe('downscaleUpArray', () => {
    it('returns the amounts divided by the scaling factors', async () => {
      expect(await lib.downscaleUpArray([fp(60), fp(30)], [fp(1.6), fp(2)])).to.deep.equal([fp(37.5), fp(15)]);
    });

    it('rounds up', async () => {
      expect(await lib.downscaleUpArray([5], [fp(2)])).to.deep.equal([3]);
    });

    it('reverts if the arrays have different lengths', async () => {
      await expect(lib.downscaleUpArray([fp(42), fp(15)], [fp(1.6)])).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });
  });
});
