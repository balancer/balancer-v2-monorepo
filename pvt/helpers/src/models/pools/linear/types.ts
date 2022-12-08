import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Account } from '../../types/types';
import { BigNumberish } from '../../../numbers';

import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';

export type RawLinearPoolDeployment = {
  mainToken: Token;
  wrappedToken: Token;
  upperTarget?: BigNumber;
  assetManagers?: string[];
  swapFeePercentage?: BigNumberish;
  pauseWindowDuration?: BigNumberish;
  bufferPeriodDuration?: BigNumberish;
  owner?: SignerWithAddress;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
  vault?: Vault;
};

export type LinearPoolDeployment = {
  mainToken: Token;
  wrappedToken: Token;
  upperTarget: BigNumber;
  assetManagers: string[];
  swapFeePercentage: BigNumberish;
  pauseWindowDuration: BigNumberish;
  bufferPeriodDuration: BigNumberish;
  owner?: SignerWithAddress;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
};

export type SwapLinearPool = {
  in: number;
  out: number;
  amount: BigNumberish;
  balances: BigNumberish[];
  recipient?: Account;
  from?: SignerWithAddress;
  lastChangeBlock?: BigNumberish;
  data?: string;
};

export type MultiExitGivenInLinearPool = {
  bptIn: BigNumberish;
  recipient?: Account;
  from?: SignerWithAddress;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
  lastChangeBlock?: BigNumberish;
};

export type ExitResult = {
  amountsOut: BigNumber[];
  dueProtocolFeeAmounts: BigNumber[];
};
