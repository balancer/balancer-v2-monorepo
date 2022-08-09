import { expect } from 'chai';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';

describe('BalancerErrors', function () {
  let errors: Contract;

  beforeEach('deploy errors', async () => {
    errors = await deploy('BalancerErrorsMock');
  });

  it('encodes the error code as expected', async () => {
    await expect(errors.fail(123)).to.be.revertedWith('BAL#123');
  });

  it('translates the error code to its corresponding string if existent', async () => {
    await expect(errors.fail(102)).to.be.revertedWith('UNSORTED_TOKENS');
  });

  it('encodes the prefix as expected', async () => {
    // GYR = 0x475952
    await expect(errors.failWithPrefix(123, '0x475952')).to.be.revertedWith('GYR#123');
  });
});
