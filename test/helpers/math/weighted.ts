import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

import { BigNumberish, bn, decimal, fp, fromFp, toFp } from '../../../lib/helpers/numbers';

export function calculateInvariant(fpRawBalances: BigNumberish[], fpRawWeights: BigNumberish[]): BigNumber {
  const normalizedWeights = toNormalizedWeights(fpRawWeights);
  const balances = fpRawBalances.map(decimal);
  const invariant = balances.reduce((inv, balance, i) => inv.mul(balance.pow(normalizedWeights[i])), decimal(1));
  return bn(invariant);
}

export function calcOutGivenIn(
  fpBalanceIn: BigNumberish,
  fpWeightIn: BigNumberish,
  fpBalanceOut: BigNumberish,
  fpWeightOut: BigNumberish,
  fpAmountIn: BigNumberish
): Decimal {
  const newBalance = fromFp(fpBalanceIn).add(fromFp(fpAmountIn));
  const base = fromFp(fpBalanceIn).div(newBalance);
  const exponent = fromFp(fpWeightIn).div(fromFp(fpWeightOut));
  const ratio = decimal(1).sub(base.pow(exponent));
  return toFp(fromFp(fpBalanceOut).mul(ratio));
}

export function calcInGivenOut(
  fpBalanceIn: BigNumberish,
  fpWeightIn: BigNumberish,
  fpBalanceOut: BigNumberish,
  fpWeightOut: BigNumberish,
  fpAmountOut: BigNumberish
): Decimal {
  const newBalance = fromFp(fpBalanceOut).sub(fromFp(fpAmountOut));
  const base = fromFp(fpBalanceOut).div(newBalance);
  const exponent = fromFp(fpWeightOut).div(fromFp(fpWeightIn));
  const ratio = base.pow(exponent).sub(1);
  return toFp(fromFp(fpBalanceIn).mul(ratio));
}

export function calcBptOutGivenExactTokensIn(
  fpBalances: BigNumberish[],
  fpWeights: BigNumberish[],
  fpAmountsIn: BigNumberish[],
  fpBptTotalSupply: BigNumberish,
  fpSwapFee: BigNumberish
): BigNumberish {
  const weights = toNormalizedWeights(fpWeights);
  const balances = fpBalances.map(fromFp);
  const amountsIn = fpAmountsIn.map(fromFp);
  const bptTotalSupply = fromFp(fpBptTotalSupply);

  const balanceRatiosWithoutFee = [];
  let weightedBalanceRatio = decimal(0);
  for (let i = 0; i < balances.length; i++) {
    const balanceRatioWithoutFee = balances[i].add(amountsIn[i]).div(balances[i]);
    balanceRatiosWithoutFee.push(balanceRatioWithoutFee);
    weightedBalanceRatio = weightedBalanceRatio.add(balanceRatioWithoutFee.mul(weights[i]));
  }

  let invariantRatio = decimal(1);
  for (let i = 0; i < fpBalances.length; i++) {
    const tokenBalancePercentageExcess =
      weightedBalanceRatio >= balanceRatiosWithoutFee[i]
        ? decimal(0)
        : balanceRatiosWithoutFee[i].sub(weightedBalanceRatio).div(balanceRatiosWithoutFee[i].sub(1));

    const amountInAfterFee = amountsIn[i].mul(decimal(1).sub(tokenBalancePercentageExcess.mul(fromFp(fpSwapFee))));
    const tokenBalanceRatio = amountInAfterFee.div(balances[i]).add(1);
    invariantRatio = invariantRatio.mul(tokenBalanceRatio.pow(weights[i]));
  }

  const bptOut = bptTotalSupply.mul(invariantRatio.sub(1));
  return fp(bptOut);
}

export function calcTokenInGivenExactBptOut(
  tokenIndex: number,
  fpBalances: BigNumberish[],
  fpWeights: BigNumberish[],
  fpBptAmountOut: BigNumberish,
  fpBptTotalSupply: BigNumberish,
  fpSwapFee: BigNumberish
): BigNumberish {
  const bptAmountOut = fromFp(fpBptAmountOut);
  const bptTotalSupply = fromFp(fpBptTotalSupply);
  const weight = toNormalizedWeights(fpWeights)[tokenIndex];
  const balance = fpBalances.map(fromFp)[tokenIndex];
  const swapFee = fromFp(fpSwapFee);

  const invariantRatio = bptTotalSupply.add(bptAmountOut).div(bptTotalSupply);
  const tokenBalanceRatio = invariantRatio.pow(decimal(1).div(weight));
  const tokenBalancePercentageExcess = decimal(1).sub(weight);
  const amountInAfterFee = balance.mul(tokenBalanceRatio.sub(decimal(1)));

  const amountIn = amountInAfterFee.div(decimal(1).sub(tokenBalancePercentageExcess.mul(swapFee)));
  return fp(amountIn);
}

export function calcBptInGivenExactTokensOut(
  fpBalances: BigNumber[],
  fpWeights: BigNumber[],
  fpAmountsOut: BigNumber[],
  fpBptTotalSupply: BigNumber,
  fpSwapFee: BigNumber
): BigNumber {
  const swapFee = fromFp(fpSwapFee);
  const weights = toNormalizedWeights(fpWeights);
  const balances = fpBalances.map(fromFp);
  const amountsOut = fpAmountsOut.map(fromFp);
  const bptTotalSupply = fromFp(fpBptTotalSupply);

  const balanceRatiosWithoutFee = [];
  let weightedBalanceRatio = decimal(0);
  for (let i = 0; i < balances.length; i++) {
    const balanceRatioWithoutFee = balances[i].sub(amountsOut[i]).div(balances[i]);
    balanceRatiosWithoutFee.push(balanceRatioWithoutFee);
    weightedBalanceRatio = weightedBalanceRatio.add(balanceRatioWithoutFee.mul(weights[i]));
  }

  let invariantRatio = decimal(1);
  for (let i = 0; i < balances.length; i++) {
    const tokenBalancePercentageExcess =
      weightedBalanceRatio <= balanceRatiosWithoutFee[i]
        ? 0
        : weightedBalanceRatio.sub(balanceRatiosWithoutFee[i]).div(decimal(1).sub(balanceRatiosWithoutFee[i]));

    const amountOutBeforeFee = amountsOut[i].div(decimal(1).sub(swapFee.mul(tokenBalancePercentageExcess)));
    const tokenBalanceRatio = decimal(1).sub(amountOutBeforeFee.div(balances[i]));
    invariantRatio = invariantRatio.mul(tokenBalanceRatio.pow(weights[i]));
  }

  const bptIn = bptTotalSupply.mul(decimal(1).sub(invariantRatio));
  return fp(bptIn);
}

export function calcTokenOutGivenExactBptIn(
  tokenIndex: number,
  fpBalances: BigNumberish[],
  fpWeights: BigNumberish[],
  fpBptAmountIn: BigNumberish,
  fpBptTotalSupply: BigNumberish,
  fpSwapFee: BigNumberish
): BigNumberish {
  const bptAmountIn = fromFp(fpBptAmountIn);
  const bptTotalSupply = fromFp(fpBptTotalSupply);
  const swapFee = fromFp(fpSwapFee);
  const weight = toNormalizedWeights(fpWeights)[tokenIndex];
  const balance = fpBalances.map(fromFp)[tokenIndex];

  const invariantRatio = bptTotalSupply.sub(bptAmountIn).div(bptTotalSupply);
  const tokenBalanceRatio = invariantRatio.pow(decimal(1).div(weight));
  const tokenBalancePercentageExcess = decimal(1).sub(weight);
  const amountOutBeforeFee = balance.mul(decimal(1).sub(tokenBalanceRatio));

  const amountOut = amountOutBeforeFee.mul(decimal(1).sub(tokenBalancePercentageExcess.mul(swapFee)));
  return fp(amountOut);
}

export function calcTokensOutGivenExactBptIn(
  fpBalances: BigNumberish[],
  fpBptAmountIn: BigNumberish,
  fpBptTotalSupply: BigNumberish
): BigNumber[] {
  const balances = fpBalances.map(fromFp);
  const bptRatio = fromFp(fpBptAmountIn).div(fromFp(fpBptTotalSupply));
  const amountsOut = balances.map((balance) => balance.mul(bptRatio));
  return amountsOut.map(fp);
}
export function calculateOneTokenSwapFee(
  fpBalances: BigNumberish[],
  fpWeights: BigNumberish[],
  lastInvariant: BigNumberish,
  tokenIndex: number
): Decimal {
  const balance = fpBalances.map(fromFp)[tokenIndex];
  const weight = toNormalizedWeights(fpWeights)[tokenIndex];

  const exponent = decimal(1).div(weight);
  const currentInvariant = calculateInvariant(fpBalances, fpWeights);
  const invariantRatio = decimal(lastInvariant).div(decimal(currentInvariant));
  const accruedFees = balance.mul(decimal(1).sub(invariantRatio.pow(exponent)));

  return toFp(accruedFees);
}

export function calculateMaxOneTokenSwapFee(
  fpBalances: BigNumberish[],
  fpWeights: BigNumberish[],
  fpMinInvariantRatio: BigNumberish,
  tokenIndex: number
): Decimal {
  const balance = fpBalances.map(fromFp)[tokenIndex];
  const weight = toNormalizedWeights(fpWeights)[tokenIndex];

  const exponent = decimal(1).div(weight);
  const maxAccruedFees = balance.mul(decimal(1).sub(fromFp(fpMinInvariantRatio).pow(exponent)));

  return toFp(maxAccruedFees);
}

export function toNormalizedWeights(rawWeights: BigNumberish[]): Decimal[] {
  const weights = rawWeights.map(decimal);
  const sum = weights.reduce((total, weight) => total.add(weight), decimal(0));
  return weights.map((weight) => weight.div(sum));
}
