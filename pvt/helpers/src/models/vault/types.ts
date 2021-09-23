import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Account } from '../types/types';
import { BigNumberish } from '../../numbers';

export type RawVaultDeployment = {
  mocked?: boolean;
  admin?: SignerWithAddress;
  pauseWindowDuration?: BigNumberish;
  bufferPeriodDuration?: BigNumberish;
  from?: SignerWithAddress;
};

export type VaultDeployment = {
  mocked: boolean;
  pauseWindowDuration: BigNumberish;
  bufferPeriodDuration: BigNumberish;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
};

export type Swap = {
  kind: number;
  poolAddress: string;
  poolId: string;
  to: Account;
  tokenIn: string;
  tokenOut: string;
  lastChangeBlock: BigNumberish;
  data: string;
  amount: BigNumberish;
  from?: SignerWithAddress;
};

export type MinimalSwap = Swap & {
  balanceTokenIn: BigNumberish;
  balanceTokenOut: BigNumberish;
};

export type GeneralSwap = Swap & {
  balances: BigNumberish[];
  indexIn: number;
  indexOut: number;
};

export type JoinPool = {
  poolId: string;
  tokens: string[];
  poolAddress?: string;
  recipient?: string;
  currentBalances?: BigNumberish[];
  lastChangeBlock?: BigNumberish;
  protocolFeePercentage?: BigNumberish;
  data?: string;
  maxAmountsIn?: BigNumberish[];
  fromInternalBalance?: boolean;
  from?: SignerWithAddress;
};

export type ExitPool = {
  poolId: string;
  tokens: string[];
  poolAddress?: string;
  recipient?: string;
  currentBalances?: BigNumberish[];
  lastChangeBlock?: BigNumberish;
  protocolFeePercentage?: BigNumberish;
  data?: string;
  minAmountsOut?: BigNumberish[];
  toInternalBalance?: boolean;
  from?: SignerWithAddress;
};
