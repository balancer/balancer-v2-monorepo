import { Decimal } from 'decimal.js';
import { decimal, BigNumberish, bn } from '../../../lib/helpers/numbers';

export function calculateInvariant(amp: BigNumberish, balances: BigNumberish[]): Decimal {
  const totalCoins = balances.length;
  const sum = balances.reduce((a, b) => a.add(b.toString()), decimal(0));

  if (sum.isZero()) {
    return decimal(0);
  }

  let inv = sum;
  let prevInv = decimal(0);
  const ampTimesTotal = decimal(amp).mul(totalCoins);

  for (let i = 0; i < 255; i++) {
    let P_D = decimal(totalCoins).mul(balances[0].toString());
    for (let j = 1; j < totalCoins; j++) {
      P_D = P_D.mul(balances[j].toString()).mul(totalCoins).div(inv);
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

  return inv;
}

export function calculateAnalyticalInvariantForTwoTokens(amp: BigNumberish, balances: BigNumberish[]): Decimal {
  if (balances.length !== 2) {
    throw 'Analytical invariant is solved only for 2 balances';
  }

  const n = decimal(balances.length);

  //Sum
  const sum = balances.reduce((a: Decimal, b: BigNumberish) => a.add(b.toString()), decimal(0));

  //Mul
  const prod = balances.reduce((a: Decimal, b: BigNumberish) => a.mul(b.toString()), decimal(1));

  //Q
  const q = decimal(amp)
    .mul(-1)
    .mul(n.pow(n.mul(2)))
    .mul(sum)
    .mul(prod);

  //P
  const p = decimal(amp)
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
  return invariant;
}

function calcBalance(
  invariant: Decimal,
  amp: BigNumberish,
  newBalances: BigNumberish[],
  balanceIndex: number
): Decimal {
  let p = invariant;
  let sum: Decimal = decimal(0);
  let nn = decimal(1);
  let x = decimal(0);

  const totalCoins = newBalances.length;
  for (let i = 0; i < totalCoins; i++) {
    if (i != balanceIndex) {
      x = decimal(newBalances[i]);
    } else {
      continue;
    }
    sum = sum.add(x);
    nn = nn.mul(totalCoins).mul(totalCoins);
    p = p.mul(invariant).div(x);
  }

  p = p.mul(invariant).div(decimal(amp).mul(nn).mul(nn));
  const b = sum.add(invariant.div(decimal(amp).mul(nn)));
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
  const newBalances: Decimal[] = balances.map((balance, index) => {
    return index == tokenIndexIn ? decimal(balance).add(tokenAmountIn.toString()) : decimal(balance);
  });

  const invariant = calculateInvariant(amp, balances);
  const amountOutBalance = calcBalance(invariant, amp, newBalances.map(bn), tokenIndexOut);
  return decimal(balances[tokenIndexOut]).sub(amountOutBalance).sub(1);
}

export function calcInGivenOut(
  amp: BigNumberish,
  balances: BigNumberish[],
  tokenIndexIn: number,
  tokenIndexOut: number,
  tokenAmountOut: BigNumberish
): Decimal {
  const newBalances: Decimal[] = balances.map((balance, index) => {
    return index == tokenIndexOut ? decimal(balance).sub(tokenAmountOut.toString()) : decimal(balance);
  });

  const invariant = calculateInvariant(amp, balances);
  const amountInBalance = calcBalance(invariant, amp, newBalances.map(bn), tokenIndexIn);
  return amountInBalance.sub(balances[tokenIndexIn].toString()).add(1);
}

export function calculateOneTokenAccumulatedSwapFees(
  amp: BigNumberish,
  balances: BigNumberish[],
  lastInvariant: BigNumberish,
  tokenIndex: number
): Decimal {
  const amountInBalance = calcBalance(decimal(lastInvariant), amp, balances, tokenIndex);
  return decimal(balances[tokenIndex]).sub(amountInBalance).sub(1);
}
