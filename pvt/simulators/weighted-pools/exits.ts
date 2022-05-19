import { getInitialTotalSupply, PRICES, BALANCES, WEIGHTS, MIN_INVARIANT_RATIO } from "./config";
import { ExactOutExitResult, TokenOutExitResult } from "./types";
import { proportionalExit } from "./common";

export function simulateExactTokensOutExit(title: string, filename: string, amountsOut: number[]) {
  const fs = require('fs');

  let data = title;

  for (let swapFee = 0.01; swapFee < 1.0; swapFee += 0.01) {
    const result = exactTokensOutExit(swapFee, amountsOut);

    if (result.valid) {
      const lossPct = (result.testValue - result.baseValue) / result.baseValue * 100;

      data += `${swapFee.toFixed(2)},${result.bptIn.toFixed(4)},${result.baseValue.toFixed(2)},${result.testValue.toFixed(2)},${lossPct.toFixed(2)}\n`;
    } else {
      data += `${swapFee.toFixed(2)},Invalid,,,\n`;
    }
  }

  fs.writeFileSync(filename, data);
}

export function simulateSingleTokenExit(title: string, filename: string, tokenIndex: number, withdrawalPct: number) {
  const fs = require('fs');

  let data = title;

  for (let swapFee = 0.01; swapFee < 1.0; swapFee += 0.01) {
    const result = singleTokenExit(swapFee, tokenIndex, withdrawalPct);

    if (result.valid) {
      const lossPct = (result.baseValue - result.testValue) / result.baseValue * 100;

      data += `${swapFee.toFixed(2)},${result.amountOut.toFixed(4)},${result.baseValue.toFixed(2)},${result.testValue.toFixed(2)},${lossPct.toFixed(2)}\n`;
    } else {
      data += `${swapFee.toFixed(2)},Invalid,,,\n`;
    }
  }

  fs.writeFileSync(filename, data);
}

function exactTokensOutExit(swapFee: number, amountsOut: number[]): ExactOutExitResult {
  const totalSupply = getInitialTotalSupply();
  // Total value of outgoing tokens
  let i;
  let baseValue = 0;
  let valid = true;
  let bptIn = 0;
  let testValue = 0;

  for (i = 0; i < amountsOut.length; i++) {
    baseValue += amountsOut[i] * PRICES[i];
  }

  // Calculate BPT In
  let balanceRatiosMinusFee: number[] = [];
  let invariantRatioMinusFee = 0;

  for (i = 0; i < amountsOut.length; i++) {
    balanceRatiosMinusFee[i] = (BALANCES[i] - amountsOut[i]) / BALANCES[i];
    invariantRatioMinusFee += balanceRatiosMinusFee[i] * WEIGHTS[i];
  }

  let contingentNonTaxable: number[] = [];
  let contingentTaxable: number[] = [];
  let contingentFee: number[] = [];

  for (i = 0; i < amountsOut.length; i++) {
    contingentNonTaxable[i] = BALANCES[i] * (1 - invariantRatioMinusFee);
    contingentTaxable[i] = amountsOut[i] - contingentNonTaxable[i];
    contingentFee[i] = contingentTaxable[i] / (1 - swapFee);
  }

  let amountsOutPlusFee: number[] = [];
  for (i = 0; i < amountsOut.length; i++) {
    amountsOutPlusFee[i] = invariantRatioMinusFee > balanceRatiosMinusFee[i] ? contingentNonTaxable[i] + contingentFee[i]: amountsOut[i];
    if (invariantRatioMinusFee > balanceRatiosMinusFee[i] && (contingentFee[i] < 0 || contingentFee[i] > BALANCES[i])) {
      valid = false;
    }
  }

  if (valid) {
    let balanceRatios: number[] = [];
    let invariantRatio = 1;
  
    for (i = 0; i < amountsOut.length; i++) {
      balanceRatios[i] = (BALANCES[i] - amountsOutPlusFee[i]) / BALANCES[i];
      invariantRatio *= balanceRatios[i] ** WEIGHTS[i];
    }

    bptIn = totalSupply * (1 - invariantRatio);

    const result = proportionalExit(totalSupply, BALANCES, bptIn);
    testValue = result.valueOut;
  }

  return {valid, bptIn, baseValue, testValue};
}

function singleTokenExit(swapFee: number, tokenIndex: number, withdrawalPct: number): TokenOutExitResult {
  let amountOut = 0;
  let baseValue = 0;
  let testValue = 0;

  const totalSupply = getInitialTotalSupply();
  // Assume we're withdrawing x% of the total supply
  const bptAmountIn = totalSupply * withdrawalPct;
  const invariantRatio = (totalSupply - bptAmountIn) / totalSupply;
  let valid = invariantRatio >= MIN_INVARIANT_RATIO;

  if (valid) {
    const balanceRatio = invariantRatio ** (1 / WEIGHTS[tokenIndex]);
    const amountOutMinusFee = BALANCES[tokenIndex] * (1 - balanceRatio);

    const taxable = amountOutMinusFee * (1 - WEIGHTS[tokenIndex]);
    const nonTaxable = amountOutMinusFee - taxable;
    const taxableMinusFee = taxable * (1 - swapFee);
    amountOut = nonTaxable + taxableMinusFee;
    
    testValue = amountOut * PRICES[tokenIndex];

    // Proportional exit with the bptAmountIn
    const result = proportionalExit(totalSupply, BALANCES, bptAmountIn);
    baseValue = result.valueOut;
  }

  return {valid, amountOut, baseValue, testValue};
}
