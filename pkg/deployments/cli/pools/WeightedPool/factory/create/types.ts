import { BigNumberish } from 'ethers';

export interface WeightedPoolFactoryCreateParameters {
  name: string;
  symbol: string;
  tokens: string[];
  weights: BigNumberish[];
  swapFeePercentage: BigNumberish;
  delegate: string;
}
