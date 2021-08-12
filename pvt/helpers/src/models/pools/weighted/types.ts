import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { BigNumberish } from '../../../numbers';

import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';
import { Account, NAry } from '../../types/types';
import Vault from '../../vault/Vault';

export enum WeightedPoolType {
  WEIGHTED_POOL = 0,
  WEIGHTED_POOL_2TOKENS,
  LIQUIDITY_BOOTSTRAPPING_POOL,
  INVESTMENT_POOL,
}

export type RawWeightedPoolDeployment = {
  tokens?: TokenList;
  weights?: BigNumberish[];
  assetManagers?: string[];
  swapFeePercentage?: BigNumberish;
  pauseWindowDuration?: BigNumberish;
  bufferPeriodDuration?: BigNumberish;
  oracleEnabled?: boolean;
  swapEnabledOnStart?: boolean;
  owner?: SignerWithAddress;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
  vault?: Vault;
  fromFactory?: boolean;
  poolType?: WeightedPoolType;
};

export type WeightedPoolDeployment = {
  tokens: TokenList;
  weights: BigNumberish[];
  assetManagers: string[];
  swapFeePercentage: BigNumberish;
  pauseWindowDuration: BigNumberish;
  bufferPeriodDuration: BigNumberish;
  poolType: WeightedPoolType;
  oracleEnabled: boolean;
  swapEnabledOnStart: boolean;
  owner?: SignerWithAddress;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
};

export type SwapWeightedPool = {
  in: number | Token;
  out: number | Token;
  amount: BigNumberish;
  recipient?: Account;
  from?: SignerWithAddress;
  lastChangeBlock?: BigNumberish;
  data?: string;
};

export type JoinExitWeightedPool = {
  recipient?: Account;
  currentBalances?: BigNumberish[];
  lastChangeBlock?: BigNumberish;
  protocolFeePercentage?: BigNumberish;
  data?: string;
  from?: SignerWithAddress;
};

export type InitWeightedPool = {
  initialBalances: NAry<BigNumberish>;
  from?: SignerWithAddress;
  recipient?: Account;
  protocolFeePercentage?: BigNumberish;
};

export type JoinGivenInWeightedPool = {
  amountsIn: NAry<BigNumberish>;
  minimumBptOut?: BigNumberish;
  from?: SignerWithAddress;
  recipient?: Account;
  lastChangeBlock?: BigNumberish;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
};

export type JoinGivenOutWeightedPool = {
  token: number | Token;
  bptOut: BigNumberish;
  from?: SignerWithAddress;
  recipient?: Account;
  lastChangeBlock?: BigNumberish;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
};

export type ExitGivenOutWeightedPool = {
  amountsOut: NAry<BigNumberish>;
  maximumBptIn?: BigNumberish;
  recipient?: Account;
  from?: SignerWithAddress;
  lastChangeBlock?: BigNumberish;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
};

export type SingleExitGivenInWeightedPool = {
  bptIn: BigNumberish;
  token: number | Token;
  recipient?: Account;
  from?: SignerWithAddress;
  lastChangeBlock?: BigNumberish;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
};

export type MultiExitGivenInWeightedPool = {
  bptIn: BigNumberish;
  recipient?: Account;
  from?: SignerWithAddress;
  lastChangeBlock?: BigNumberish;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
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

export type MiscData = {
  swapFeePercentage: BigNumber;
  oracleEnabled: boolean;
  oracleIndex: BigNumber;
  oracleSampleCreationTimestamp: BigNumber;
  logTotalSupply: BigNumber;
  logInvariant: BigNumber;
};

export type Sample = {
  logPairPrice: BigNumber;
  accLogPairPrice: BigNumber;
  logBptPrice: BigNumber;
  accLogBptPrice: BigNumber;
  logInvariant: BigNumber;
  accLogInvariant: BigNumber;
  timestamp: BigNumber;
};

export type PoolQueryResult = JoinQueryResult | ExitQueryResult;

export type GradualUpdateParams = {
  startTime: BigNumber;
  endTime: BigNumber;
  endWeights: BigNumber[];
};
