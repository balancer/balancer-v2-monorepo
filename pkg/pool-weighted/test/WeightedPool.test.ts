import { expect } from 'chai';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';

import { range } from 'lodash';

describe('WeightedPool', function () {
  let allTokens: TokenList;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = [
    fp(0.01),
    fp(0.02),
    fp(0.03),
    fp(0.04),
    fp(0.05),
    fp(0.06),
    fp(0.07),
    fp(0.08),
    fp(0.09),
    fp(0.1),
    fp(0.11),
    fp(0.12),
    fp(0.03),
    fp(0.04),
    fp(0.05),
    fp(0.06),
    fp(0.01),
    fp(0.01),
    fp(0.01),
    fp(0.01),
  ];

  sharedBeforeEach('deploy tokens', async () => {
    allTokens = await TokenList.create(20, { sorted: true, varyDecimals: true });
  });

  for (const numTokens of range(2, 21)) {
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
        const normalizedWeights = await pool.getNormalizedWeights();

        expect(normalizedWeights).to.deep.equal(pool.normalizedWeights);
      });

      it('sets scaling factors', async () => {
        const poolScalingFactors = await pool.getScalingFactors();
        const tokenScalingFactors = allTokens.subset(numTokens).map((token) => fp(10 ** (18 - token.decimals)));

        expect(poolScalingFactors).to.deep.equal(tokenScalingFactors);
      });
    });
  }
});
