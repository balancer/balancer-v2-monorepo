import { getInitialTotalSupply, PRICES, BALANCES, WEIGHTS, MAX_INVARIANT_RATIO } from "./config";
import { ExactInJoinResult, TokenInJoinResult } from "./types";
import { proportionalExit } from "./common";

export function simulateExactTokensInJoin(title: string, filename: string, amountsIn: number[]) {
  const fs = require('fs');

  let data = title;

  for (let swapFee = 0.01; swapFee < 1.0; swapFee += 0.01) {
    const result = exactTokensInJoin(swapFee, amountsIn);

    if (result.valid) {
      const lossPct = (result.baseValue - result.testValue) / result.baseValue * 100;

      data += `${swapFee.toFixed(2)},${result.bptOut.toFixed(4)},${result.baseValue.toFixed(2)},${result.testValue.toFixed(2)},${lossPct.toFixed(2)}\n`;
    } else {
      data += `${swapFee.toFixed(2)},Invalid,,,\n`;
    }
  }

  fs.writeFileSync(filename, data);
}

export function simulateSingleTokenJoin(title: string, filename: string, tokenIndex: number, depositPct: number) {
  const fs = require('fs');

  let data = title;

  for (let swapFee = 0.01; swapFee < 1.0; swapFee += 0.01) {
    const result = singleTokenJoin(swapFee, tokenIndex, depositPct);

    if (result.valid) {
      const lossPct = (result.testValue - result.baseValue) / result.baseValue * 100;

      data += `${swapFee.toFixed(2)},${result.amountIn.toFixed(4)},${result.baseValue.toFixed(2)},${result.testValue.toFixed(2)},${lossPct.toFixed(2)}\n`;
    } else {
      data += `${swapFee.toFixed(2)},Invalid,,,\n`;
    }
  }

  fs.writeFileSync(filename, data);
}

function exactTokensInJoin(swapFee: number, amountsIn: number[]): ExactInJoinResult {
  // Total value of incoming tokens
  let i;
  let bptOut = 0;
  let baseValue = 0;
  // Compute initial total supply
  let totalSupply = getInitialTotalSupply();
  let testValue = 0;

  for (i = 0; i < amountsIn.length; i++) {
    baseValue += amountsIn[i] * PRICES[i];
  }

  // Calculate BPT out
  let balanceRatiosWithFee: number[] = [];
  let invariantWithFees = 0;
  for (i = 0; i < amountsIn.length; i++) {
    balanceRatiosWithFee[i] = (BALANCES[i] + amountsIn[i]) / BALANCES[i];
    invariantWithFees += balanceRatiosWithFee[i] * WEIGHTS[i];
  }

  // Compute the amounts that will be used if the balanceRatioWithFee > invariantWithFees
  let contingentNonTaxable: number[] = [];
  let contingentTaxable: number[] = [];
  let contingentFee: number[] = [];
  let valid: boolean = true;

  for (i = 0; i < amountsIn.length; i++) {
    contingentNonTaxable[i] = BALANCES[i] * (invariantWithFees - 1);
    contingentTaxable[i] = amountsIn[i] - contingentNonTaxable[i];
    contingentFee[i] = contingentTaxable[i] * swapFee;
  }

  let amountInWithoutFee: number[] = [];
  for (i = 0; i < amountsIn.length; i++) {
    amountInWithoutFee[i] = balanceRatiosWithFee[i] > invariantWithFees
      ? contingentNonTaxable[i] + contingentTaxable[i] - contingentFee[i]
      : amountsIn[i];

    if (amountInWithoutFee[i] < 0) {
      valid = false;
    }
  }

  if (valid) {
    let balanceRatios: number[] = [];
    let invariantRatio = 1;

    for (i = 0; i < amountsIn.length; i++) {
      balanceRatios[i] = (BALANCES[i] + amountInWithoutFee[i]) / BALANCES[i];

      invariantRatio *= balanceRatios[i] ** WEIGHTS[i];
    }

    bptOut = invariantRatio > 1 ? totalSupply * (invariantRatio - 1) : 0;

    // actualValue of the BPT is the dollar value of the tokens you'd get from a proportional withdrawal
    const result = proportionalExit(totalSupply, BALANCES, bptOut);

    testValue = result.valueOut;
  }

  return {valid, bptOut, baseValue, testValue };
}

function singleTokenJoin(swapFee: number, tokenIndex: number, depositPct: number): TokenInJoinResult {
  const totalSupply = getInitialTotalSupply();
  // Assume we're depositing x% of the total supply
  const bptAmountOut = totalSupply * depositPct;
  let amountIn = 0;
  let baseValue = 0;
  let testValue = 0;

  const invariantRatio = (totalSupply + bptAmountOut) / totalSupply;
  let valid = invariantRatio <= MAX_INVARIANT_RATIO;

  if (valid) {
    const balanceRatio = invariantRatio ** (1 / WEIGHTS[tokenIndex]);
    const amountInMinusFee = BALANCES[tokenIndex] * (balanceRatio - 1);
  
    const taxable = amountInMinusFee * (1 - WEIGHTS[tokenIndex]);
    const nonTaxable = amountInMinusFee - taxable;
    const taxableWithFee = taxable / (1 - swapFee);
    amountIn = nonTaxable + taxableWithFee;
    
    testValue = amountIn * PRICES[tokenIndex];
  
    const result = proportionalExit(totalSupply, BALANCES, bptAmountOut);
  
    baseValue = result.valueOut;
  }

  return {valid, amountIn, baseValue, testValue};
}
