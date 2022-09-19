import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';

export interface AaveLinearPoolFactoryCreateParameters {
  name: string;
  symbol: string;
  mainToken: string;
  wrappedToken: string;
  upperTarget: BigNumberish;
  swapFeePercentage: BigNumberish;
  owner: string;
}
