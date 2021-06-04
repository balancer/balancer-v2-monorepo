import { expect } from 'chai';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { range } from 'lodash';

describe('WeightedPool', function () {
  let allTokens: TokenList;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = [fp(30), fp(20), fp(15), fp(10), fp(8), fp(6), fp(4), fp(2)];

  sharedBeforeEach('deploy tokens', async () => {
    allTokens = await TokenList.create(8, { sorted: true });
  });

  for (const numTokens of range(2, 9)) {
    context(`with ${numTokens} tokens`, () => {
      let pool: WeightedPool;

      sharedBeforeEach('deploy pool', async () => {
        const tokens = allTokens.subset(numTokens);
        pool = await WeightedPool.create({
          tokens,
          weights: WEIGHTS.slice(0, numTokens),
          swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
        });
      });

      it('sets token weights', async () => {
        const [normalizedWeights, maxWeightIndex] = await pool.getNormalizedWeightsAndMaxWeightIndex();

        expect(normalizedWeights).to.deep.equal(pool.normalizedWeights);
        expect(maxWeightIndex).to.deep.equal(pool.maxWeightIndex);
      });
    });
  }
});
