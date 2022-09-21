import { BigNumberish } from 'ethers';

export interface AaveLinearPoolFactoryCreateParameters {
  name: string;
  symbol: string;
  mainToken: string;
  wrappedToken: string;
  upperTarget: BigNumberish;
  swapFeePercentage: BigNumberish;
  owner: string;
}
