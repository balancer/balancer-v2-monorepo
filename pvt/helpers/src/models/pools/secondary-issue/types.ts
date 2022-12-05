import { BigNumber, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Account, NAry } from '../../types/types';
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
  eventHash?: string;
};

export type JoinExitSecondaryPool = {
  recipient?: Account;
  currentBalances?: BigNumberish[];
  lastChangeBlock?: BigNumberish;
  protocolFeePercentage?: BigNumberish;
  data?: string;
  from?: SignerWithAddress;
};

export type InitPrimaryPool = {
  initialBalances: NAry<BigNumberish>;
  from?: SignerWithAddress;
  recipient?: Account;
  protocolFeePercentage?: BigNumberish;
};

export type JoinResult = {
  amountsIn: BigNumber[];
  dueProtocolFeeAmounts: BigNumber[];
  receipt: ContractReceipt;
};

export type ExitResult = {
  amountsOut: BigNumber[];
  dueProtocolFeeAmounts: BigNumber[];
  receipt: ContractReceipt;
};

export type ExitGivenOutPrimaryPool = {
  amountsOut?: NAry<BigNumberish>;
  bptAmountIn: BigNumberish;
  recipient?: Account;
  from?: SignerWithAddress;
  lastChangeBlock?: BigNumberish;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
};