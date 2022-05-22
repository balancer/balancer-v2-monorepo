import WeightedPool from './model';
import fs from 'fs';

export function simulateExactTokensInJoin(
  pool: WeightedPool,
  title: string,
  filename: string,
  amountsIn: number[]
): void {
  let data = title;

  for (let swapFee = 0.01; swapFee < 1.0; swapFee += 0.01) {
    pool.setSwapFee(swapFee);

    const result = pool.exactTokensInJoin(amountsIn);

    if (result.valid) {
      const lossPct = ((result.baseValue - result.testValue) / result.baseValue) * 100;

      data += `${swapFee.toFixed(2)},${result.bptOut.toFixed(4)},${result.baseValue.toFixed(
        2
      )},${result.testValue.toFixed(2)},${lossPct.toFixed(2)}\n`;
    } else {
      data += `${swapFee.toFixed(2)},Invalid,,,\n`;
    }
  }

  fs.writeFileSync(filename, data);
}

export function simulateSingleTokenJoin(
  pool: WeightedPool,
  title: string,
  filename: string,
  tokenIndex: number,
  depositPct: number
): void {
  let data = title;

  const totalSupply = pool.getTotalSupply();
  // Assume we're depositing x% of the total supply
  const bptAmountOut = totalSupply * depositPct;

  for (let swapFee = 0.01; swapFee < 1.0; swapFee += 0.01) {
    pool.setSwapFee(swapFee);

    const result = pool.singleTokenJoin(tokenIndex, bptAmountOut);

    if (result.valid) {
      const lossPct = ((result.testValue - result.baseValue) / result.baseValue) * 100;

      data += `${swapFee.toFixed(2)},${result.amountIn.toFixed(4)},${result.baseValue.toFixed(
        2
      )},${result.testValue.toFixed(2)},${lossPct.toFixed(2)}\n`;
    } else {
      data += `${swapFee.toFixed(2)},Invalid,,,\n`;
    }
  }

  fs.writeFileSync(filename, data);
}
