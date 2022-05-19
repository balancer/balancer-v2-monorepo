export type SwapResult = {
  valid: boolean;
  baseValue: number;
  testValue: number;
  amount: number; // amount In or Out
};

export type ExactInJoinResult = {
  valid: boolean;
  bptOut: number;
  baseValue: number;
  testValue: number;
};

export type ExactOutExitResult = {
  valid: boolean;
  bptIn: number;
  baseValue: number;
  testValue: number;
};

export type TokenInJoinResult = {
  valid: boolean;
  amountIn: number;
  baseValue: number;
  testValue: number;
};

export type TokenOutExitResult = {
  valid: boolean;
  amountOut: number;
  baseValue: number;
  testValue: number;
};

export type ProportionalExitResult = {
  amountsOut: number[];
  valueOut: number;
};
