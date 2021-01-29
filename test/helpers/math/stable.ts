import { Decimal } from 'decimal.js';
import { BigNumberish } from '../numbers';

export function calculateInvariant(amp: BigNumberish, balances: BigNumberish[]): Decimal {
  let sum = new Decimal(0);
  const totalCoins = balances.length;
  for (let i = 0; i < totalCoins; i++) {
    sum = sum.add(balances[i].toString());
  }
  if (sum.isZero()) {
    return new Decimal(0);
  }
  let prevInv = new Decimal(0);
  let inv = sum;
  const ampTimesTotal = new Decimal(amp.toString()).times(totalCoins);
  for (let i = 0; i < 255; i++) {
    let P_D = new Decimal(totalCoins).times(balances[0].toString());
    for (let j = 1; j < totalCoins; j++) {
      P_D = P_D.times(balances[j].toString()).times(totalCoins).div(inv);
    }
    prevInv = inv;
    inv = new Decimal(totalCoins)
      .times(inv)
      .times(inv)
      .add(ampTimesTotal.times(sum).times(P_D))
      .div(new Decimal(totalCoins).add(1).times(inv).add(ampTimesTotal.sub(1).times(P_D)));
    // Equality with the precision of 1

    if (inv > prevInv) {
      if (inv.sub(prevInv).lte(1)) {
        break;
      }
    } else if (prevInv.sub(inv).lte(1)) {
      break;
    }
  }
  return inv;
}

export function calculateAnalyticalInvariantForTwoTokens(amp: BigNumberish, balances: BigNumberish[]): Decimal {
  if (balances.length !== 2) {
    throw 'Analytical invariant is solved only for 2 balances';
  }
  const n = new Decimal(balances.length);
  //Sum
  const sum = balances.reduce((a: Decimal, b: BigNumberish) => a.add(b.toString()), new Decimal(0));
  //Mul
  const prod = balances.reduce((a: Decimal, b: BigNumberish) => a.times(b.toString()), new Decimal(1));
  //Q
  const q = new Decimal(amp.toString())
    .mul(-1)
    .mul(n.pow(n.times(2)))
    .mul(sum)
    .mul(prod);
  //P
  const p = new Decimal(amp.toString())
    .minus(new Decimal(1).div(n.pow(n)))
    .mul(n.pow(n.times(2)))
    .mul(prod);
  //C
  const c = q
    .pow(2)
    .div(4)
    .plus(p.pow(3).div(27))
    .sqrt()
    .minus(q.div(2))
    .pow(1 / 3);
  //Invariant
  const invariant = c.minus(p.div(c.mul(3)));
  return invariant;
}

function calcBalance(
  invariant: Decimal,
  amp: BigNumberish,
  newBalances: BigNumberish[],
  balanceIndex: number
): Decimal {
  let p = invariant;
  let sum: Decimal = new Decimal(0);
  const totalCoins = newBalances.length;
  let nn = new Decimal(1);
  let x = new Decimal(0);
  for (let i = 0; i < totalCoins; i++) {
    if (i != balanceIndex) {
      x = new Decimal(newBalances[i].toString());
    } else {
      continue;
    }
    sum = sum.add(x);
    nn = nn.mul(totalCoins).mul(totalCoins);
    p = p.mul(invariant).div(x);
  }
  p = p.mul(invariant).div(new Decimal(amp.toString()).mul(nn).mul(nn));
  const b = sum.add(invariant.div(new Decimal(amp.toString()).mul(nn)));
  const y = invariant
    .sub(b)
    .add(invariant.sub(b).mul(invariant.sub(b)).add(p.mul(4)).sqrt())
    .div(2);
  return y;
}

export function calcOutGivenIn(
  amp: BigNumberish,
  balances: BigNumberish[],
  tokenIndexIn: number,
  tokenIndexOut: number,
  tokenAmountIn: BigNumberish
): Decimal {
  const newBalances: Decimal[] = [];
  for (let index = 0; index < balances.length; index++) {
    if (index == tokenIndexIn) {
      newBalances.push(new Decimal(balances[index].toString()).add(tokenAmountIn.toString()));
    } else {
      newBalances.push(new Decimal(balances[index].toString()));
    }
  }
  const invariant = calculateInvariant(amp, balances);
  const amountOutBalance = calcBalance(
    invariant,
    amp,
    newBalances.map((balance) => balance.toString()),
    tokenIndexOut
  );
  return new Decimal(balances[tokenIndexOut].toString()).sub(amountOutBalance).sub(1);
}

export function calcInGivenOut(
  amp: BigNumberish,
  balances: BigNumberish[],
  tokenIndexIn: number,
  tokenIndexOut: number,
  tokenAmountOut: BigNumberish
): Decimal {
  const newBalances: Decimal[] = [];
  for (let index = 0; index < balances.length; index++) {
    if (index == tokenIndexOut) {
      newBalances.push(new Decimal(balances[index].toString()).sub(tokenAmountOut.toString()));
    } else {
      newBalances.push(new Decimal(balances[index].toString()));
    }
  }
  const invariant = calculateInvariant(amp, balances);
  const amountInBalance = calcBalance(
    invariant,
    amp,
    newBalances.map((balance) => balance.toString()),
    tokenIndexIn
  );
  return amountInBalance.sub(balances[tokenIndexIn].toString()).add(1);
}

export function calculateOneTokenSwapFee(
  amp: BigNumberish,
  balances: BigNumberish[],
  lastInvariant: BigNumberish,
  tokenIndex: number
): Decimal {
  const amountInBalance = calcBalance(
    new Decimal(lastInvariant.toString()),
    amp,
    balances.map((balance) => balance.toString()),
    tokenIndex
  );
  return new Decimal(balances[tokenIndex].toString()).sub(amountInBalance).sub(1);
}
