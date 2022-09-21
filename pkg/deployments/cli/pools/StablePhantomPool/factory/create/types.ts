import { BigNumberish } from 'ethers';

export interface StablePhantomPoolFactoryCreateParameters {
  name: string;
  symbol: string;
  tokens: string[];
  rateProviders: string[];
  priceRateCacheDuration: BigNumberish[];
  swapFeePercentage: BigNumberish;
  amplificationParameter: BigNumberish;
  owner: string;
}
