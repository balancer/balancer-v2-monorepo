import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';

export interface WeightedPoolFactoryCreateParameters {
  name: string;
  symbol: string;
  tokens: string[];
  weights: BigNumberish[];
  swapFeePercentage: BigNumberish;
  delegate: string;
}
