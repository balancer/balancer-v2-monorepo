import { BigNumberish } from 'ethers';

export interface StablePoolFactoryCreateParameters {
  name: string;
  symbol: string;
  tokens: string[];
  swapFeePercentage: BigNumberish;
  amplificationParameter: BigNumberish;
  owner: string;
}
