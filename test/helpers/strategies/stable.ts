import { Decimal } from 'decimal.js';

function _invariant(amp: Decimal, balances: Decimal[]): Decimal {
  const n = new Decimal(balances.length);
  //Sum
  const sum = balances.reduce((a: Decimal, b: Decimal) => a.add(b), new Decimal(0));
  //Mul
  const prod = balances.reduce((a: Decimal, b: Decimal) => a.times(b), new Decimal(1));
  //Q
  const q = amp
    .mul(-1)
    .mul(n.pow(n.times(2)))
    .mul(sum)
    .mul(prod);
  //P
  const p = amp
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

function calcBalance(amp: Decimal, oldBalances: Decimal[], newBalances: Decimal[], balanceIndex: number): Decimal {
  const n = new Decimal(oldBalances.length);
  //Invariant
  const invariant = _invariant(amp, oldBalances);

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
