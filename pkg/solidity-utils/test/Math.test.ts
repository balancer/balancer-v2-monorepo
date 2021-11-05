import { expect } from 'chai';

import { Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_INT256, MIN_INT256 } from '@balancer-labs/v2-helpers/src/constants';

describe('Math', () => {
  let lib: Contract;

  sharedBeforeEach('deploy lib', async () => {
    lib = await deploy('MathMock', { args: [] });
  });

  it('handles zero', async () => {
    expect(await lib.abs(0)).to.equal(0);
  });

  it('handles positive values', async () => {
    expect(await lib.abs(42)).to.equal(42);
  });

  it('handles large positive values', async () => {
    expect(await lib.abs(MAX_INT256)).to.equal(MAX_INT256);
  });

  it('handles negative values', async () => {
    expect(await lib.abs(-3)).to.equal(3);
  });

  it('handles large negative values', async () => {
    expect(await lib.abs(MIN_INT256)).to.equal(MIN_INT256.mul(-1));
  });
});
