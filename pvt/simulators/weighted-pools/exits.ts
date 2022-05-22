import WeightedPool from './model';
import fs from 'fs';

export function simulateExactTokensOutExit(
  pool: WeightedPool,
  title: string,
  filename: string,
  amountsOut: number[]
): void {
  let data = title;

  for (let swapFee = 0.01; swapFee < 1.0; swapFee += 0.01) {
    pool.setSwapFee(swapFee);

    const result = pool.exactTokensOutExit(amountsOut);

    if (result.valid) {
      const lossPct = ((result.testValue - result.baseValue) / result.baseValue) * 100;

      data += `${swapFee.toFixed(2)},${result.bptIn.toFixed(4)},${result.baseValue.toFixed(
        2
      )},${result.testValue.toFixed(2)},${lossPct.toFixed(2)}\n`;
    } else {
      data += `${swapFee.toFixed(2)},Invalid,,,\n`;
    }
  }

  fs.writeFileSync(filename, data);
}

export function simulateSingleTokenExit(
  pool: WeightedPool,
  title: string,
  filename: string,
  tokenIndex: number,
  withdrawalPct: number
): void {
  let data = title;

  const totalSupply = pool.getTotalSupply();
  // Assume we're withdrawing x% of the total supply
  const bptAmountIn = totalSupply * withdrawalPct;

  for (let swapFee = 0.01; swapFee < 1.0; swapFee += 0.01) {
    pool.setSwapFee(swapFee);

    const result = pool.singleTokenExit(tokenIndex, bptAmountIn);

    if (result.valid) {
      const lossPct = ((result.baseValue - result.testValue) / result.baseValue) * 100;

      data += `${swapFee.toFixed(2)},${result.amountOut.toFixed(4)},${result.baseValue.toFixed(
        2
      )},${result.testValue.toFixed(2)},${lossPct.toFixed(2)}\n`;
    } else {
      data += `${swapFee.toFixed(2)},Invalid,,,\n`;
    }
  }

  fs.writeFileSync(filename, data);
}
