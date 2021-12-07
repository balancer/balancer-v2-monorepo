import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

import { decimal, fromFp, toFp } from '@balancer-labs/v2-helpers/src/numbers';

export type Params = {
  fee: BigNumber;
  lowerTarget: BigNumber;
  upperTarget: BigNumber;
};

export function calcBptOutPerMainIn(
  fpMainIn: BigNumber,
  fpMainBalance: BigNumber,
  fpWrappedBalance: BigNumber,
  fpBptSupply: BigNumber,
  params: Params
): Decimal {
  const mainIn = fromFp(fpMainIn);
  const mainBalance = fromFp(fpMainBalance);
  const wrappedBalance = fromFp(fpWrappedBalance);
  const bptSupply = fromFp(fpBptSupply);

  if (bptSupply.eq(0)) {
    return toFp(toNominal(mainIn, params));
  }

  const previousNominalMain = toNominal(mainBalance, params);
  const afterNominalMain = toNominal(mainBalance.add(mainIn), params);
  const deltaNominalMain = afterNominalMain.sub(previousNominalMain);
  const invariant = calcInvariant(previousNominalMain, wrappedBalance);
  const bptOut = bptSupply.mul(deltaNominalMain).div(invariant);
  return toFp(bptOut);
}

export function calcBptInPerMainOut(
  fpMainOut: BigNumber,
  fpMainBalance: BigNumber,
  fpWrappedBalance: BigNumber,
  fpBptSupply: BigNumber,
  params: Params
): Decimal {
  const mainOut = fromFp(fpMainOut);
  const mainBalance = fromFp(fpMainBalance);
  const wrappedBalance = fromFp(fpWrappedBalance);
  const bptSupply = fromFp(fpBptSupply);

  const previousNominalMain = toNominal(mainBalance, params);
  const afterNominalMain = toNominal(mainBalance.sub(mainOut), params);
  const deltaNominalMain = previousNominalMain.sub(afterNominalMain);
  const invariant = calcInvariant(previousNominalMain, wrappedBalance);
  const bptIn = bptSupply.mul(deltaNominalMain).div(invariant);
  return toFp(bptIn);
}

export function calcWrappedOutPerMainIn(fpMainIn: BigNumber, fpMainBalance: BigNumber, params: Params): Decimal {
  const mainIn = fromFp(fpMainIn);
  const mainBalance = fromFp(fpMainBalance);

  const previousNominalMain = toNominal(mainBalance, params);
  const afterNominalMain = toNominal(mainBalance.add(mainIn), params);
  const deltaNominalMain = afterNominalMain.sub(previousNominalMain);
  const wrappedOut = deltaNominalMain;
  return toFp(wrappedOut);
}

export function calcWrappedInPerMainOut(fpMainOut: BigNumber, fpMainBalance: BigNumber, params: Params): Decimal {
  const mainOut = fromFp(fpMainOut);
  const mainBalance = fromFp(fpMainBalance);

  const previousNominalMain = toNominal(mainBalance, params);
  const afterNominalMain = toNominal(mainBalance.sub(mainOut), params);
  const deltaNominalMain = previousNominalMain.sub(afterNominalMain);
  const wrappedIn = deltaNominalMain;
  return toFp(wrappedIn);
}

export function calcMainInPerBptOut(
  fpBptOut: BigNumber,
  fpMainBalance: BigNumber,
  fpWrappedBalance: BigNumber,
  fpBptSupply: BigNumber,
  params: Params
): Decimal {
  const bptOut = fromFp(fpBptOut);
  const bptSupply = fromFp(fpBptSupply);
  const mainBalance = fromFp(fpMainBalance);
  const wrappedBalance = fromFp(fpWrappedBalance);

  if (bptSupply.eq(0)) {
    return toFp(fromNominal(bptOut, params));
  }

  const previousNominalMain = toNominal(mainBalance, params);
  const invariant = calcInvariant(previousNominalMain, wrappedBalance);
  const deltaNominalMain = invariant.mul(bptOut).div(bptSupply);
  const afterNominalMain = previousNominalMain.add(deltaNominalMain);
  const newMainBalance = fromNominal(afterNominalMain, params);
  const mainIn = newMainBalance.sub(mainBalance);
  return toFp(mainIn);
}

export function calcMainOutPerBptIn(
  fpBptIn: BigNumber,
  fpMainBalance: BigNumber,
  fpWrappedBalance: BigNumber,
  fpBptSupply: BigNumber,
  params: Params
): Decimal {
  const bptIn = fromFp(fpBptIn);
  const mainBalance = fromFp(fpMainBalance);
  const wrappedBalance = fromFp(fpWrappedBalance);
  const bptSupply = fromFp(fpBptSupply);

  const previousNominalMain = toNominal(mainBalance, params);
  const invariant = calcInvariant(previousNominalMain, wrappedBalance);
  const deltaNominalMain = invariant.mul(bptIn).div(bptSupply);
  const afterNominalMain = previousNominalMain.sub(deltaNominalMain);
  const newMainBalance = fromNominal(afterNominalMain, params);
  const mainOut = mainBalance.sub(newMainBalance);
  return toFp(mainOut);
}

export function calcMainOutPerWrappedIn(fpWrappedIn: BigNumber, fpMainBalance: BigNumber, params: Params): Decimal {
  const wrappedIn = fromFp(fpWrappedIn);
  const mainBalance = fromFp(fpMainBalance);

  const previousNominalMain = toNominal(mainBalance, params);
  const deltaNominalMain = wrappedIn;
  const afterNominalMain = previousNominalMain.sub(deltaNominalMain);
  const newMainBalance = fromNominal(afterNominalMain, params);
  const minOut = mainBalance.sub(newMainBalance);
  return toFp(minOut);
}

export function calcMainInPerWrappedOut(fpWrappedOut: BigNumber, fpMainBalance: BigNumber, params: Params): Decimal {
  const wrappedOut = fromFp(fpWrappedOut);
  const mainBalance = fromFp(fpMainBalance);

  const previousNominalMain = toNominal(mainBalance, params);
  const deltaNominalMain = wrappedOut;
  const afterNominalMain = previousNominalMain.add(deltaNominalMain);
  const newMainBalance = fromNominal(afterNominalMain, params);
  const mainIn = newMainBalance.sub(mainBalance);
  return toFp(mainIn);
}

export function calcBptOutPerWrappedIn(
  fpWrappedIn: BigNumber,
  fpMainBalance: BigNumber,
  fpWrappedBalance: BigNumber,
  fpBptSupply: BigNumber,
  params: Params
): Decimal {
  const wrappedIn = fromFp(fpWrappedIn);
  const mainBalance = fromFp(fpMainBalance);
  const wrappedBalance = fromFp(fpWrappedBalance);
  const bptSupply = fromFp(fpBptSupply);

  if (bptSupply.eq(0)) {
    return toFp(wrappedIn);
  }

  const nominalMain = toNominal(mainBalance, params);
  const previousInvariant = calcInvariant(nominalMain, wrappedBalance);

  const newWrappedBalance = wrappedBalance.add(wrappedIn);
  const newInvariant = calcInvariant(nominalMain, newWrappedBalance);

  const newBptBalance = bptSupply.mul(newInvariant).div(previousInvariant);
  const bptOut = newBptBalance.sub(bptSupply);
  return toFp(bptOut);
}

export function calcBptInPerWrappedOut(
  fpWrappedOut: BigNumber,
  fpMainBalance: BigNumber,
  fpWrappedBalance: BigNumber,
  fpBptSupply: BigNumber,
  params: Params
): Decimal {
  const wrappedOut = fromFp(fpWrappedOut);
  const mainBalance = fromFp(fpMainBalance);
  const wrappedBalance = fromFp(fpWrappedBalance);
  const bptSupply = fromFp(fpBptSupply);

  const nominalMain = toNominal(mainBalance, params);
  const previousInvariant = calcInvariant(nominalMain, wrappedBalance);

  const newWrappedBalance = wrappedBalance.sub(wrappedOut);
  const newInvariant = calcInvariant(nominalMain, newWrappedBalance);

  const newBptBalance = bptSupply.mul(newInvariant).div(previousInvariant);
  const bptIn = bptSupply.sub(newBptBalance);
  return toFp(bptIn);
}

export function calcWrappedInPerBptOut(
  fpBptOut: BigNumber,
  fpMainBalance: BigNumber,
  fpWrappedBalance: BigNumber,
  fpBptSupply: BigNumber,
  params: Params
): Decimal {
  const bptOut = fromFp(fpBptOut);
  const bptSupply = fromFp(fpBptSupply);
  const mainBalance = fromFp(fpMainBalance);
  const wrappedBalance = fromFp(fpWrappedBalance);

  if (bptSupply.eq(0)) {
    return toFp(bptOut);
  }

  const nominalMain = toNominal(mainBalance, params);
  const previousInvariant = calcInvariant(nominalMain, wrappedBalance);

  const newBptBalance = bptSupply.add(bptOut);
  const newWrappedBalance = newBptBalance.mul(previousInvariant).div(bptSupply).sub(nominalMain);
  const wrappedIn = newWrappedBalance.sub(wrappedBalance);
  return toFp(wrappedIn);
}

export function calcWrappedOutPerBptIn(
  fpBptIn: BigNumber,
  fpMainBalance: BigNumber,
  fpWrappedBalance: BigNumber,
  fpBptSupply: BigNumber,
  params: Params
): Decimal {
  const bptIn = fromFp(fpBptIn);
  const mainBalance = fromFp(fpMainBalance);
  const wrappedBalance = fromFp(fpWrappedBalance);
  const bptSupply = fromFp(fpBptSupply);

  const nominalMain = toNominal(mainBalance, params);
  const previousInvariant = calcInvariant(nominalMain, wrappedBalance);

  const newBptBalance = bptSupply.sub(bptIn);
  const newWrappedBalance = newBptBalance.mul(previousInvariant).div(bptSupply).sub(nominalMain);
  const wrappedOut = wrappedBalance.sub(newWrappedBalance);
  return toFp(wrappedOut);
}

export function calcInvariant(mainNomimalBalance: Decimal, wrappedBalance: Decimal): Decimal {
  return mainNomimalBalance.add(wrappedBalance);
}

export function toNominal(real: Decimal, params: Params): Decimal {
  const fee = fromFp(params.fee);
  const lowerTarget = fromFp(params.lowerTarget);
  const upperTarget = fromFp(params.upperTarget);

  if (real.lt(lowerTarget)) {
    const fees = lowerTarget.sub(real).mul(fee);
    return real.sub(fees);
  } else if (real.lte(upperTarget)) {
    return real;
  } else {
    const fees = real.sub(upperTarget).mul(fee);
    return real.sub(fees);
  }
}

export function fromNominal(nominal: Decimal, params: Params): Decimal {
  const fee = fromFp(params.fee);
  const lowerTarget = fromFp(params.lowerTarget);
  const upperTarget = fromFp(params.upperTarget);

  if (nominal.lt(lowerTarget)) {
    return nominal.add(fee.mul(lowerTarget)).div(decimal(1).add(fee));
  } else if (nominal.lte(upperTarget)) {
    return nominal;
  } else {
    return nominal.sub(fee.mul(upperTarget)).div(decimal(1).sub(fee));
  }
}
