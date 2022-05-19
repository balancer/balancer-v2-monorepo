import { BALANCES, WEIGHTS, PRICES, MAX_IN_RATIO, MAX_OUT_RATIO } from "./config";
import { SwapResult } from "./types";

export function simulateSwap(title: string, filename: string, swapAmount: number, indexIn: number, indexOut: number, action: (fee: number, amount: number, indexIn: number, indexOut: number) => SwapResult) {
  const fs = require('fs');

  // accumulate the string to write to the CSV file in data
  let data = title;

  // Try all swap fees from 1-99%
  for (let swapFee = 0.01; swapFee < 1.0; swapFee += 0.01) {
    // Swapping token 0 for token 1 (BAL for WETH)
    const result = action(swapFee, swapAmount, indexIn, indexOut);

    if (result.valid) {
      const lossPct = result.baseValue > result.testValue
        ? (result.baseValue - result.testValue) / result.baseValue * 100
        : (result.testValue - result.baseValue) / result.baseValue * 100;

      data += `${swapFee.toFixed(2)},${result.amount.toFixed(4)},${result.baseValue.toFixed(
        2
      )},${result.testValue.toFixed(2)},${lossPct.toFixed(2)}\n`;
    } else {
      data += `${swapFee.toFixed(2)},Invalid,,,\n`;
    }
  }

  fs.writeFileSync(filename, data);
}

// We are swapping amountIn of tokenIn for a computed amount of tokenOut
export function swapGivenIn(swapFee: number, amountIn: number, indexTokenIn: number, indexTokenOut: number): SwapResult {
  let valid = amountIn < BALANCES[indexTokenIn] * MAX_IN_RATIO;
  let baseValue = 0;
  let testValue = 0;
  let amountOut = 0;

  if (valid) {
    const amountInMinusFees = amountIn * (1 - swapFee);

    const base = BALANCES[indexTokenIn] / (BALANCES[indexTokenIn] + amountInMinusFees);
    const exp = WEIGHTS[indexTokenIn] / WEIGHTS[indexTokenOut];
    const amountRatio = base ** exp;
  
    amountOut = BALANCES[indexTokenOut] * (1 - amountRatio);
    valid = amountRatio < 1 && amountOut < BALANCES[indexTokenOut];
    
    if (valid) {
      // baseValue is the value of the token we're sending in
      baseValue = amountIn * PRICES[indexTokenIn];
      // testValue is the value of the amountOut we get for it - it will decrease as the swap fee increases
      testValue = amountOut * PRICES[indexTokenOut];
    }
  }

  return { valid, baseValue, testValue, amount: amountOut };
}

// We are swapping a computed amount of tokenIn for amountOut tokenOut
export function swapGivenOut(swapFee: number, amountOut: number, indexTokenIn: number, indexTokenOut: number): SwapResult {
  let valid = amountOut < BALANCES[indexTokenOut] * MAX_OUT_RATIO;
  let baseValue = 0;
  let testValue = 0;
  let amountIn = 0;

  if (valid) {
    const base = BALANCES[indexTokenOut] / (BALANCES[indexTokenOut] - amountOut);
    const exp = WEIGHTS[indexTokenOut] / WEIGHTS[indexTokenIn];
    const amountRatio = base ** exp - 1;
    const amountInMinusFees = BALANCES[indexTokenIn] * amountRatio;
    amountIn = amountInMinusFees / (1 - swapFee);
    valid = amountIn > 0;

    if (valid) {
      // baseValue is the value of the token we're getting out
      baseValue = amountOut * PRICES[indexTokenOut];
      // testValue is the value of the token we need to send in
      testValue = amountIn * PRICES[indexTokenIn];
    }
  }


  return { valid, baseValue, testValue, amount: amountIn };
}
