import { BigNumberish } from 'ethers';

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
