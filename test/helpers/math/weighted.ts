import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';
import { bn } from '../numbers';

const ONE = new Decimal(1e18);

export function calcOutGivenIn(
  tokenBalanceIn: string | number,
  tokenWeightIn: string | number,
  tokenBalanceOut: string | number,
  tokenWeightOut: string | number,
  tokenAmountIn: string | number
): Decimal {
  const weightRatio = new Decimal(tokenWeightIn).div(tokenWeightOut);
  const y = new Decimal(tokenBalanceIn).div(new Decimal(tokenBalanceIn).plus(tokenAmountIn));
  const foo = y.pow(weightRatio);
  const bar = new Decimal(1).minus(foo);
  const tokenAmountOut = new Decimal(tokenBalanceOut).times(bar);
  return tokenAmountOut;
}

export function calcInGivenOut(
  tokenBalanceIn: string | number,
  tokenWeightIn: string | number,
  tokenBalanceOut: string | number,
  tokenWeightOut: string | number,
  tokenAmountOut: string | number
): Decimal {
  const weightRatio = new Decimal(tokenWeightOut).div(tokenWeightIn);
  const diff = new Decimal(tokenBalanceOut).minus(tokenAmountOut);
  const y = new Decimal(tokenBalanceOut).div(diff);
  const foo = y.pow(weightRatio).minus(1);
  const tokenAmountIn = new Decimal(tokenBalanceIn).times(foo);
  return tokenAmountIn;
}

export function calculateInvariant(balances: string[], weights: string[]): Decimal {
  const sumWeights = weights.reduce((acc: Decimal, b: string) => {
    return acc.add(b);
  }, new Decimal(0));
  let invariant = new Decimal(1);
  for (let index = 0; index < balances.length; index++) {
    invariant = invariant.mul(new Decimal(balances[index]).pow(new Decimal(weights[index]).div(sumWeights)));
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
  const swapFee = new Decimal(rawSwapFee.toString()).div(ONE);
  const weights = toNormalizedWeights(rawWeights).map((w) => new Decimal(w.toString()).div(ONE));
  const balances = rawBalances.map((b) => new Decimal(b.toString()).div(ONE));
  const amountsIn = rawAmountsIn.map((a) => new Decimal(a.toString()).div(ONE));

  const balanceRatiosWithoutFee = [];
  let weightedBalanceRatio = new Decimal(0);
  for (let i = 0; i < balances.length; i++) {
    const balanceRatioWithoutFee = balances[i].add(amountsIn[i]).div(balances[i]);
    balanceRatiosWithoutFee.push(balanceRatioWithoutFee);
    weightedBalanceRatio = weightedBalanceRatio.add(balanceRatioWithoutFee.mul(weights[i]));
  }

  let invariantRatio = new Decimal(1);
  for (let i = 0; i < rawBalances.length; i++) {
    const tokenBalancePercentageExcess =
      weightedBalanceRatio >= balanceRatiosWithoutFee[i]
        ? new Decimal(0)
        : balanceRatiosWithoutFee[i].sub(weightedBalanceRatio).div(balanceRatiosWithoutFee[i].sub(1));

    const amountInAfterFee = amountsIn[i].mul(new Decimal(1).sub(tokenBalancePercentageExcess.mul(swapFee)));
    const tokenBalanceRatio = amountInAfterFee.div(balances[i]).add(1);
    invariantRatio = invariantRatio.mul(tokenBalanceRatio.pow(weights[i]));
  }

  const bptOut = new Decimal(rawBptTotalSupply.toString()).mul(invariantRatio.sub(1));
  return bn(parseInt(bptOut.toString()));
}

export function calcBptInGivenExactTokensOut(
  rawBalances: BigNumber[],
  rawWeights: BigNumber[],
  rawAmountsOut: BigNumber[],
  rawBptTotalSupply: BigNumber,
  rawSwapFee: BigNumber
): BigNumber {
  const swapFee = new Decimal(rawSwapFee.toString()).div(ONE);
  const weights = toNormalizedWeights(rawWeights).map((w) => new Decimal(w.toString()).div(ONE));
  const balances = rawBalances.map((b) => new Decimal(b.toString()).div(ONE));
  const amountsOut = rawAmountsOut.map((a) => new Decimal(a.toString()).div(ONE));

  const balanceRatiosWithoutFee = [];
  let weightedBalanceRatio = new Decimal(0);
  for (let i = 0; i < balances.length; i++) {
    const balanceRatioWithoutFee = balances[i].sub(amountsOut[i]).div(balances[i]);
    balanceRatiosWithoutFee.push(balanceRatioWithoutFee);
    weightedBalanceRatio = weightedBalanceRatio.add(balanceRatioWithoutFee.mul(weights[i]));
  }

  let invariantRatio = new Decimal(1);
  for (let i = 0; i < balances.length; i++) {
    const tokenBalancePercentageExcess =
      weightedBalanceRatio <= balanceRatiosWithoutFee[i]
        ? 0
        : weightedBalanceRatio.sub(balanceRatiosWithoutFee[i]).div(new Decimal(1).sub(balanceRatiosWithoutFee[i]));

    const amountOutBeforeFee = amountsOut[i].div(new Decimal(1).sub(swapFee.mul(tokenBalancePercentageExcess)));
    const tokenBalanceRatio = new Decimal(1).sub(amountOutBeforeFee.div(balances[i]));
    invariantRatio = invariantRatio.mul(tokenBalanceRatio.pow(weights[i]));
  }

  const bptIn = new Decimal(rawBptTotalSupply.toString()).mul(new Decimal(1).sub(invariantRatio));
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
  const bptAmountOut = new Decimal(rawBptAmountOut.toString());
  const bptTotalSupply = new Decimal(rawBptTotalSupply.toString());
  const swapFee = new Decimal(rawSwapFee.toString()).div(ONE);
  const weights = toNormalizedWeights(rawWeights).map((w) => new Decimal(w.toString()).div(ONE));
  const balances = rawBalances.map((b) => new Decimal(b.toString()).div(ONE));

  const invariantRatio = bptTotalSupply.add(bptAmountOut).div(bptTotalSupply);
  const tokenBalanceRatio = invariantRatio.pow(new Decimal(1).div(weights[tokenIndex]));
  const tokenBalancePercentageExcess = new Decimal(1).sub(weights[tokenIndex]);
  const amountInAfterFee = balances[tokenIndex].mul(tokenBalanceRatio.sub(1));

  const tokenIn = amountInAfterFee.div(new Decimal(1).sub(tokenBalancePercentageExcess.mul(swapFee)));
  return bn(parseInt(tokenIn.toString()));
}

export function calcTokenOutGivenExactBptIn(
  tokenIndex: number,
  rawBalances: BigNumber[],
  rawWeights: BigNumber[],
  rawBptAmountIn: BigNumber,
  rawBptTotalSupply: BigNumber,
  rawSwapFee: BigNumber
): BigNumber {
  const bptAmountIn = new Decimal(rawBptAmountIn.toString());
  const bptTotalSupply = new Decimal(rawBptTotalSupply.toString());
  const swapFee = new Decimal(rawSwapFee.toString()).div(ONE);
  const weights = toNormalizedWeights(rawWeights).map((w) => new Decimal(w.toString()).div(ONE));
  const balances = rawBalances.map((b) => new Decimal(b.toString()).div(ONE));

  const invariantRatio = bptTotalSupply.sub(bptAmountIn).div(bptTotalSupply);
  const tokenBalanceRatio = invariantRatio.pow(new Decimal(1).div(weights[tokenIndex]));
  const tokenBalancePercentageExcess = new Decimal(1).sub(weights[tokenIndex]);
  const amountOutBeforeFee = balances[tokenIndex].mul(new Decimal(1).sub(tokenBalanceRatio));

  const amountOut = amountOutBeforeFee.mul(new Decimal(1).sub(tokenBalancePercentageExcess.mul(swapFee)));
  return bn(parseInt(amountOut.toString()));
}

function toNormalizedWeights(weights: BigNumber[]): BigNumber[] {
  const sum = weights.reduce((total, weight) => total.add(weight), bn(0));
  return weights.map((weight) => weight.mul(bn(1e18)).div(sum));
}
