import { BigNumber } from 'ethers';
import { bn, fp } from '../../../numbers';

export function toNormalizedWeights(weights: BigNumber[]): BigNumber[] {
  const sum = weights.map(bn).reduce((total, weight) => total.add(weight), bn(0));

  const normalizedWeights = [];
  let normalizedSum = bn(0);
  for (let index = 0; index < weights.length; index++) {
    if (index < weights.length - 1) {
      normalizedWeights[index] = weights[index].mul(fp(1)).div(sum);
      normalizedSum = normalizedSum.add(normalizedWeights[index]);
    } else {
      normalizedWeights[index] = fp(1).sub(normalizedSum);
    }
  }

  return normalizedWeights;
}
