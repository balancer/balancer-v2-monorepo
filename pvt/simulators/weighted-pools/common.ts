import { ProportionalExitResult } from "./types";
import { BALANCES, PRICES } from "./config";

export function proportionalExit(totalSupply: number, balances: number[], bptIn: number) : ProportionalExitResult {
  const bptRatio = bptIn / totalSupply;

  let tokensOut: number[] = [];
  let valueOut = 0;

  for (let i = 0; i < BALANCES.length; i++) {
    tokensOut[i] = balances[i] * bptRatio;
    valueOut += tokensOut[i] * PRICES[i];
  }

  return {amountsOut: tokensOut, valueOut};
}
