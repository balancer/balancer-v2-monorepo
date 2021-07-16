import { BigNumberish } from '@ethersproject/bignumber';

export enum PoolSpecialization {
  GeneralPool = 0,
  MinimalSwapInfoPool,
  TwoTokenPool,
}

export type FundManagement = {
  sender: string;
  fromInternalBalance: boolean;
  recipient: string;
  toInternalBalance: boolean;
};

// Swaps

export enum SwapKind {
  GivenIn = 0,
  GivenOut,
}

export type SingleSwap = {
  poolId: string;
  kind: SwapKind;
  assetIn: string;
  assetOut: string;
  amount: BigNumberish;
  userData: string;
};

export type Swap = {
  kind: SwapKind;
  singleSwap: SingleSwap;
  limit: BigNumberish;
  deadline: BigNumberish;
};

export type BatchSwapStep = {
  poolId: string;
  assetInIndex: number;
  assetOutIndex: number;
  amount: BigNumberish;
  userData: string;
};

export type BatchSwap = {
  kind: SwapKind;
  swaps: BatchSwapStep[];
  assets: string[];
  funds: FundManagement;
  limits: BigNumberish[];
  deadline: BigNumberish;
};

// Joins

export type JoinPoolRequest = {
  assets: string[];
  maxAmountsIn: BigNumberish[];
  userData: string;
  fromInternalBalance: boolean;
};

// Exit

export type ExitPoolRequest = {
  assets: string[];
  minAmountsOut: BigNumberish[];
  userData: string;
  toInternalBalance: boolean;
};

// Balance Operations

export enum UserBalanceOpKind {
  DepositInternal = 0,
  WithdrawInternal,
  TransferInternal,
  TransferExternal,
}

export type UserBalanceOp = {
  kind: UserBalanceOpKind;
  asset: string;
  amount: BigNumberish;
  sender: string;
  recipient: string;
};

export enum PoolBalanceOpKind {
  Withdraw = 0,
  Deposit = 1,
  Update = 2,
}

export type PoolBalanceOp = {
  kind: PoolBalanceOpKind;
  poolId: string;
  token: string;
  amount: BigNumberish;
};
