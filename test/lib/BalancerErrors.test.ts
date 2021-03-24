import { expect } from 'chai';
import { Contract } from 'ethers';

import { deploy } from '../../lib/helpers/deploy';

describe('BalancerErrors', function () {
  let errors: Contract;

  beforeEach('deploy errors', async () => {
    errors = await deploy('BalancerErrorsMock');
  });

  it('encodes the error code as expected', async () => {
    await expect(errors.fail(1234)).to.be.revertedWith('1234');
  });

  it('translates the error code to its corresponding string if existent', async () => {
    await expect(errors.fail(102)).to.be.revertedWith('UNSORTED_TOKENS');
  });
});
