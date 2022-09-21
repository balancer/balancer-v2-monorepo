import { expect } from 'chai';
import { Contract, Wallet } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { random, range } from 'lodash';
import { toNormalizedWeights } from '@balancer-labs/balancer-js';

describe('ManagedPoolTokenLib', () => {
  let lib: Contract;

  const MAX_RELATIVE_ERROR = 0.0005;
  const TEST_RUNS = 10;

  before('deploy lib', async () => {
    lib = await deploy('MockManagedPoolTokenLib');
  });

  describe('find minimum weight', () => {
    it('returns the smallest weight passed', async () => {
      for (let i = 0; i < TEST_RUNS; i++) {
        const numTokens = random(2, 40);
        const tokenAddresses = await Promise.all(range(numTokens).map(() => Wallet.createRandom().getAddress()));
        const tokenWeights = toNormalizedWeights(tokenAddresses.map(() => fp(random(1.0, 20.0))));
        const denormWeightSum = fp(random(1.0, 5.0));

        const expectedSmallestWeight = tokenWeights.reduce((min, value) => (min.lte(value) ? min : value));

        const smallestWeight = await lib.callStatic.getMinimumTokenEndWeight(
          tokenAddresses,
          tokenWeights,
          denormWeightSum
        );

        // We don't expect to return exactly the expected smallest weight as `getMinimumTokenEndWeight` involves
        // denormalization and normalization of the token weights so rounding errors are introduced.
        expect(smallestWeight).to.be.almostEqual(expectedSmallestWeight, MAX_RELATIVE_ERROR);
      }
    });
  });
});
