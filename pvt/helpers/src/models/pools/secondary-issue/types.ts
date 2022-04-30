import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Account } from '../../types/types';
import { BigNumberish } from '../../../numbers';

import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';

export type RawSecondaryPoolDeployment = {
  securityToken: Token;
  currencyToken: Token;
  maxSecurityOffered?: BigNumberish;
  swapFeePercentage?: BigNumberish;
  pauseWindowDuration?: BigNumberish;
  bufferPeriodDuration?: BigNumberish;
  owner?: SignerWithAddress;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
  vault?: Vault;
};

export type SecondaryPoolDeployment = {
  securityToken: Token;
  currencyToken: Token;
  maxSecurityOffered: BigNumberish;
  swapFeePercentage: BigNumberish;
  pauseWindowDuration: BigNumberish;
  bufferPeriodDuration: BigNumberish;
  owner?: SignerWithAddress;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
};

export type SwapSecondaryPool = {
  in: number;
  out: number;
  amount: BigNumberish;
  balances: BigNumberish[];
  recipient?: Account;
  from?: SignerWithAddress;
  lastChangeBlock?: BigNumberish;
  data?: string;
};

export type ExitResult = {
  amountsOut: BigNumber[];
  dueProtocolFeeAmounts: BigNumber[];
};
