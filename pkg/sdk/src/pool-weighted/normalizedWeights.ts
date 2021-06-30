import { BigNumber, BigNumberish } from '@ethersproject/bignumber';
import { Zero, WeiPerEther as ONE } from '@ethersproject/constants';

export function toNormalizedWeights(weights: BigNumber[]): BigNumber[] {
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

export const isNormalizedWeights = (weights: BigNumberish[]): boolean => {
  const totalWeight = weights.reduce((total: BigNumber, weight) => total.add(weight), Zero);
  return totalWeight.eq(ONE);
};
