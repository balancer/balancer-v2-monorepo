import { BigNumber, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { BigNumberish } from '../../../numbers';

import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';
import { Account, NAry } from '../../types/types';
import Vault from '../../vault/Vault';

export enum WeightedPoolType {
  WEIGHTED_POOL = 0,
  ORACLE_WEIGHTED_POOL,
  LIQUIDITY_BOOTSTRAPPING_POOL,
  MANAGED_POOL,
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
  mustAllowlistLPs?: boolean;
  managementSwapFeePercentage?: BigNumberish;
  owner?: Account;
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
  mustAllowlistLPs: boolean;
  managementSwapFeePercentage: BigNumberish;
  owner?: string;
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

export type JoinAllGivenOutWeightedPool = {
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
  receipt: ContractReceipt;
};

export type ExitResult = {
  amountsOut: BigNumber[];
  dueProtocolFeeAmounts: BigNumber[];
  receipt: ContractReceipt;
};

export type SwapResult = {
  amount: BigNumber;
  receipt: ContractReceipt;
};

export type JoinQueryResult = {
  bptOut: BigNumber;
  amountsIn: BigNumber[];
};

export type ExitQueryResult = {
  bptIn: BigNumber;
  amountsOut: BigNumber[];
};

export type VoidResult = {
  receipt: ContractReceipt;
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

export type TokenCollectedFees = {
  amounts: BigNumber[];
  tokenAddresses: string[];
};

export type BasePoolRights = {
  canTransferOwnership: boolean;
  canChangeSwapFee: boolean;
  canUpdateMetadata: boolean;
};

export type ManagedPoolRights = {
  canChangeWeights: boolean;
  canDisableSwaps: boolean;
  canSetMustAllowlistLPs: boolean;
  canSetCircuitBreakers: boolean;
  canChangeTokens: boolean;
  canChangeMgmtSwapFee: boolean;
};

export type ManagedPoolParams = {
  vault: string;
  name: string;
  symbol: string;
  tokens: string[];
  normalizedWeights: BigNumberish[];
  assetManagers: string[];
  swapFeePercentage: BigNumberish;
  pauseWindowDuration: number;
  bufferPeriodDuration: number;
  owner: string;
  swapEnabledOnStart: boolean;
  mustAllowlistLPs: boolean;
  managementSwapFeePercentage: BigNumberish;
};
