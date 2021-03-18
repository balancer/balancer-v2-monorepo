import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

import { BigNumberish, decimal, bn, fp, fromFp, toFp } from '../../../lib/helpers/numbers';

export function calculateInvariant(fpRawBalances: BigNumberish[], fpAmplificationParameter: BigNumberish): BigNumber {
  const totalCoins = fpRawBalances.length;
  const sum = fpRawBalances.reduce((a, b) => a.add(b.toString()), decimal(0));

  if (sum.isZero()) {
    return bn(0);
  }

  let inv = sum;
  let prevInv = decimal(0);
  const ampTimesTotal = decimal(fpAmplificationParameter).mul(totalCoins);

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
  fpAmplificationParameter: BigNumberish
): BigNumber {
  if (fpRawBalances.length !== 2) {
    throw 'Analytical invariant is solved only for 2 balances';
  }

  const n = decimal(fpRawBalances.length);

  //Sum
  const sum = fpRawBalances.reduce((a: Decimal, b: BigNumberish) => a.add(b.toString()), decimal(0));

  //Mul
  const prod = fpRawBalances.reduce((a: Decimal, b: BigNumberish) => a.mul(b.toString()), decimal(1));

  //Q
  const q = decimal(fpAmplificationParameter)
    .mul(-1)
    .mul(n.pow(n.mul(2)))
    .mul(sum)
    .mul(prod);

  //P
  const p = decimal(fpAmplificationParameter)
    .minus(decimal(1).div(n.pow(n)))
    .mul(n.pow(n.mul(2)))
    .mul(prod);

  //C
  const c = q
    .pow(2)
    .div(4)
    .add(p.pow(3).div(27))
    .sqrt()
    .minus(q.div(2))
    .pow(1 / 3);

  //Invariant
  const invariant = c.minus(p.div(c.mul(3)));
  return bn(invariant);
}

export function calcOutGivenIn(
  fpBalances: BigNumberish[],
  fpAmplificationParameter: BigNumberish,
  tokenIndexIn: number,
  tokenIndexOut: number,
  fpTokenAmountIn: BigNumberish
): Decimal {
  const invariant = fromFp(calculateInvariant(fpBalances, fpAmplificationParameter));

  const balances = fpBalances.map(fromFp);
  balances[tokenIndexIn] = balances[tokenIndexIn].add(fromFp(fpTokenAmountIn));

  const finalBalanceOut = _getTokenBalanceGivenInvariantAndAllOtherBalances(
    balances,
    fromFp(fpAmplificationParameter),
    invariant,
    tokenIndexOut
  );

  return toFp(balances[tokenIndexOut].sub(finalBalanceOut));
}

export function calcInGivenOut(
  fpBalances: BigNumberish[],
  fpAmplificationParameter: BigNumberish,
  tokenIndexIn: number,
  tokenIndexOut: number,
  fpTokenAmountOut: BigNumberish
): Decimal {
  const invariant = fromFp(calculateInvariant(fpBalances, fpAmplificationParameter));

  const balances = fpBalances.map(fromFp);
  balances[tokenIndexOut] = balances[tokenIndexOut].sub(fromFp(fpTokenAmountOut));

  const finalBalanceIn = _getTokenBalanceGivenInvariantAndAllOtherBalances(
    balances,
    fromFp(fpAmplificationParameter),
    invariant,
    tokenIndexIn
  );

  return toFp(finalBalanceIn.sub(balances[tokenIndexIn]));
}

export function calcBptOutGivenExactTokensIn(
  fpBalances: BigNumberish[],
  fpAmplificationParameter: BigNumberish,
  fpAmountsIn: BigNumberish[],
  fpBptTotalSupply: BigNumberish,
  fpSwapFee: BigNumberish
): BigNumberish {
  // Get current invariant
  const currentInvariant = fromFp(calculateInvariant(fpBalances, fpAmplificationParameter));

  const balances = fpBalances.map(fromFp);
  const amountsIn = fpAmountsIn.map(fromFp);

  // First calculate the sum of all token balances which will be used to calculate
  // the current weights of each token relative to the sum of all balances
  const sumBalances = balances.reduce((a: Decimal, b: Decimal) => a.add(b), new Decimal(0));

  // Calculate the weighted balance ratio without considering fees
  const tokenBalanceRatiosWithoutFee = [];
  // The weighted sum of token balance rations sans fee
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
    // the token's balance ratio sans fee is larger than the weighted balance ratio, and swap fees charged
    // on the amount to swap
    if (weightedBalanceRatio >= tokenBalanceRatiosWithoutFee[i]) {
      tokenBalancePercentageExcess = new Decimal(0);
    } else {
      tokenBalancePercentageExcess = tokenBalanceRatiosWithoutFee[i]
        .sub(weightedBalanceRatio)
        .div(tokenBalanceRatiosWithoutFee[i].sub(1));
    }

    const swapFeeExcess = fromFp(fpSwapFee).mul(tokenBalancePercentageExcess);

    const amountInAfterFee = amountsIn[i].mul(new Decimal(1).sub(swapFeeExcess));

    balances[i] = balances[i].add(amountInAfterFee);
  }

  // get new invariant taking into account swap fees
  const newInvariant = fromFp(calculateInvariant(balances.map(fp), fpAmplificationParameter));

  // return amountBPTOut
  return fp(fromFp(fpBptTotalSupply).mul(newInvariant.div(currentInvariant).sub(1)));
}

export function calcTokenInGivenExactBptOut(
  tokenIndex: number,
  fpBalances: BigNumberish[],
  fpAmplificationParameter: BigNumberish,
  fpBptAmountOut: BigNumberish,
  fpBptTotalSupply: BigNumberish,
  fpSwapFee: BigNumberish
): BigNumberish {
  // Get current invariant
  const currentInvariant = fromFp(calculateInvariant(fpBalances, fpAmplificationParameter));

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
    fromFp(fpAmplificationParameter),
    newInvariant,
    tokenIndex
  );
  const amountInAfterFee = newBalanceTokenIndex.sub(balances[tokenIndex]);

  // Get tokenBalancePercentageExcess
  const currentWeight = balances[tokenIndex].div(sumBalances);
  const tokenBalancePercentageExcess = new Decimal(1).sub(currentWeight);

  const swapFeeExcess = fromFp(fpSwapFee).mul(tokenBalancePercentageExcess);

  return fp(amountInAfterFee.div(new Decimal(1).sub(swapFeeExcess)));
}

export function calcBptInGivenExactTokensOut(
  fpBalances: BigNumber[],
  fpAmplificationParameter: BigNumberish,
  fpAmountsOut: BigNumber[],
  fpBptTotalSupply: BigNumber,
  fpSwapFee: BigNumber
): BigNumber {
  // Get current invariant
  const currentInvariant = fromFp(calculateInvariant(fpBalances, fpAmplificationParameter));

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

    const swapFeeExcess = fromFp(fpSwapFee).mul(tokenBalancePercentageExcess);

    const amountOutBeforeFee = amountsOut[i].div(new Decimal(1).sub(swapFeeExcess));

    balances[i] = balances[i].sub(amountOutBeforeFee);
  }

  // get new invariant taking into account swap fees
  const newInvariant = fromFp(calculateInvariant(balances.map(fp), fpAmplificationParameter));

  // return amountBPTIn
  return fp(fromFp(fpBptTotalSupply).mul(new Decimal(1).sub(newInvariant.div(currentInvariant))));
}

export function calcTokenOutGivenExactBptIn(
  tokenIndex: number,
  fpBalances: BigNumberish[],
  fpAmplificationParameter: BigNumberish,
  fpBptAmountIn: BigNumberish,
  fpBptTotalSupply: BigNumberish,
  fpSwapFee: BigNumberish
): BigNumberish {
  // Get current invariant
  const currentInvariant = fromFp(calculateInvariant(fpBalances, fpAmplificationParameter));

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
    fromFp(fpAmplificationParameter),
    newInvariant,
    tokenIndex
  );
  const amountOutBeforeFee = balances[tokenIndex].sub(newBalanceTokenIndex);

  // Calculate tokenBalancePercentageExcess
  const currentWeight = balances[tokenIndex].div(sumBalances);
  const tokenBalancePercentageExcess = new Decimal(1).sub(currentWeight);

  const swapFeeExcess = fromFp(fpSwapFee).mul(tokenBalancePercentageExcess);

  return fp(amountOutBeforeFee.mul(new Decimal(1).sub(swapFeeExcess)));
}

//TODO: _calcTokensOutGivenExactBptIn

export function calculateOneTokenSwapFee(
  fpBalances: BigNumberish[],
  fpAmplificationParameter: BigNumberish,
  lastInvariant: BigNumberish,
  tokenIndex: number
): Decimal {
  const balances = fpBalances.map(fromFp);

  const finalBalanceFeeToken = _getTokenBalanceGivenInvariantAndAllOtherBalances(
    balances,
    fromFp(fpAmplificationParameter),
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
  //We apply first iteration outside the loop with the invariant as the starting aproximation value.
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
