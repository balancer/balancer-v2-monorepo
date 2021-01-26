import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

import { bn, decimal } from '../../../lib/helpers/numbers';

const ONE = decimal(1e18);

export function calcOutGivenIn(
  tokenBalanceIn: string | number,
  tokenWeightIn: string | number,
  tokenBalanceOut: string | number,
  tokenWeightOut: string | number,
  tokenAmountIn: string | number
): Decimal {
  const weightRatio = decimal(tokenWeightIn).div(tokenWeightOut);
  const y = decimal(tokenBalanceIn).div(decimal(tokenBalanceIn).add(tokenAmountIn));
  const foo = y.pow(weightRatio);
  const bar = decimal(1).sub(foo);
  const tokenAmountOut = decimal(tokenBalanceOut).mul(bar);
  return tokenAmountOut;
}

export function calcInGivenOut(
  tokenBalanceIn: string | number,
  tokenWeightIn: string | number,
  tokenBalanceOut: string | number,
  tokenWeightOut: string | number,
  tokenAmountOut: string | number
): Decimal {
  const weightRatio = decimal(tokenWeightOut).div(tokenWeightIn);
  const diff = decimal(tokenBalanceOut).sub(tokenAmountOut);
  const y = decimal(tokenBalanceOut).div(diff);
  const foo = y.pow(weightRatio).sub(1);
  const tokenAmountIn = decimal(tokenBalanceIn).mul(foo);
  return tokenAmountIn;
}

export function calculateInvariant(balances: string[], weights: string[]): Decimal {
  const sumWeights = weights.reduce((acc: Decimal, b: string) => {
    return acc.add(b);
  }, decimal(0));
  let invariant = decimal(1);
  for (let index = 0; index < balances.length; index++) {
    invariant = invariant.mul(decimal(balances[index]).pow(decimal(weights[index]).div(sumWeights)));
  }
  return invariant;
}

export function calcBptOutGivenExactTokensIn(
  rawBalances: BigNumber[],
  rawWeights: BigNumber[],
  rawAmountsIn: BigNumber[],
  rawBptTotalSupply: BigNumber,
  rawSwapFee: BigNumber
): BigNumber {
  const swapFee = decimal(rawSwapFee.toString()).div(ONE);
  const weights = toNormalizedWeights(rawWeights).map((w) => decimal(w).div(ONE));
  const balances = rawBalances.map((b) => decimal(b).div(ONE));
  const amountsIn = rawAmountsIn.map((a) => decimal(a).div(ONE));

  const balanceRatiosWithoutFee = [];
  let weightedBalanceRatio = decimal(0);
  for (let i = 0; i < balances.length; i++) {
    const balanceRatioWithoutFee = balances[i].add(amountsIn[i]).div(balances[i]);
    balanceRatiosWithoutFee.push(balanceRatioWithoutFee);
    weightedBalanceRatio = weightedBalanceRatio.add(balanceRatioWithoutFee.mul(weights[i]));
  }

  let invariantRatio = decimal(1);
  for (let i = 0; i < rawBalances.length; i++) {
    const tokenBalancePercentageExcess =
      weightedBalanceRatio >= balanceRatiosWithoutFee[i]
        ? decimal(0)
        : balanceRatiosWithoutFee[i].sub(weightedBalanceRatio).div(balanceRatiosWithoutFee[i].sub(1));

    const amountInAfterFee = amountsIn[i].mul(decimal(1).sub(tokenBalancePercentageExcess.mul(swapFee)));
    const tokenBalanceRatio = amountInAfterFee.div(balances[i]).add(1);
    invariantRatio = invariantRatio.mul(tokenBalanceRatio.pow(weights[i]));
  }

  const bptOut = decimal(rawBptTotalSupply).mul(invariantRatio.sub(1));
  return bn(bptOut);
}

export function calcBptInGivenExactTokensOut(
  rawBalances: BigNumber[],
  rawWeights: BigNumber[],
  rawAmountsOut: BigNumber[],
  rawBptTotalSupply: BigNumber,
  rawSwapFee: BigNumber
): BigNumber {
  const swapFee = decimal(rawSwapFee.toString()).div(ONE);
  const weights = toNormalizedWeights(rawWeights).map((w) => decimal(w).div(ONE));
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
  return bn(parseInt(bptIn.toString()));
}

export function calcTokenInGivenExactBptOut(
  tokenIndex: number,
  rawBalances: BigNumber[],
  rawWeights: BigNumber[],
  rawBptAmountOut: BigNumber,
  rawBptTotalSupply: BigNumber,
  rawSwapFee: BigNumber
): BigNumber {
  const bptAmountOut = decimal(rawBptAmountOut);
  const bptTotalSupply = decimal(rawBptTotalSupply);
  const swapFee = decimal(rawSwapFee).div(ONE);
  const weights = toNormalizedWeights(rawWeights).map((w) => decimal(w).div(ONE));
  const balances = rawBalances.map((b) => decimal(b).div(ONE));

  const invariantRatio = bptTotalSupply.add(bptAmountOut).div(bptTotalSupply);
  const tokenBalanceRatio = invariantRatio.pow(decimal(1).div(weights[tokenIndex]));
  const tokenBalancePercentageExcess = decimal(1).sub(weights[tokenIndex]);
  const amountInAfterFee = balances[tokenIndex].mul(tokenBalanceRatio.sub(1));

  const tokenIn = amountInAfterFee.div(decimal(1).sub(tokenBalancePercentageExcess.mul(swapFee)));
  return bn(tokenIn);
}

export function calcTokenOutGivenExactBptIn(
  tokenIndex: number,
  rawBalances: BigNumber[],
  rawWeights: BigNumber[],
  rawBptAmountIn: BigNumber,
  rawBptTotalSupply: BigNumber,
  rawSwapFee: BigNumber
): BigNumber {
  const bptAmountIn = decimal(rawBptAmountIn);
  const bptTotalSupply = decimal(rawBptTotalSupply);
  const swapFee = decimal(rawSwapFee).div(ONE);
  const weights = toNormalizedWeights(rawWeights).map((w) => decimal(w).div(ONE));
  const balances = rawBalances.map((b) => decimal(b).div(ONE));

  const invariantRatio = bptTotalSupply.sub(bptAmountIn).div(bptTotalSupply);
  const tokenBalanceRatio = invariantRatio.pow(decimal(1).div(weights[tokenIndex]));
  const tokenBalancePercentageExcess = decimal(1).sub(weights[tokenIndex]);
  const amountOutBeforeFee = balances[tokenIndex].mul(decimal(1).sub(tokenBalanceRatio));

  const amountOut = amountOutBeforeFee.mul(decimal(1).sub(tokenBalancePercentageExcess.mul(swapFee)));
  return bn(parseInt(amountOut.toString()));
}

function toNormalizedWeights(weights: BigNumber[]): BigNumber[] {
  const sum = weights.reduce((total, weight) => total.add(weight), bn(0));
  return weights.map((weight) => weight.mul(bn(1e18)).div(sum));
}
