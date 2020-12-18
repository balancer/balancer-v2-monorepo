import { Decimal } from 'decimal.js';

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
