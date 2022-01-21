import { BigNumber, BigNumberish } from '@ethersproject/bignumber';
import { Zero, WeiPerEther as ONE } from '@ethersproject/constants';

// Should match MAX_WEIGHTED_TOKENS from v2-helpers/constants
// Including would introduce a dependency
const MaxWeightedTokens = 100;

/**
 * Normalize an array of token weights to ensure they sum to `1e18`
 * @param weights - an array of token weights to be normalized
 * @returns an equivalent set of normalized weights
 */
export function toNormalizedWeights(weights: BigNumber[]): BigNumber[] {
  // When the number is exactly equal to the max, normalizing with common inputs
  // leads to a value < 0.01, which reverts. In this case fill in the weights exactly.
  if (weights.length == MaxWeightedTokens) {
    return Array(MaxWeightedTokens).fill(ONE.div(MaxWeightedTokens));
  }

  const sum = weights.reduce((total, weight) => total.add(weight), Zero);
  if (sum.eq(ONE)) return weights;

  const normalizedWeights = [];
  let normalizedSum = Zero;
  for (let index = 0; index < weights.length; index++) {
    if (index < weights.length - 1) {
      normalizedWeights[index] = weights[index].mul(ONE).div(sum);
      normalizedSum = normalizedSum.add(normalizedWeights[index]);
    } else {
      normalizedWeights[index] = ONE.sub(normalizedSum);
    }
  }

  return normalizedWeights;
}

/**
 * Check whether a set of weights are normalized
 * @param weights - an array of potentially unnormalized weights
 * @returns a boolean of whether the weights are normalized
 */
export const isNormalizedWeights = (weights: BigNumberish[]): boolean => {
  const totalWeight = weights.reduce((total: BigNumber, weight) => total.add(weight), Zero);
  return totalWeight.eq(ONE);
};
