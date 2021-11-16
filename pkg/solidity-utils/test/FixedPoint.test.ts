import { expect } from 'chai';

import { Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

describe('FixedPoint', () => {
  let lib: Contract;

  sharedBeforeEach('deploy lib', async () => {
    lib = await deploy('FixedPointMock', { args: [] });
  });

  const checkPow = async (x: number, pow: number) => {
    const result = fp(x ** pow);
    expect(await lib.powDown(fp(x), fp(pow))).to.equal(result);
    expect(await lib.powUp(fp(x), fp(pow))).to.equal(result);
  };

  const checkPows = async (pow: number) => {
    it('handles small numbers', async () => {
      await checkPow(0.0007, pow);
    });

    it('handles medium numbers', async () => {
      await checkPow(15, pow);
    });

    it('handles big numbers', async () => {
      await checkPow(158300, pow);
    });
  };

  context('non-fractional pow 1', () => {
    checkPows(1);
  });

  context('non-fractional pow 2', async () => {
    checkPows(2);
  });

  context('non-fractional pow 4', async () => {
    checkPows(4);
  });
});
