import { Decimal } from 'decimal.js';

//TODO: Test this math by checking  extremes values for the amplification field (0 and infinite)
//to verify that it equals constant sum and constant product (weighted) invariants.

export function calculateInvariant(amp: Decimal, balances: Decimal[]): Decimal {
  let sum = new Decimal(0);
  const totalCoins = balances.length;
  for (let i = 0; i < totalCoins; i++) {
    sum = sum.add(balances[i]);
  }
  if (sum.isZero()) {
    return new Decimal(0);
  }
  let prevInv = new Decimal(0);
  let inv = sum;
  const ampTimesTotal = amp.times(totalCoins);
  for (let i = 0; i < 255; i++) {
    let P_D = new Decimal(totalCoins).times(balances[0]);
    for (let j = 1; j < totalCoins; j++) {
      P_D = P_D.times(balances[j]).times(totalCoins).div(inv);
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

function calcBalance(amp: Decimal, oldBalances: Decimal[], newBalances: Decimal[], balanceIndex: number): Decimal {
  const n = new Decimal(oldBalances.length);
  //Invariant
  const invariant = calculateInvariant(amp, oldBalances);

  //Sum (without amount in)
  const sum = newBalances.reduce((a: Decimal, b: Decimal, index: number) => {
    if (index !== balanceIndex) return a.add(b);
    else return a;
  }, new Decimal(0));
  //Mul (without amount in)
  const prod = newBalances.reduce((a: Decimal, b: Decimal, index: number) => {
    if (index !== balanceIndex) return a.mul(b);
    else return a;
  }, new Decimal(1));
  //a
  const a = amp;
  //b
  const b = amp.mul(sum).add(new Decimal(1).div(n.pow(n)).minus(amp).mul(invariant));
  //c
  const c = new Decimal(-1)
    .times(invariant.pow(3))
    .div(n.pow(n.times(2)))
    .mul(new Decimal(1).div(prod));
  //Amount out
  const tokenAmountOut = new Decimal(-1)
    .times(b)
    .plus(b.pow(2).minus(a.mul(c).mul(4)).sqrt())
    .div(a.mul(2));
  return tokenAmountOut;
}

export function calcOutGivenIn(
  amp: Decimal,
  balances: Decimal[],
  tokenIndexIn: number,
  tokenIndexOut: number,
  tokenAmountIn: Decimal
): Decimal {
  const newBalances: Decimal[] = [];
  for (let index = 0; index < balances.length; index++) {
    if (index == tokenIndexIn) {
      newBalances.push(balances[index].add(tokenAmountIn));
    } else {
      newBalances.push(balances[index]);
    }
  }
  const amountOutBalance = calcBalance(amp, balances, newBalances, tokenIndexOut);
  return balances[tokenIndexOut].sub(amountOutBalance);
}

export function calcInGivenOut(
  amp: Decimal,
  balances: Decimal[],
  tokenIndexIn: number,
  tokenIndexOut: number,
  tokenAmountOut: Decimal
): Decimal {
  const newBalances: Decimal[] = [];
  for (let index = 0; index < balances.length; index++) {
    if (index == tokenIndexOut) {
      newBalances.push(balances[index].sub(tokenAmountOut));
    } else {
      newBalances.push(balances[index]);
    }
  }
  const amountInBalance = calcBalance(amp, balances, newBalances, tokenIndexIn);
  return amountInBalance.sub(balances[tokenIndexIn]);
}
