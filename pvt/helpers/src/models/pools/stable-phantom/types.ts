import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumber } from 'ethers';
import { BigNumberish } from '../../../numbers';

import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';
import { Account, NAry } from '../../types/types';

export type SwapStablePool = {
  in: number | Token;
  out: number | Token;
  amount: BigNumberish;
  recipient?: Account;
  from?: SignerWithAddress;
  lastChangeBlock?: BigNumberish;
  data?: string;
};

export type JoinExitStablePool = {
  recipient?: Account;
  currentBalances?: BigNumberish[];
  lastChangeBlock?: BigNumberish;
  protocolFeePercentage?: BigNumberish;
  data?: string;
  from?: SignerWithAddress;
};

export type InitStablePool = {
  initialBalances: NAry<BigNumberish>;
  from?: SignerWithAddress;
  recipient?: Account;
  protocolFeePercentage?: BigNumberish;
};

export type JoinGivenInStablePool = {
  amountsIn: NAry<BigNumberish>;
  minimumBptOut?: BigNumberish;
  from?: SignerWithAddress;
  recipient?: Account;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
  lastChangeBlock?: BigNumberish;
};

export type JoinGivenOutStablePool = {
  token: number | Token;
  bptOut: BigNumberish;
  from?: SignerWithAddress;
  recipient?: Account;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
  lastChangeBlock?: BigNumberish;
};

export type ExitGivenOutStablePool = {
  amountsOut: NAry<BigNumberish>;
  maximumBptIn?: BigNumberish;
  recipient?: Account;
  from?: SignerWithAddress;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
  lastChangeBlock?: BigNumberish;
};

export type SingleExitGivenInStablePool = {
  bptIn: BigNumberish;
  token: number | Token;
  recipient?: Account;
  from?: SignerWithAddress;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
  lastChangeBlock?: BigNumberish;
};

export type MultiExitGivenInStablePool = {
  bptIn: BigNumberish;
  recipient?: Account;
  from?: SignerWithAddress;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
  lastChangeBlock?: BigNumberish;
};

export type JoinResult = {
  amountsIn: BigNumber[];
  dueProtocolFeeAmounts: BigNumber[];
};

export type ExitResult = {
  amountsOut: BigNumber[];
  dueProtocolFeeAmounts: BigNumber[];
};

export type JoinQueryResult = {
  bptOut: BigNumber;
  amountsIn: BigNumber[];
};

export type ExitQueryResult = {
  bptIn: BigNumber;
  amountsOut: BigNumber[];
};

export type PoolQueryResult = JoinQueryResult | ExitQueryResult;

export type RawStablePhantomPoolDeployment = {
  tokens?: TokenList;
  swapFeePercentage?: BigNumberish;
  amplificationParameter?: BigNumberish;
  rateProviders?: Account[];
  tokenRateCacheDurations?: BigNumberish[];
  pauseWindowDuration?: BigNumberish;
  bufferPeriodDuration?: BigNumberish;
  owner?: SignerWithAddress;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
  vault?: Vault;
  mockedVault?: boolean;
};

export type StablePhantomPoolDeployment = {
  tokens: TokenList;
  swapFeePercentage: BigNumberish;
  amplificationParameter: BigNumberish;
  rateProviders: Account[];
  tokenRateCacheDurations: BigNumberish[];
  pauseWindowDuration?: BigNumberish;
  bufferPeriodDuration?: BigNumberish;
  owner?: SignerWithAddress;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
};

export type SwapPhantomPool = {
  in: Token;
  out: Token;
  amount: BigNumberish;
  balances?: BigNumberish[];
  recipient?: Account;
  from?: SignerWithAddress;
  lastChangeBlock?: BigNumberish;
  data?: string;
};
