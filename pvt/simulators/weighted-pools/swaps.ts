import WeightedPool from './model';
import fs from 'fs';

export enum SwapKind {
  GivenIn = 0,
  GivenOut,
}

export function simulateSwap(
  pool: WeightedPool,
  kind: SwapKind,
  title: string,
  filename: string,
  swapAmount: number,
  indexIn: number,
  indexOut: number
): void {
  // accumulate the string to write to the CSV file in data
  let data = title;

  // Try all swap fees from 1-99%
  for (let swapFee = 0.01; swapFee < 1.0; swapFee += 0.01) {
    pool.setSwapFee(swapFee);

    // Swapping token 0 for token 1 (BAL for WETH)
    const result =
      kind == SwapKind.GivenIn
        ? pool.swapGivenIn(swapAmount, indexIn, indexOut)
        : pool.swapGivenOut(swapAmount, indexIn, indexOut);

    if (result.valid) {
      const lossPct =
        result.baseValue > result.testValue
          ? ((result.baseValue - result.testValue) / result.baseValue) * 100
          : ((result.testValue - result.baseValue) / result.baseValue) * 100;

      data += `${swapFee.toFixed(2)},${result.amount.toFixed(4)},${result.baseValue.toFixed(
        2
      )},${result.testValue.toFixed(2)},${lossPct.toFixed(2)}\n`;
    } else {
      data += `${swapFee.toFixed(2)},Invalid,,,\n`;
    }
  }

  fs.writeFileSync(filename, data);
}
