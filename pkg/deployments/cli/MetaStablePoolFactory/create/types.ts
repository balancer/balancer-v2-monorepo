import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';

export interface MetaStablePoolFactoryCreateParameters {
  name: string;
  symbol: string;
  tokens: string[];
  rateProviders: string[];
  priceRateCacheDuration: BigNumberish[];
  swapFeePercentage: BigNumberish;
  amplificationParameter: BigNumberish;
  delegate: string;
}
