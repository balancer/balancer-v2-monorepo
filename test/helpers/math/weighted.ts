import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

import { bn, decimal, BigNumberish, fromFp, toFp } from '../../../lib/helpers/numbers';

const ONE = decimal(1e18);

export function calculateInvariant(rawBalances: BigNumberish[], rawWeights: BigNumberish[]): BigNumber {
  const normalizedWeights = toNormalizedWeights(rawWeights);
  const balances = rawBalances.map(decimal);
  const invariant = balances.reduce((inv, balance, i) => inv.mul(balance.pow(normalizedWeights[i])), decimal(1));
  return bn(invariant);
}

export function calcOutGivenIn(
  tokenBalanceIn: BigNumberish,
  tokenWeightIn: BigNumberish,
  tokenBalanceOut: BigNumberish,
  tokenWeightOut: BigNumberish,
  tokenAmountIn: BigNumberish
): Decimal {
  const newBalance = fromFp(tokenBalanceIn).add(fromFp(tokenAmountIn));
  const base = fromFp(tokenBalanceIn).div(newBalance);
  const exponent = fromFp(tokenWeightIn).div(fromFp(tokenWeightOut));
  const ratio = decimal(1).sub(base.pow(exponent));
  return toFp(fromFp(tokenBalanceOut).mul(ratio));
}

export function calcInGivenOut(
  tokenBalanceIn: BigNumberish,
  tokenWeightIn: BigNumberish,
  tokenBalanceOut: BigNumberish,
  tokenWeightOut: BigNumberish,
  tokenAmountOut: BigNumberish
): Decimal {
  const newBalance = fromFp(tokenBalanceOut).sub(fromFp(tokenAmountOut));
  const base = fromFp(tokenBalanceOut).div(newBalance);
  const exponent = fromFp(tokenWeightOut).div(fromFp(tokenWeightIn));
  const ratio = base.pow(exponent).sub(1);
  return toFp(fromFp(tokenBalanceIn).mul(ratio));
}

export function calcBptOutGivenExactTokensIn(
  fpBalances: BigNumberish[],
  fpWeights: BigNumberish[],
  fpAmountsIn: BigNumberish[],
  fpBptTotalSupply: BigNumberish,
  fpSwapFee: BigNumberish
): BigNumberish {
  const swapFee = fromFp(fpSwapFee);
  const weights = toNormalizedWeights(fpWeights);
  const balances = fpBalances.map(fromFp);
  const amountsIn = fpAmountsIn.map(fromFp);

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

    const amountInAfterFee = amountsIn[i].mul(decimal(1).sub(tokenBalancePercentageExcess.mul(swapFee)));
    const tokenBalanceRatio = amountInAfterFee.div(balances[i]).add(1);
    invariantRatio = invariantRatio.mul(tokenBalanceRatio.pow(weights[i]));
  }

  const bptOut = decimal(fpBptTotalSupply).mul(invariantRatio.sub(1));
  return bn(bptOut);
}

export function calcTokenInGivenExactBptOut(
  tokenIndex: number,
  fpBalances: BigNumberish[],
  fpWeights: BigNumberish[],
  fpBptAmountOut: BigNumberish,
  fpBptTotalSupply: BigNumberish,
  fpSwapFee: BigNumberish
): BigNumberish {
  const bptAmountOut = decimal(fpBptAmountOut);
  const bptTotalSupply = decimal(fpBptTotalSupply);
  const swapFee = fromFp(fpSwapFee);
  const weights = toNormalizedWeights(fpWeights);
  const balances = fpBalances.map(fromFp);

  const invariantRatio = bptTotalSupply.add(bptAmountOut).div(bptTotalSupply);
  const tokenBalanceRatio = invariantRatio.pow(decimal(1).div(weights[tokenIndex]));
  const tokenBalancePercentageExcess = decimal(1).sub(weights[tokenIndex]);
  const amountInAfterFee = balances[tokenIndex].mul(tokenBalanceRatio.sub(decimal(1)));

  const amountIn = amountInAfterFee.mul(ONE).div(decimal(1).sub(tokenBalancePercentageExcess.mul(swapFee)));
  return bn(amountIn);
}

export function calcBptInGivenExactTokensOut(
  rawBalances: BigNumber[],
  rawWeights: BigNumber[],
  rawAmountsOut: BigNumber[],
  rawBptTotalSupply: BigNumber,
  rawSwapFee: BigNumber
): BigNumber {
  const swapFee = decimal(rawSwapFee).div(ONE);
  const weights = toNormalizedWeights(rawWeights);
  const balances = rawBalances.map((b) => decimal(b).div(ONE));
  const amountsOut = rawAmountsOut.map((a) => decimal(a).div(ONE));

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

  const bptIn = decimal(rawBptTotalSupply).mul(decimal(1).sub(invariantRatio));
  return bn(bptIn);
}

export function calcTokenOutGivenExactBptIn(
  tokenIndex: number,
  rawBalances: BigNumberish[],
  rawWeights: BigNumberish[],
  rawBptAmountIn: BigNumberish,
  rawBptTotalSupply: BigNumberish,
  rawSwapFee: BigNumberish
): BigNumberish {
  const bptAmountIn = decimal(rawBptAmountIn);
  const bptTotalSupply = decimal(rawBptTotalSupply);
  const swapFee = decimal(rawSwapFee).div(ONE);
  const weights = toNormalizedWeights(rawWeights);
  const balances = rawBalances.map((b) => decimal(b).div(ONE));

  const invariantRatio = bptTotalSupply.sub(bptAmountIn).div(bptTotalSupply);
  const tokenBalanceRatio = invariantRatio.pow(decimal(1).div(weights[tokenIndex]));
  const tokenBalancePercentageExcess = decimal(1).sub(weights[tokenIndex]);
  const amountOutBeforeFee = balances[tokenIndex].mul(decimal(1).sub(tokenBalanceRatio));

  const amountOut = amountOutBeforeFee.mul(ONE).mul(decimal(1).sub(tokenBalancePercentageExcess.mul(swapFee)));
  return bn(amountOut);
}

export function toNormalizedWeights(rawWeights: BigNumberish[]): Decimal[] {
  const weights = rawWeights.map(decimal);
  const sum = weights.reduce((total, weight) => total.add(weight), decimal(0));
  return weights.map((weight) => weight.div(sum));
}

export function calculateOneTokenSwapFee(
  rawBalances: BigNumberish[],
  rawWeights: BigNumberish[],
  lastInvariant: BigNumberish,
  tokenIndex: number
): Decimal {
  const normalizedWeights = toNormalizedWeights(rawWeights);
  const exponent = decimal(1).div(normalizedWeights[tokenIndex]);
  const currentInvariant = calculateInvariant(rawBalances, rawWeights);
  const invariantRatio = decimal(lastInvariant).div(decimal(currentInvariant));

  return decimal(rawBalances[tokenIndex])
    .div(ONE)
    .mul(ONE.sub(invariantRatio.pow(exponent).mul(ONE)));
}

export function calculateMaxOneTokenSwapFee(
  rawBalances: BigNumberish[],
  rawWeights: BigNumberish[],
  minInvariantRatio: Decimal,
  tokenIndex: number
): Decimal {
  const normalizedWeights = toNormalizedWeights(rawWeights);
  const exponent = decimal(1).div(normalizedWeights[tokenIndex]);

  return decimal(rawBalances[tokenIndex])
    .div(ONE)
    .mul(ONE.sub(minInvariantRatio.pow(exponent).mul(ONE)));
}
