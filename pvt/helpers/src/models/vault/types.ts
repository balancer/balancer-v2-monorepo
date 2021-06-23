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
  balanceTokenIn: BigNumberish;
  balanceTokenOut: BigNumberish;
  from?: SignerWithAddress;
};

export type GeneralSwap = {
  kind: number;
  poolAddress: string;
  poolId: string;
  to: Account;
  indexIn: number;
  indexOut: number;
  tokenIn: string;
  tokenOut: string;
  lastChangeBlock: BigNumberish;
  data: string;
  amount: BigNumberish;
  balances: BigNumberish[];
  from?: SignerWithAddress;
};

export type JoinPool = {
  poolAddress: string;
  poolId: string;
  recipient: string;
  currentBalances: BigNumberish[];
  tokens: string[];
  lastChangeBlock: BigNumberish;
  protocolFeePercentage: BigNumberish;
  data: string;
  maxAmountsIn?: BigNumberish[];
  fromInternalBalance?: boolean;
  from?: SignerWithAddress;
};

export type ExitPool = {
  poolAddress: string;
  poolId: string;
  recipient: string;
  currentBalances: BigNumberish[];
  tokens: string[];
  lastChangeBlock: BigNumberish;
  protocolFeePercentage: BigNumberish;
  data: string;
  minAmountsOut?: BigNumberish[];
  toInternalBalance?: boolean;
  from?: SignerWithAddress;
};
