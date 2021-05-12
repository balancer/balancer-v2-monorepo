import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

import { BigNumberish, decimal, bn, fp, fromFp, toFp } from '@balancer-labs/v2-helpers/src/numbers';

export function calculateInvariant(fpRawBalances: BigNumberish[], amplificationParameter: BigNumberish): BigNumber {
  const totalCoins = fpRawBalances.length;
  const sum = fpRawBalances.reduce((a, b) => a.add(b.toString()), decimal(0));

  if (sum.isZero()) {
    return bn(0);
  }

  let inv = sum;
  let prevInv = decimal(0);
  const ampTimesTotal = decimal(amplificationParameter).mul(totalCoins);

  for (let i = 0; i < 255; i++) {
    let P_D = decimal(totalCoins).mul(fpRawBalances[0].toString());
    for (let j = 1; j < totalCoins; j++) {
      P_D = P_D.mul(fpRawBalances[j].toString()).mul(totalCoins).div(inv);
    }

    prevInv = inv;
    inv = decimal(totalCoins)
      .mul(inv)
      .mul(inv)
      .add(ampTimesTotal.mul(sum).mul(P_D))
      .div(decimal(totalCoins).add(1).mul(inv).add(ampTimesTotal.sub(1).mul(P_D)));
    // Equality with the precision of 1

    if (inv > prevInv) {
      if (inv.sub(prevInv).lte(1)) {
        break;
      }
    } else if (prevInv.sub(inv).lte(1)) {
      break;
    }
  }

  return bn(inv);
}

export function calculateAnalyticalInvariantForTwoTokens(
  fpRawBalances: BigNumberish[],
  amplificationParameter: BigNumberish
): BigNumber {
  if (fpRawBalances.length !== 2) {
    throw 'Analytical invariant is solved only for 2 balances';
  }

  const sum = fpRawBalances.reduce((a: Decimal, b: BigNumberish) => a.add(fromFp(b)), decimal(0));
  const prod = fpRawBalances.reduce((a: Decimal, b: BigNumberish) => a.mul(fromFp(b)), decimal(1));

  // The amplification parameter equals to: A n^(n-1), where A is the amplification coefficient
  const amplificationCoefficient = decimal(amplificationParameter).div(2);

  //Q
  const q = amplificationCoefficient.mul(-16).mul(sum).mul(prod);

  //P
  const p = amplificationCoefficient.minus(decimal(1).div(4)).mul(16).mul(prod);

  //C
  const c = q
    .pow(2)
    .div(4)
    .add(p.pow(3).div(27))
    .sqrt()
    .minus(q.div(2))
    .pow(1 / 3);

  const invariant = c.minus(p.div(c.mul(3)));
  return fp(invariant);
}

export function calcOutGivenIn(
  fpBalances: BigNumberish[],
  amplificationParameter: BigNumberish,
  tokenIndexIn: number,
  tokenIndexOut: number,
  fpTokenAmountIn: BigNumberish
): Decimal {
  const invariant = fromFp(calculateInvariant(fpBalances, amplificationParameter));

  const balances = fpBalances.map(fromFp);
  balances[tokenIndexIn] = balances[tokenIndexIn].add(fromFp(fpTokenAmountIn));

  const finalBalanceOut = _getTokenBalanceGivenInvariantAndAllOtherBalances(
    balances,
    decimal(amplificationParameter),
    invariant,
    tokenIndexOut
  );

  return toFp(balances[tokenIndexOut].sub(finalBalanceOut));
}

export function calcInGivenOut(
  fpBalances: BigNumberish[],
  amplificationParameter: BigNumberish,
  tokenIndexIn: number,
  tokenIndexOut: number,
  fpTokenAmountOut: BigNumberish
): Decimal {
  const invariant = fromFp(calculateInvariant(fpBalances, amplificationParameter));

  const balances = fpBalances.map(fromFp);
  balances[tokenIndexOut] = balances[tokenIndexOut].sub(fromFp(fpTokenAmountOut));

  const finalBalanceIn = _getTokenBalanceGivenInvariantAndAllOtherBalances(
    balances,
    decimal(amplificationParameter),
    invariant,
    tokenIndexIn
  );

  return toFp(finalBalanceIn.sub(balances[tokenIndexIn]));
}

export function calcBptOutGivenExactTokensIn(
  fpBalances: BigNumberish[],
  amplificationParameter: BigNumberish,
  fpAmountsIn: BigNumberish[],
  fpBptTotalSupply: BigNumberish,
  fpSwapFeePercentage: BigNumberish
): BigNumberish {
  // Get current invariant
  const currentInvariant = fromFp(calculateInvariant(fpBalances, amplificationParameter));

  const balances = fpBalances.map(fromFp);
  const amountsIn = fpAmountsIn.map(fromFp);

  // First calculate the sum of all token balances which will be used to calculate
  // the current weights of each token relative to the sum of all balances
  const sumBalances = balances.reduce((a: Decimal, b: Decimal) => a.add(b), new Decimal(0));

  // Calculate the weighted balance ratio without considering fees
  const tokenBalanceRatiosWithoutFee = [];
  // The weighted sum of token balance ratios without fees
  let weightedBalanceRatio = new Decimal(0);
  for (let i = 0; i < balances.length; i++) {
    const currentWeight = balances[i].div(sumBalances);
    tokenBalanceRatiosWithoutFee[i] = balances[i].add(amountsIn[i]).div(balances[i]);
    weightedBalanceRatio = weightedBalanceRatio.add(tokenBalanceRatiosWithoutFee[i].mul(currentWeight));
  }

  // Second loop to calculate new amounts in taking into account the fee on the % excess
  for (let i = 0; i < balances.length; i++) {
    // Percentage of the amount supplied that will be implicitly swapped for other tokens in the pool
    let tokenBalancePercentageExcess;
    // Some tokens might have amounts supplied in excess of a 'balanced' join: these are identified if
    // the token's balance ratio without fee is larger than the weighted balance ratio, and swap fees charged
    // on the amount to swap
    if (weightedBalanceRatio >= tokenBalanceRatiosWithoutFee[i]) {
      tokenBalancePercentageExcess = new Decimal(0);
    } else {
      tokenBalancePercentageExcess = tokenBalanceRatiosWithoutFee[i]
        .sub(weightedBalanceRatio)
        .div(tokenBalanceRatiosWithoutFee[i].sub(1));
    }

    const swapFeeExcess = fromFp(fpSwapFeePercentage).mul(tokenBalancePercentageExcess);

    const amountInAfterFee = amountsIn[i].mul(new Decimal(1).sub(swapFeeExcess));

    balances[i] = balances[i].add(amountInAfterFee);
  }

  // get new invariant taking into account swap fees
  const newInvariant = fromFp(calculateInvariant(balances.map(fp), amplificationParameter));

  // return amountBPTOut
  return fp(fromFp(fpBptTotalSupply).mul(newInvariant.div(currentInvariant).sub(1)));
}

export function calcTokenInGivenExactBptOut(
  tokenIndex: number,
  fpBalances: BigNumberish[],
  amplificationParameter: BigNumberish,
  fpBptAmountOut: BigNumberish,
  fpBptTotalSupply: BigNumberish,
  fpSwapFeePercentage: BigNumberish
): BigNumberish {
  // Get current invariant
  const currentInvariant = fromFp(calculateInvariant(fpBalances, amplificationParameter));

  const balances = fpBalances.map(fromFp);

  // Calculate new invariant
  const newInvariant = fromFp(fpBptTotalSupply)
    .add(fromFp(fpBptAmountOut))
    .div(fromFp(fpBptTotalSupply))
    .mul(currentInvariant);

  // First calculate the sum of all token balances which will be used to calculate
  // the current weight of token
  const sumBalances = balances.reduce((a: Decimal, b: Decimal) => a.add(b), new Decimal(0));

  // get amountInAfterFee
  const newBalanceTokenIndex = _getTokenBalanceGivenInvariantAndAllOtherBalances(
    balances,
    decimal(amplificationParameter),
    newInvariant,
    tokenIndex
  );
  const amountInAfterFee = newBalanceTokenIndex.sub(balances[tokenIndex]);

  // Get tokenBalancePercentageExcess
  const currentWeight = balances[tokenIndex].div(sumBalances);
  const tokenBalancePercentageExcess = new Decimal(1).sub(currentWeight);

  const swapFeeExcess = fromFp(fpSwapFeePercentage).mul(tokenBalancePercentageExcess);

  return fp(amountInAfterFee.div(new Decimal(1).sub(swapFeeExcess)));
}

export function calcBptInGivenExactTokensOut(
  fpBalances: BigNumber[],
  amplificationParameter: BigNumberish,
  fpAmountsOut: BigNumber[],
  fpBptTotalSupply: BigNumber,
  fpSwapFeePercentage: BigNumber
): BigNumber {
  // Get current invariant
  const currentInvariant = fromFp(calculateInvariant(fpBalances, amplificationParameter));

  const balances = fpBalances.map(fromFp);
  const amountsOut = fpAmountsOut.map(fromFp);

  // First calculate the sum of all token balances which will be used to calculate
  // the current weight of token
  const sumBalances = balances.reduce((a: Decimal, b: Decimal) => a.add(b), new Decimal(0));

  // Calculate the weighted balance ratio without considering fees
  const tokenBalanceRatiosWithoutFee = [];
  let weightedBalanceRatio = new Decimal(0);
  for (let i = 0; i < balances.length; i++) {
    const currentWeight = balances[i].div(sumBalances);
    tokenBalanceRatiosWithoutFee[i] = balances[i].sub(amountsOut[i]).div(balances[i]);
    weightedBalanceRatio = weightedBalanceRatio.add(tokenBalanceRatiosWithoutFee[i].mul(currentWeight));
  }

  // Second loop to calculate new amounts in taking into account the fee on the % excess
  for (let i = 0; i < balances.length; i++) {
    let tokenBalancePercentageExcess;
    // For each ratioSansFee, compare with the total weighted ratio (weightedBalanceRatio) and
    // decrease the fee from what goes above it
    if (weightedBalanceRatio <= tokenBalanceRatiosWithoutFee[i]) {
      tokenBalancePercentageExcess = new Decimal(0);
    } else {
      tokenBalancePercentageExcess = weightedBalanceRatio
        .sub(tokenBalanceRatiosWithoutFee[i])
        .div(new Decimal(1).sub(tokenBalanceRatiosWithoutFee[i]));
    }

    const swapFeeExcess = fromFp(fpSwapFeePercentage).mul(tokenBalancePercentageExcess);

    const amountOutBeforeFee = amountsOut[i].div(new Decimal(1).sub(swapFeeExcess));

    balances[i] = balances[i].sub(amountOutBeforeFee);
  }

  // get new invariant taking into account swap fees
  const newInvariant = fromFp(calculateInvariant(balances.map(fp), amplificationParameter));

  // return amountBPTIn
  return fp(fromFp(fpBptTotalSupply).mul(new Decimal(1).sub(newInvariant.div(currentInvariant))));
}

export function calcTokenOutGivenExactBptIn(
  tokenIndex: number,
  fpBalances: BigNumberish[],
  amplificationParameter: BigNumberish,
  fpBptAmountIn: BigNumberish,
  fpBptTotalSupply: BigNumberish,
  fpSwapFeePercentage: BigNumberish
): BigNumberish {
  // Get current invariant
  const currentInvariant = fromFp(calculateInvariant(fpBalances, amplificationParameter));

  const balances = fpBalances.map(fromFp);

  // Calculate new invariant
  const newInvariant = fromFp(fpBptTotalSupply)
    .sub(fromFp(fpBptAmountIn))
    .div(fromFp(fpBptTotalSupply))
    .mul(currentInvariant);

  // First calculate the sum of all token balances which will be used to calculate
  // the current weight of token
  const sumBalances = balances.reduce((a: Decimal, b: Decimal) => a.add(b), new Decimal(0));

  // get amountOutBeforeFee
  const newBalanceTokenIndex = _getTokenBalanceGivenInvariantAndAllOtherBalances(
    balances,
    decimal(amplificationParameter),
    newInvariant,
    tokenIndex
  );
  const amountOutBeforeFee = balances[tokenIndex].sub(newBalanceTokenIndex);

  // Calculate tokenBalancePercentageExcess
  const currentWeight = balances[tokenIndex].div(sumBalances);
  const tokenBalancePercentageExcess = new Decimal(1).sub(currentWeight);

  const swapFeeExcess = fromFp(fpSwapFeePercentage).mul(tokenBalancePercentageExcess);

  return fp(amountOutBeforeFee.mul(new Decimal(1).sub(swapFeeExcess)));
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
  amplificationParameter: BigNumberish,
  lastInvariant: BigNumberish,
  tokenIndex: number
): Decimal {
  const balances = fpBalances.map(fromFp);

  const finalBalanceFeeToken = _getTokenBalanceGivenInvariantAndAllOtherBalances(
    balances,
    decimal(amplificationParameter),
    fromFp(lastInvariant),
    tokenIndex
  );

  return toFp(balances[tokenIndex].sub(finalBalanceFeeToken));
}

function _getTokenBalanceGivenInvariantAndAllOtherBalances(
  balances: Decimal[],
  amplificationParameter: Decimal,
  invariant: Decimal,
  tokenIndex: number
): Decimal {
  //Rounds result up overall

  const ampTimesTotal = amplificationParameter.mul(balances.length);
  let sum = balances[0];
  let P_D = new Decimal(balances.length).mul(balances[0]);
  for (let j = 1; j < balances.length; j++) {
    P_D = P_D.mul(balances[j]).mul(balances.length).div(invariant);
    sum = sum.add(balances[j]);
  }
  sum = sum.sub(balances[tokenIndex]);

  let c = invariant.mul(invariant).div(ampTimesTotal.mul(P_D));
  //We remove the balance from c by multiplying it
  c = c.mul(balances[tokenIndex]);

  const b = sum.add(invariant.div(ampTimesTotal));

  //We iterate to find the balance
  let prevTokenBalance = new Decimal(0);
  //We apply first iteration outside the loop with the invariant as the starting approximation value.
  let tokenBalance: Decimal = invariant.mul(invariant).add(c).div(invariant.add(b));

  for (let i = 0; i < 255; i++) {
    prevTokenBalance = tokenBalance;
    tokenBalance = tokenBalance.mul(tokenBalance).add(c).div(tokenBalance.mul(2).add(b).sub(invariant));

    if (tokenBalance > prevTokenBalance) {
      if (tokenBalance.sub(prevTokenBalance).lessThanOrEqualTo(1e-18)) {
        break;
      }
    } else if (prevTokenBalance.sub(tokenBalance).lessThanOrEqualTo(1e-18)) {
      break;
    }
  }
  return tokenBalance;
}
