import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';

export interface StablePoolFactoryCreateParameters {
  name: string;
  symbol: string;
  tokens: string[];
  swapFeePercentage: BigNumberish;
  amplificationParameter: BigNumberish;
  delegate: string;
}
