import { Decimal } from 'decimal.js'
import { BigNumber } from 'ethers'

import { decimal, fromFp, toFp } from '@balancer-labs/v2-helpers/src/numbers'

type Params = {
  fee: BigNumber
  rate: BigNumber
  target1: BigNumber
  target2: BigNumber
}

export function calcBptOutPerMainIn(fpMainIn: BigNumber, fpMainBalance: BigNumber, fpWrappedBalance: BigNumber, fpBptSupply: BigNumber, params: Params): Decimal {
  const mainIn = fromFp(fpMainIn)
  const mainBalance = fromFp(fpMainBalance)
  const wrappedBalance = fromFp(fpWrappedBalance)
  const bptSupply = fromFp(fpBptSupply)

  if (bptSupply.eq(0)) {
    return toFp(toNominal(mainIn, params))
  }

  const previousNominalMain = toNominal(mainBalance, params)
  const afterNominalMain = toNominal(mainBalance.add(mainIn), params)
  const deltaNominalMain = afterNominalMain.sub(previousNominalMain)
  const invariant = calcInvariant(previousNominalMain, wrappedBalance, params)
  const newBptSupply = bptSupply.mul(decimal(1).add(deltaNominalMain.div(invariant)))
  const bptOut = newBptSupply.sub(bptSupply)
  return toFp(bptOut)
}

export function calcBptInPerMainOut(fpMainOut: BigNumber, fpMainBalance: BigNumber, fpWrappedBalance: BigNumber, fpBptSupply: BigNumber, params: Params): Decimal {
  const mainOut = fromFp(fpMainOut)
  const mainBalance = fromFp(fpMainBalance)
  const wrappedBalance = fromFp(fpWrappedBalance)
  const bptSupply = fromFp(fpBptSupply)

  const previousNominalMain = toNominal(mainBalance, params)
  const afterNominalMain = toNominal(mainBalance.sub(mainOut), params)
  const deltaNominalMain = previousNominalMain.sub(afterNominalMain)
  const invariant = calcInvariant(previousNominalMain, wrappedBalance, params)
  const newBptSupply = bptSupply.mul(decimal(1).sub(deltaNominalMain.div(invariant)))
  const bptIn = bptSupply.sub(newBptSupply)
  return toFp(bptIn)
}

export function calcWrappedOutPerMainIn(fpMainIn: BigNumber, fpMainBalance: BigNumber, fpWrappedBalance: BigNumber, params: Params): Decimal {
  const mainIn = fromFp(fpMainIn)
  const mainBalance = fromFp(fpMainBalance)
  const wrappedBalance = fromFp(fpWrappedBalance)
  const rate = fromFp(params.rate)

  const previousNominalMain = toNominal(mainBalance, params)
  const afterNominalMain = toNominal(mainBalance.add(mainIn), params)
  const deltaNominalMain = afterNominalMain.sub(previousNominalMain)
  const newWrappedBalance = wrappedBalance.sub(deltaNominalMain.mul(rate))
  const wrappedOut = wrappedBalance.sub(newWrappedBalance)
  return toFp(wrappedOut)
}

export function calcWrappedInPerMainOut(fpMainOut: BigNumber, fpMainBalance: BigNumber, fpWrappedBalance: BigNumber, params: Params): Decimal {
  const mainOut = fromFp(fpMainOut)
  const mainBalance = fromFp(fpMainBalance)
  const wrappedBalance = fromFp(fpWrappedBalance)
  const rate = fromFp(params.rate)

  const previousNominalMain = toNominal(mainBalance, params)
  const afterNominalMain = toNominal(mainBalance.sub(mainOut), params)
  const deltaNominalMain = previousNominalMain.sub(afterNominalMain)
  const newWrappedBalance = wrappedBalance.add(deltaNominalMain.mul(rate))
  const wrappedIn = newWrappedBalance.sub(wrappedBalance)
  return toFp(wrappedIn)
}

export function calcMainInPerBptOut(fpBptOut: BigNumber, fpMainBalance: BigNumber, fpWrappedBalance: BigNumber, fpBptSupply: BigNumber, params: Params): Decimal {
  const bptOut = fromFp(fpBptOut)
  const bptSupply = fromFp(fpBptSupply)
  const mainBalance = fromFp(fpMainBalance)
  const wrappedBalance = fromFp(fpWrappedBalance)

  if (bptSupply.eq(0)) {
    return toFp(fromNominal(bptOut, params))
  }

  const previousNominalMain = toNominal(mainBalance, params)
  const invariant = calcInvariant(previousNominalMain, wrappedBalance, params)
  const deltaNominalMain = invariant.mul(bptOut).div(bptSupply)
  const afterNominalMain = previousNominalMain.add(deltaNominalMain)
  const newMainBalance = fromNominal(afterNominalMain, params)
  const mainIn = newMainBalance.sub(mainBalance)
  return toFp(mainIn)
}

export function calcMainOutPerBptIn(fpBptIn: BigNumber, fpMainBalance: BigNumber, fpWrappedBalance: BigNumber, fpBptSupply: BigNumber, params: Params): Decimal {
  const bptIn = fromFp(fpBptIn)
  const mainBalance = fromFp(fpMainBalance)
  const wrappedBalance = fromFp(fpWrappedBalance)
  const bptSupply = fromFp(fpBptSupply)

  const previousNominalMain = toNominal(mainBalance, params)
  const invariant = calcInvariant(previousNominalMain, wrappedBalance, params)
  const deltaNominalMain = invariant.mul(bptIn).div(bptSupply)
  const afterNominalMain = previousNominalMain.sub(deltaNominalMain)
  const newMainBalance = fromNominal(afterNominalMain, params)
  const mainOut = mainBalance.sub(newMainBalance)
  return toFp(mainOut)
}

export function calcMainOutPerWrappedIn(fpWrappedIn: BigNumber, fpMainBalance: BigNumber, params: Params): Decimal {
  const rate = fromFp(params.rate)
  const wrappedIn = fromFp(fpWrappedIn)
  const mainBalance = fromFp(fpMainBalance)

  const previousNominalMain = toNominal(mainBalance, params)
  const deltaNominalMain = wrappedIn.mul(rate)
  const afterNominalMain = previousNominalMain.sub(deltaNominalMain)
  const newMainBalance = fromNominal(afterNominalMain, params)
  const minOut = mainBalance.sub(newMainBalance)
  return toFp(minOut)
}

export function calcMainInPerWrappedOut(fpWrappedOut: BigNumber, fpMainBalance: BigNumber, params: Params): Decimal {
  const rate = fromFp(params.rate)
  const wrappedOut = fromFp(fpWrappedOut)
  const mainBalance = fromFp(fpMainBalance)

  const previousNominalMain = toNominal(mainBalance, params)
  const deltaNominalMain = wrappedOut.mul(rate)
  const afterNominalMain = previousNominalMain.add(deltaNominalMain)
  const newMainBalance = fromNominal(afterNominalMain, params)
  const mainIn = newMainBalance.sub(mainBalance)
  return toFp(mainIn)
}

function calcInvariant(mainBalance: Decimal, wrappedBalance: Decimal, params: Params): Decimal {
  const rate = fromFp(params.rate)
  return mainBalance.add(wrappedBalance.mul(rate))
}

function toNominal(amount: Decimal, params: Params): Decimal {
  const fee = fromFp(params.fee)
  const target1 = fromFp(params.target1)
  const target2 = fromFp(params.target2)

  if (amount.lt((decimal(1).sub(fee)).mul(target1))) {
    return amount.div(decimal(1).sub(fee))
  } else if (amount.lt((target2.sub(fee)).mul(target1))) {
    return amount.add(fee.mul(target1))
  } else {
    return amount.add((target1.add(target2)).mul(fee)).div(decimal(1).add(fee))
  }
}

function fromNominal(nominal: Decimal, params: Params): Decimal {
  const fee = fromFp(params.fee)
  const target1 = fromFp(params.target1)
  const target2 = fromFp(params.target2)

  if (nominal.lt(target1)) {
    return nominal.mul(decimal(1).sub(fee))
  } else if (nominal.lt(target2)) {
    return nominal.sub(fee.mul(target1))
  } else {
    return nominal.mul(decimal(1).add(fee)).sub(fee.mul(target1.add(target2)))
  }
}