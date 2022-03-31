import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

import { BigNumberish, bn, decimal, fp, fromFp, toFp } from '../../../numbers';

export function calculateInvariant(fpRawBalances: BigNumberish[], fpRawWeights: BigNumberish[]): BigNumber {
  const normalizedWeights = fpRawWeights.map(fromFp);
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
  fpSwapFeePercentage: BigNumberish
): BigNumberish {
  const weights = fpWeights.map(fromFp);
  const balances = fpBalances.map(fromFp);
  const amountsIn = fpAmountsIn.map(fromFp);
  const bptTotalSupply = fromFp(fpBptTotalSupply);

  const balanceRatiosWithFee = [];
  let invariantRatioWithFees = decimal(0);
  for (let i = 0; i < balances.length; i++) {
    balanceRatiosWithFee[i] = balances[i].add(amountsIn[i]).div(balances[i]);
    invariantRatioWithFees = invariantRatioWithFees.add(balanceRatiosWithFee[i].mul(weights[i]));
  }

  let invariantRatio = decimal(1);
  for (let i = 0; i < balances.length; i++) {
    let amountInWithoutFee;

    if (balanceRatiosWithFee[i].gt(invariantRatioWithFees)) {
      const nonTaxableAmount = balances[i].mul(invariantRatioWithFees.sub(1));
      const taxableAmount = amountsIn[i].sub(nonTaxableAmount);
      amountInWithoutFee = nonTaxableAmount.add(taxableAmount.mul(decimal(1).sub(fromFp(fpSwapFeePercentage))));
    } else {
      amountInWithoutFee = amountsIn[i];
    }

    const tokenBalanceRatio = balances[i].add(amountInWithoutFee).div(balances[i]);

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
  fpSwapFeePercentage: BigNumberish
): BigNumberish {
  const bptAmountOut = fromFp(fpBptAmountOut);
  const bptTotalSupply = fromFp(fpBptTotalSupply);
  const weight = fromFp(fpWeights[tokenIndex]);
  const balance = fpBalances.map(fromFp)[tokenIndex];
  const swapFeePercentage = fromFp(fpSwapFeePercentage);

  const invariantRatio = bptTotalSupply.add(bptAmountOut).div(bptTotalSupply);
  const tokenBalanceRatio = invariantRatio.pow(decimal(1).div(weight));
  const tokenBalancePercentageExcess = decimal(1).sub(weight);
  const amountInAfterFee = balance.mul(tokenBalanceRatio.sub(decimal(1)));

  const amountIn = amountInAfterFee.div(decimal(1).sub(tokenBalancePercentageExcess.mul(swapFeePercentage)));
  return fp(amountIn);
}

export function calcBptInGivenExactTokensOut(
  fpBalances: BigNumber[],
  fpWeights: BigNumber[],
  fpAmountsOut: BigNumber[],
  fpBptTotalSupply: BigNumber,
  fpSwapFeePercentage: BigNumber
): BigNumber {
  const swapFeePercentage = fromFp(fpSwapFeePercentage);
  const weights = fpWeights.map(fromFp);
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
    const tokenBalancePercentageExcess = weightedBalanceRatio.lte(balanceRatiosWithoutFee[i])
      ? 0
      : weightedBalanceRatio.sub(balanceRatiosWithoutFee[i]).div(decimal(1).sub(balanceRatiosWithoutFee[i]));

    const amountOutBeforeFee = amountsOut[i].div(decimal(1).sub(swapFeePercentage.mul(tokenBalancePercentageExcess)));
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
  fpSwapFeePercentage: BigNumberish
): BigNumberish {
  const bptAmountIn = fromFp(fpBptAmountIn);
  const bptTotalSupply = fromFp(fpBptTotalSupply);
  const swapFeePercentage = fromFp(fpSwapFeePercentage);
  const weight = fromFp(fpWeights[tokenIndex]);
  const balance = fpBalances.map(fromFp)[tokenIndex];

  const invariantRatio = bptTotalSupply.sub(bptAmountIn).div(bptTotalSupply);
  const tokenBalanceRatio = invariantRatio.pow(decimal(1).div(weight));
  const tokenBalancePercentageExcess = decimal(1).sub(weight);
  const amountOutBeforeFee = balance.mul(decimal(1).sub(tokenBalanceRatio));

  const amountOut = amountOutBeforeFee.mul(decimal(1).sub(tokenBalancePercentageExcess.mul(swapFeePercentage)));
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

export function calculateOneTokenSwapFeeAmount(
  fpBalances: BigNumberish[],
  fpWeights: BigNumberish[],
  lastInvariant: BigNumberish,
  tokenIndex: number
): Decimal {
  const balance = fpBalances.map(fromFp)[tokenIndex];
  const weight = fromFp(fpWeights[tokenIndex]);
  const exponent = decimal(1).div(weight);
  const currentInvariant = calculateInvariant(fpBalances, fpWeights);
  const invariantRatio = decimal(lastInvariant).div(decimal(currentInvariant));
  const accruedFees = balance.mul(decimal(1).sub(invariantRatio.pow(exponent)));

  return toFp(accruedFees);
}

export function calculateBPTSwapFeeFeeAmount(
  fpBptTotalSupply: BigNumberish,
  lastInvariant: BigNumberish,
  currentInvariant: BigNumberish,
  fpProtocolSwapFeePercentage: BigNumberish
): Decimal {
  if (bn(currentInvariant).lte(lastInvariant)) {
    return decimal(1);
  }

  const growth = decimal(currentInvariant).div(decimal(lastInvariant));

  const k = fromFp(fpProtocolSwapFeePercentage)
    .mul(growth.sub(decimal(1)))
    .div(growth);

  const numerator = fromFp(fpBptTotalSupply).mul(k);
  const denominator = decimal(1).sub(k);

  return numerator.div(denominator);
}

export function calculateMaxOneTokenSwapFeeAmount(
  fpBalances: BigNumberish[],
  fpWeights: BigNumberish[],
  fpMinInvariantRatio: BigNumberish,
  tokenIndex: number
): Decimal {
  const balance = fpBalances.map(fromFp)[tokenIndex];
  const weight = fromFp(fpWeights[tokenIndex]);

  const exponent = decimal(1).div(weight);
  const maxAccruedFees = balance.mul(decimal(1).sub(fromFp(fpMinInvariantRatio).pow(exponent)));

  return toFp(maxAccruedFees);
}

export function calculateSpotPrice(fpBalances: BigNumberish[], fpWeights: BigNumberish[]): BigNumber {
  const numerator = fromFp(fpBalances[0]).div(fromFp(fpWeights[0]));
  const denominator = fromFp(fpBalances[1]).div(fromFp(fpWeights[1]));
  return bn(toFp(numerator.div(denominator)).toFixed(0));
}

export function calculateBPTPrice(
  fpBalance: BigNumberish,
  fpWeight: BigNumberish,
  totalSupply: BigNumberish
): BigNumber {
  return bn(toFp(fromFp(fpBalance).div(fromFp(fpWeight)).div(fromFp(totalSupply))).toFixed(0));
}
