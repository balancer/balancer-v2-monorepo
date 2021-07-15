import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

import { BigNumberish, decimal, bn, fp, fromFp, toFp } from '../../../numbers';

export function calculateInvariant(fpRawBalances: BigNumberish[], amplificationParameter: BigNumberish): BigNumber {
  return calculateApproxInvariant(fpRawBalances, amplificationParameter);
}

export function calculateApproxInvariant(
  fpRawBalances: BigNumberish[],
  amplificationParameter: BigNumberish
): BigNumber {
  const totalCoins = fpRawBalances.length;
  const balances = fpRawBalances.map(fromFp);

  const sum = balances.reduce((a, b) => a.add(b), decimal(0));

  if (sum.isZero()) {
    return bn(0);
  }

  let inv = sum;
  let prevInv = decimal(0);
  const ampTimesTotal = decimal(amplificationParameter).mul(totalCoins);

  for (let i = 0; i < 255; i++) {
    let P_D = balances[0].mul(totalCoins);
    for (let j = 1; j < totalCoins; j++) {
      P_D = P_D.mul(balances[j]).mul(totalCoins).div(inv);
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

  return fp(inv);
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
    .pow(1 / 2)
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
  const sumBalances = balances.reduce((a: Decimal, b: Decimal) => a.add(b), decimal(0));

  // Calculate the weighted balance ratio without considering fees
  const balanceRatiosWithFee = [];
  // The weighted sum of token balance rations sans fee
  let invariantRatioWithFees = decimal(0);
  for (let i = 0; i < balances.length; i++) {
    const currentWeight = balances[i].div(sumBalances);
    balanceRatiosWithFee[i] = balances[i].add(amountsIn[i]).div(balances[i]);
    invariantRatioWithFees = invariantRatioWithFees.add(balanceRatiosWithFee[i].mul(currentWeight));
  }

  // Second loop to calculate new amounts in taking into account the fee on the % excess
  for (let i = 0; i < balances.length; i++) {
    let amountInWithoutFee;

    // Check if the balance ratio is greater than the ideal ratio to charge fees or not
    if (balanceRatiosWithFee[i].gt(invariantRatioWithFees)) {
      const nonTaxableAmount = balances[i].mul(invariantRatioWithFees.sub(1));
      const taxableAmount = amountsIn[i].sub(nonTaxableAmount);
      amountInWithoutFee = nonTaxableAmount.add(taxableAmount.mul(decimal(1).sub(fromFp(fpSwapFeePercentage))));
    } else {
      amountInWithoutFee = amountsIn[i];
    }

    balances[i] = balances[i].add(amountInWithoutFee);
  }

  // Calculate the new invariant, taking swap fees into account
  const newInvariant = fromFp(calculateInvariant(balances.map(fp), amplificationParameter));
  const invariantRatio = newInvariant.div(currentInvariant);

  if (invariantRatio.gt(1)) {
    return fp(fromFp(fpBptTotalSupply).mul(invariantRatio.sub(1)));
  } else {
    return bn(0);
  }
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
  const fpCurrentInvariant = bn(calculateInvariant(fpBalances, amplificationParameter));

  // Calculate new invariant
  const newInvariant = fromFp(bn(fpBptTotalSupply).add(fpBptAmountOut))
    .div(fromFp(fpBptTotalSupply))
    .mul(fromFp(fpCurrentInvariant));

  // First calculate the sum of all token balances which will be used to calculate
  // the current weight of token
  const balances = fpBalances.map(fromFp);
  const sumBalances = balances.reduce((a: Decimal, b: Decimal) => a.add(b), decimal(0));

  // Calculate amount in without fee.
  const newBalanceTokenIndex = _getTokenBalanceGivenInvariantAndAllOtherBalances(
    balances,
    amplificationParameter,
    newInvariant,
    tokenIndex
  );
  const amountInWithoutFee = newBalanceTokenIndex.sub(balances[tokenIndex]);

  // We can now compute how much extra balance is being deposited and used in virtual swaps, and charge swap fees
  // accordingly.
  const currentWeight = balances[tokenIndex].div(sumBalances);
  const taxablePercentage = currentWeight.gt(1) ? 0 : decimal(1).sub(currentWeight);
  const taxableAmount = amountInWithoutFee.mul(taxablePercentage);
  const nonTaxableAmount = amountInWithoutFee.sub(taxableAmount);

  const bptOut = nonTaxableAmount.add(taxableAmount.div(decimal(1).sub(fromFp(fpSwapFeePercentage))));

  return fp(bptOut);
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
  const sumBalances = balances.reduce((a: Decimal, b: Decimal) => a.add(b), decimal(0));

  // Calculate the weighted balance ratio without considering fees
  const balanceRatiosWithoutFee = [];
  let invariantRatioWithoutFees = decimal(0);
  for (let i = 0; i < balances.length; i++) {
    const currentWeight = balances[i].div(sumBalances);
    balanceRatiosWithoutFee[i] = balances[i].sub(amountsOut[i]).div(balances[i]);
    invariantRatioWithoutFees = invariantRatioWithoutFees.add(balanceRatiosWithoutFee[i].mul(currentWeight));
  }

  // Second loop to calculate new amounts in taking into account the fee on the % excess
  for (let i = 0; i < balances.length; i++) {
    // Swap fees are typically charged on 'token in', but there is no 'token in' here, so we apply it to
    // 'token out'. This results in slightly larger price impact.

    let amountOutWithFee;
    if (invariantRatioWithoutFees > balanceRatiosWithoutFee[i]) {
      const invariantRatioComplement = invariantRatioWithoutFees.gt(1)
        ? decimal(0)
        : decimal(1).sub(invariantRatioWithoutFees);
      const nonTaxableAmount = balances[i].mul(invariantRatioComplement);
      const taxableAmount = amountsOut[i].sub(nonTaxableAmount);
      amountOutWithFee = nonTaxableAmount.add(taxableAmount.div(decimal(1).sub(fromFp(fpSwapFeePercentage))));
    } else {
      amountOutWithFee = amountsOut[i];
    }

    balances[i] = balances[i].sub(amountOutWithFee);
  }

  // get new invariant taking into account swap fees
  const newInvariant = fromFp(calculateInvariant(balances.map(fp), amplificationParameter));

  // return amountBPTIn
  const invariantRatio = newInvariant.div(currentInvariant);
  const invariantRatioComplement = invariantRatio.lt(1) ? decimal(1).sub(invariantRatio) : decimal(0);
  return fp(fromFp(fpBptTotalSupply).mul(invariantRatioComplement));
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
  const fpCurrentInvariant = bn(calculateInvariant(fpBalances, amplificationParameter));

  // Calculate new invariant
  const newInvariant = fromFp(bn(fpBptTotalSupply).sub(fpBptAmountIn))
    .div(fromFp(fpBptTotalSupply))
    .mul(fromFp(fpCurrentInvariant));

  // First calculate the sum of all token balances which will be used to calculate
  // the current weight of token
  const balances = fpBalances.map(fromFp);
  const sumBalances = balances.reduce((a: Decimal, b: Decimal) => a.add(b), decimal(0));

  // get amountOutBeforeFee
  const newBalanceTokenIndex = _getTokenBalanceGivenInvariantAndAllOtherBalances(
    balances,
    amplificationParameter,
    newInvariant,
    tokenIndex
  );
  const amountOutWithoutFee = balances[tokenIndex].sub(newBalanceTokenIndex);

  // We can now compute how much excess balance is being withdrawn as a result of the virtual swaps, which result
  // in swap fees.
  const currentWeight = balances[tokenIndex].div(sumBalances);
  const taxablePercentage = currentWeight.gt(1) ? decimal(0) : decimal(1).sub(currentWeight);

  // Swap fees are typically charged on 'token in', but there is no 'token in' here, so we apply it
  // to 'token out'. This results in slightly larger price impact. Fees are rounded up.
  const taxableAmount = amountOutWithoutFee.mul(taxablePercentage);
  const nonTaxableAmount = amountOutWithoutFee.sub(taxableAmount);
  const tokenOut = nonTaxableAmount.add(taxableAmount.mul(decimal(1).sub(fromFp(fpSwapFeePercentage))));
  return fp(tokenOut);
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

  if (finalBalanceFeeToken.gt(balances[tokenIndex])) {
    return decimal(0);
  }

  return toFp(balances[tokenIndex].sub(finalBalanceFeeToken));
}

export function getTokenBalanceGivenInvariantAndAllOtherBalances(
  amp: BigNumber,
  fpBalances: BigNumber[],
  fpInvariant: BigNumber,
  tokenIndex: number
): BigNumber {
  const invariant = fromFp(fpInvariant);
  const balances = fpBalances.map(fromFp);
  return fp(_getTokenBalanceGivenInvariantAndAllOtherBalances(balances, decimal(amp), invariant, tokenIndex));
}

function _getTokenBalanceGivenInvariantAndAllOtherBalances(
  balances: Decimal[],
  amplificationParameter: Decimal | BigNumberish,
  invariant: Decimal,
  tokenIndex: number
): Decimal {
  let sum = decimal(0);
  let mul = decimal(1);
  const numTokens = balances.length;

  for (let i = 0; i < numTokens; i++) {
    if (i != tokenIndex) {
      sum = sum.add(balances[i]);
      mul = mul.mul(balances[i]);
    }
  }

  // const a = 1;
  amplificationParameter = decimal(amplificationParameter);
  const b = invariant.div(amplificationParameter.mul(numTokens)).add(sum).sub(invariant);
  const c = invariant
    .pow(numTokens + 1)
    .mul(-1)
    .div(
      amplificationParameter.mul(
        decimal(numTokens)
          .pow(numTokens + 1)
          .mul(mul)
      )
    );

  return b
    .mul(-1)
    .add(b.pow(2).sub(c.mul(4)).squareRoot())
    .div(2);
}

export function calculateSpotPrice(amplificationParameter: BigNumberish, fpBalances: BigNumberish[]): BigNumber {
  const invariant = fromFp(calculateInvariant(fpBalances, amplificationParameter));
  const [balanceX, balanceY] = fpBalances.map(fromFp);

  const a = decimal(amplificationParameter).mul(2);
  const b = invariant.sub(invariant.mul(a));
  const axy2 = a.mul(2).mul(balanceX).mul(balanceY);

  const derivativeX = axy2.add(a.mul(balanceY).mul(balanceY)).add(b.mul(balanceY));
  const derivativeY = axy2.add(a.mul(balanceX).mul(balanceX)).add(b.mul(balanceX));

  return fp(derivativeX.div(derivativeY));
}

export function calculateBptPrice(
  amplificationParameter: BigNumberish,
  fpBalances: BigNumberish[],
  fpTotalSupply: BigNumberish
): BigNumber {
  const [balanceX, balanceY] = fpBalances.map(fromFp);
  const spotPrice = fromFp(calculateSpotPrice(amplificationParameter, fpBalances));
  const totalBalanceX = balanceX.add(spotPrice.mul(balanceY));

  const bptPrice = totalBalanceX.div(fromFp(fpTotalSupply));
  return fp(bptPrice);
}
