import { expect } from 'chai';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

describe('ExpLog', () => {
  let lib: Contract;

  const MAX_X = bn(2).pow(255).sub(1);
  const MAX_Y = bn(2).pow(254).div(bn(10).pow(20)).sub(1);

  sharedBeforeEach('deploy lib', async () => {
    lib = await deploy('LogExpMathMock', { args: [] });
  });

  describe('exponent zero', () => {
    const exponent = 0;

    it('handles base zero', async () => {
      const base = 0;
      const expectedResult = fp(1);

      expect(await lib.pow(base, exponent)).to.be.equal(expectedResult);
    });

    it('handles base one', async () => {
      const base = 1;
      const expectedResult = fp(1);

      expect(await lib.pow(base, exponent)).to.be.equal(expectedResult);
    });

    it('handles base greater than one', async () => {
      const base = 10;
      const expectedResult = fp(1);

      expect(await lib.pow(base, exponent)).to.be.equal(expectedResult);
    });
  });

  describe('base zero', () => {
    const base = 0;

    it('handles exponent zero', async () => {
      const exponent = 0;
      const expectedResult = fp(1);

      expect(await lib.pow(base, exponent)).to.be.equal(expectedResult);
    });

    it('handles exponent one', async () => {
      const exponent = 1;
      const expectedResult = 0;

      expect(await lib.pow(base, exponent)).to.be.equal(expectedResult);
    });

    it('handles exponent greater than one', async () => {
      const exponent = 10;
      const expectedResult = 0;

      expect(await lib.pow(base, exponent)).to.be.equal(expectedResult);
    });
  });

  describe('base one', () => {
    const base = 1;

    it('handles exponent zero', async () => {
      const exponent = 0;
      const expectedResult = fp(1);

      expect(await lib.pow(base, exponent)).to.be.equal(expectedResult);
    });

    it('handles exponent one', async () => {
      const exponent = 1;
      const expectedResult = fp(1);

      expectEqualWithError(await lib.pow(base, exponent), expectedResult, 0.000000000001);
    });

    it('handles exponent greater than one', async () => {
      const exponent = 10;
      const expectedResult = fp(1);

      expectEqualWithError(await lib.pow(base, exponent), expectedResult, 0.000000000001);
    });
  });

  describe('decimals', () => {
    it('handles decimals properly', async () => {
      const base = fp(2);
      const exponent = fp(4);
      const expectedResult = fp(Math.pow(2, 4));

      const result = await lib.pow(base, exponent);
      expectEqualWithError(result, expectedResult, 0.000000000001);
    });
  });

  describe('max values', () => {
    it('cannot handle a base greater than 2^255 - 1', async () => {
      const base = MAX_X.add(1);
      const exponent = 1;

      await expect(lib.pow(base, exponent)).to.be.revertedWith('X_OUT_OF_BOUNDS');
    });

    it('cannot handle an exponent greater than (2^254/1e20) - 1', async () => {
      const base = 1;
      const exponent = MAX_Y.add(1);

      await expect(lib.pow(base, exponent)).to.be.revertedWith('Y_OUT_OF_BOUNDS');
    });
  });
});
