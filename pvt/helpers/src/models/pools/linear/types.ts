import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumber } from 'ethers';

import { BigNumberish } from '../../../numbers';

import Token from '../../tokens/Token';
import { Account } from '../../types/types';
import Vault from '../../vault/Vault';

export type RawLinearPoolDeployment = {
  mainToken: Token;
  wrappedToken: Token;
  lowerTarget?: BigNumber;
  upperTarget?: BigNumber;
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
  lowerTarget: BigNumber;
  upperTarget: BigNumber;
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
