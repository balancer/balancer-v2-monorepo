import {
  ProportionalExitResult,
  SwapResult,
  ExactInJoinResult,
  TokenInJoinResult,
  ExactOutExitResult,
  TokenOutExitResult,
} from './types';
import { MAX_IN_RATIO, MAX_OUT_RATIO, MAX_INVARIANT_RATIO, MIN_INVARIANT_RATIO } from './config';

export default class WeightedPool {
  tokens: string[];
  weights: number[];
  balances: number[];
  swapFee: number;

  totalSupply: number;
  numTokens: number;
  prices: number[];
  /* eslint-disable @typescript-eslint/no-explicit-any */
  indices: any;

  constructor(tokens: string[], weights: number[], swapFee: number) {
    this.tokens = tokens;
    this.weights = weights;
    this.swapFee = swapFee;
    this.balances = [];
    this.totalSupply = 0;
    this.numTokens = this.tokens.length;
    this.prices = [];
    this.indices = {};

    for (let i = 0; i < this.numTokens; i++) {
      this.indices[this.tokens[i]] = i;
    }

    this.validate();
  }

  initialize(totalLiquidity: number, prices: number[]): void {
    if (prices.length != this.tokens.length) {
      throw Error('Input length mismatch');
    }

    if (totalLiquidity <= 0) {
      throw Error('Liquidity must be > 0');
    }

    this.prices = prices;
    this.totalSupply = 2;

    // Compute the balances from the weights and total liquidity
    for (let i = 0; i < prices.length; i++) {
      this.balances[i] = (totalLiquidity * this.weights[i]) / prices[i];
      this.totalSupply *= this.balances[i] ** this.weights[i];
    }
  }

  validate(): void {
    let sum = 0;
    this.weights.map((w) => (sum += w));

    if (sum != 1) {
      throw Error('Weights must sum to 1');
    }
  }

  getNumTokens(): number {
    return this.numTokens;
  }

  getTokens(): string[] {
    return this.tokens;
  }

  getBalances(): number[] {
    return this.balances;
  }

  getTotalSupply(): number {
    return this.totalSupply;
  }

  getSwapFee(): number {
    return this.swapFee;
  }

  setSwapFee(swapFee: number): void {
    if (swapFee < 0.0001 || swapFee > 1) {
      throw Error('Invalid swap fee');
    }

    this.swapFee = swapFee;
  }

  indexOf(token: string): number {
    return this.indices[token];
  }

  getPrices(): number[] {
    return this.prices;
  }

  // We are swapping amountIn of tokenIn for a computed amount of tokenOut
  swapGivenIn(amountIn: number, indexTokenIn: number, indexTokenOut: number, update = false): SwapResult {
    let valid = amountIn < this.balances[indexTokenIn] * MAX_IN_RATIO;
    let baseValue = 0;
    let testValue = 0;
    let amountOut = 0;

    if (valid) {
      const amountInMinusFees = amountIn * (1 - this.swapFee);

      const base = this.balances[indexTokenIn] / (this.balances[indexTokenIn] + amountInMinusFees);
      const exp = this.weights[indexTokenIn] / this.weights[indexTokenOut];
      const amountRatio = base ** exp;

      amountOut = this.balances[indexTokenOut] * (1 - amountRatio);
      valid = amountRatio < 1 && amountOut < this.balances[indexTokenOut];

      if (valid) {
        // baseValue is the value of the token we're sending in
        baseValue = amountIn * this.prices[indexTokenIn];
        // testValue is the value of the amountOut we get for it - it will decrease as the swap fee increases
        testValue = amountOut * this.prices[indexTokenOut];
      }
    }

    if (valid && update) {
      this.balances[indexTokenOut] -= amountOut;
      this.balances[indexTokenIn] += amountIn;
    }

    return { valid, baseValue, testValue, amount: amountOut };
  }

  // We are swapping a computed amount of tokenIn for amountOut tokenOut
  swapGivenOut(amountOut: number, indexTokenIn: number, indexTokenOut: number, update = false): SwapResult {
    let valid = amountOut < this.balances[indexTokenOut] * MAX_OUT_RATIO;
    let baseValue = 0;
    let testValue = 0;
    let amountIn = 0;

    if (valid) {
      const base = this.balances[indexTokenOut] / (this.balances[indexTokenOut] - amountOut);
      const exp = this.weights[indexTokenOut] / this.weights[indexTokenIn];
      const amountRatio = base ** exp - 1;
      const amountInMinusFees = this.balances[indexTokenIn] * amountRatio;
      amountIn = amountInMinusFees / (1 - this.swapFee);
      valid = amountIn > 0;

      if (valid) {
        // baseValue is the value of the token we're getting out
        baseValue = amountOut * this.prices[indexTokenOut];
        // testValue is the value of the token we need to send in
        testValue = amountIn * this.prices[indexTokenIn];
      }
    }

    if (valid && update) {
      this.balances[indexTokenOut] += amountOut;
      this.balances[indexTokenIn] -= amountIn;
    }

    return { valid, baseValue, testValue, amount: amountIn };
  }

  proportionalExit(bptIn: number): ProportionalExitResult {
    if (this.totalSupply == 0 || this.prices.length == 0) {
      throw Error('Uninitialized pool');
    }

    const bptRatio = bptIn / this.totalSupply;

    const tokensOut: number[] = [];
    let valueOut = 0;

    for (let i = 0; i < this.numTokens; i++) {
      tokensOut[i] = this.balances[i] * bptRatio;
      valueOut += tokensOut[i] * this.prices[i];
    }

    return { amountsOut: tokensOut, valueOut };
  }

  exactTokensInJoin(amountsIn: number[], update = false): ExactInJoinResult {
    // Total value of incoming tokens
    let i;
    let bptOut = 0;
    let baseValue = 0;
    let testValue = 0;

    for (i = 0; i < amountsIn.length; i++) {
      baseValue += amountsIn[i] * this.prices[i];
    }

    // Calculate BPT out
    const balanceRatiosWithFee: number[] = [];
    let invariantWithFees = 0;
    for (i = 0; i < amountsIn.length; i++) {
      balanceRatiosWithFee[i] = (this.balances[i] + amountsIn[i]) / this.balances[i];
      invariantWithFees += balanceRatiosWithFee[i] * this.weights[i];
    }

    // Compute the amounts that will be used if the balanceRatioWithFee > invariantWithFees
    const contingentNonTaxable: number[] = [];
    const contingentTaxable: number[] = [];
    const contingentFee: number[] = [];
    let valid = true;

    for (i = 0; i < amountsIn.length; i++) {
      contingentNonTaxable[i] = this.balances[i] * (invariantWithFees - 1);
      contingentTaxable[i] = amountsIn[i] - contingentNonTaxable[i];
      contingentFee[i] = contingentTaxable[i] * this.swapFee;
    }

    const amountInWithoutFee: number[] = [];
    for (i = 0; i < amountsIn.length; i++) {
      amountInWithoutFee[i] =
        balanceRatiosWithFee[i] > invariantWithFees
          ? contingentNonTaxable[i] + contingentTaxable[i] - contingentFee[i]
          : amountsIn[i];

      if (amountInWithoutFee[i] < 0) {
        valid = false;
      }
    }

    if (valid) {
      const balanceRatios: number[] = [];
      let invariantRatio = 1;

      for (i = 0; i < amountsIn.length; i++) {
        balanceRatios[i] = (this.balances[i] + amountInWithoutFee[i]) / this.balances[i];

        invariantRatio *= balanceRatios[i] ** this.weights[i];
      }

      bptOut = invariantRatio > 1 ? this.totalSupply * (invariantRatio - 1) : 0;

      // actualValue of the BPT is the dollar value of the tokens you'd get from a proportional withdrawal
      const result = this.proportionalExit(bptOut);

      testValue = result.valueOut;
    }

    if (valid && update) {
      for (i = 0; i < this.numTokens; i++) {
        this.balances[i] += amountsIn[i];
      }
      this.totalSupply += bptOut;
    }

    return { valid, bptOut, baseValue, testValue };
  }

  singleTokenJoin(tokenIndex: number, bptAmountOut: number, update = false): TokenInJoinResult {
    let amountIn = 0;
    let baseValue = 0;
    let testValue = 0;

    const invariantRatio = (this.totalSupply + bptAmountOut) / this.totalSupply;
    const valid = invariantRatio <= MAX_INVARIANT_RATIO;

    if (valid) {
      const balanceRatio = invariantRatio ** (1 / this.weights[tokenIndex]);
      const amountInMinusFee = this.balances[tokenIndex] * (balanceRatio - 1);

      const taxable = amountInMinusFee * (1 - this.weights[tokenIndex]);
      const nonTaxable = amountInMinusFee - taxable;
      const taxableWithFee = taxable / (1 - this.swapFee);
      amountIn = nonTaxable + taxableWithFee;

      testValue = amountIn * this.prices[tokenIndex];

      const result = this.proportionalExit(bptAmountOut);

      baseValue = result.valueOut;
    }

    if (valid && update) {
      this.balances[tokenIndex] += amountIn;
      this.totalSupply += bptAmountOut;
    }

    return { valid, amountIn, baseValue, testValue };
  }

  exactTokensOutExit(amountsOut: number[], update = false): ExactOutExitResult {
    // Total value of outgoing tokens
    let i;
    let baseValue = 0;
    let valid = true;
    let bptIn = 0;
    let testValue = 0;

    for (i = 0; i < amountsOut.length; i++) {
      baseValue += amountsOut[i] * this.prices[i];
    }

    // Calculate BPT In
    const balanceRatiosMinusFee: number[] = [];
    let invariantRatioMinusFee = 0;

    for (i = 0; i < amountsOut.length; i++) {
      balanceRatiosMinusFee[i] = (this.balances[i] - amountsOut[i]) / this.balances[i];
      invariantRatioMinusFee += balanceRatiosMinusFee[i] * this.weights[i];
    }

    const contingentNonTaxable: number[] = [];
    const contingentTaxable: number[] = [];
    const contingentFee: number[] = [];

    for (i = 0; i < amountsOut.length; i++) {
      contingentNonTaxable[i] = this.balances[i] * (1 - invariantRatioMinusFee);
      contingentTaxable[i] = amountsOut[i] - contingentNonTaxable[i];
      contingentFee[i] = contingentTaxable[i] / (1 - this.swapFee);
    }

    const amountsOutPlusFee: number[] = [];
    for (i = 0; i < amountsOut.length; i++) {
      amountsOutPlusFee[i] =
        invariantRatioMinusFee > balanceRatiosMinusFee[i] ? contingentNonTaxable[i] + contingentFee[i] : amountsOut[i];
      if (
        invariantRatioMinusFee > balanceRatiosMinusFee[i] &&
        (contingentFee[i] < 0 || contingentFee[i] > this.balances[i])
      ) {
        valid = false;
      }
    }

    if (valid) {
      const balanceRatios: number[] = [];
      let invariantRatio = 1;

      for (i = 0; i < amountsOut.length; i++) {
        balanceRatios[i] = (this.balances[i] - amountsOutPlusFee[i]) / this.balances[i];
        invariantRatio *= balanceRatios[i] ** this.weights[i];
      }

      bptIn = this.totalSupply * (1 - invariantRatio);

      const result = this.proportionalExit(bptIn);
      testValue = result.valueOut;
    }

    if (valid && update) {
      for (i = 0; i < this.numTokens; i++) {
        this.balances[i] -= amountsOut[i];
        this.totalSupply -= bptIn;
      }
    }

    return { valid, bptIn, baseValue, testValue };
  }

  singleTokenExit(tokenIndex: number, bptAmountIn: number, update = false): TokenOutExitResult {
    let amountOut = 0;
    let baseValue = 0;
    let testValue = 0;

    const invariantRatio = (this.totalSupply - bptAmountIn) / this.totalSupply;
    const valid = invariantRatio >= MIN_INVARIANT_RATIO;

    if (valid) {
      const balanceRatio = invariantRatio ** (1 / this.weights[tokenIndex]);
      const amountOutMinusFee = this.balances[tokenIndex] * (1 - balanceRatio);

      const taxable = amountOutMinusFee * (1 - this.weights[tokenIndex]);
      const nonTaxable = amountOutMinusFee - taxable;
      const taxableMinusFee = taxable * (1 - this.swapFee);
      amountOut = nonTaxable + taxableMinusFee;

      testValue = amountOut * this.prices[tokenIndex];

      // Proportional exit with the bptAmountIn
      const result = this.proportionalExit(bptAmountIn);
      baseValue = result.valueOut;
    }

    if (valid && update) {
      this.balances[tokenIndex] -= amountOut;
      this.totalSupply -= bptAmountIn;
    }

    return { valid, amountOut, baseValue, testValue };
  }
}
