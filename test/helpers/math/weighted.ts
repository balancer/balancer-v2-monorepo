import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

import { bn, decimal, BigNumberish } from '../../../lib/helpers/numbers';

const ONE = decimal(1e18);

export function calcOutGivenIn(
  tokenBalanceIn: BigNumberish,
  tokenWeightIn: BigNumberish,
  tokenBalanceOut: BigNumberish,
  tokenWeightOut: BigNumberish,
  tokenAmountIn: BigNumberish
): Decimal {
  const weightRatio = decimal(tokenWeightIn).div(decimal(tokenWeightOut));
  const y = decimal(tokenBalanceIn).div(decimal(tokenBalanceIn).add(decimal(tokenAmountIn)));
  const foo = y.pow(weightRatio);
  const bar = decimal(1).sub(foo);
  const tokenAmountOut = decimal(tokenBalanceOut).mul(bar);
  return tokenAmountOut;
}

export function calcInGivenOut(
  tokenBalanceIn: BigNumberish,
  tokenWeightIn: BigNumberish,
  tokenBalanceOut: BigNumberish,
  tokenWeightOut: BigNumberish,
  tokenAmountOut: BigNumberish
): Decimal {
  const weightRatio = decimal(tokenWeightOut).div(decimal(tokenWeightIn));
  const diff = decimal(tokenBalanceOut).sub(decimal(tokenAmountOut));
  const y = decimal(tokenBalanceOut).div(diff);
  const foo = y.pow(weightRatio).sub(1);
  return decimal(tokenBalanceIn).mul(foo);
}

export function calculateInvariant(rawBalances: BigNumber[], rawWeights: BigNumber[]): BigNumber {
  const normalizedWeights = toNormalizedWeights(rawWeights);
  const balances = rawBalances.map(decimal);
  const invariant = balances.reduce((inv, balance, i) => inv.mul(balance.pow(normalizedWeights[i])), decimal(1));
  return bn(invariant);
}

export function calcBptOutGivenExactTokensIn(
  rawBalances: BigNumber[],
  rawWeights: BigNumber[],
  rawAmountsIn: BigNumber[],
  rawBptTotalSupply: BigNumber,
  rawSwapFee: BigNumber
): BigNumber {
  const swapFee = decimal(rawSwapFee.toString()).div(ONE);
  const weights = toNormalizedWeights(rawWeights);
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
  return bn(parseInt(bptIn.toString()));
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
  const weights = toNormalizedWeights(rawWeights);
  const balances = rawBalances.map((b) => decimal(b).div(ONE));

  const invariantRatio = bptTotalSupply.sub(bptAmountIn).div(bptTotalSupply);
  const tokenBalanceRatio = invariantRatio.pow(decimal(1).div(weights[tokenIndex]));
  const tokenBalancePercentageExcess = decimal(1).sub(weights[tokenIndex]);
  const amountOutBeforeFee = balances[tokenIndex].mul(decimal(1).sub(tokenBalanceRatio));

  const amountOut = amountOutBeforeFee.mul(decimal(1).sub(tokenBalancePercentageExcess.mul(swapFee)));
  return bn(amountOut);
}

function toNormalizedWeights(rawWeights: BigNumber[]): Decimal[] {
  const weights = rawWeights.map(decimal);
  const sum = weights.reduce((total, weight) => total.add(weight), decimal(0));
  return weights.map((weight) => weight.div(sum));
}
