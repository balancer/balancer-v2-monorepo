import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

const SCALING_FACTOR = 1e18;

export type BigNumberish = string | number | BigNumber;

export const fp = (x: number): BigNumber => bn(x * SCALING_FACTOR);

export const bn = (x: BigNumberish | Decimal): BigNumber => {
  if (BigNumber.isBigNumber(x)) return x;
  const integer = parseInt(parseScientific(x.toString()));
  const stringified = parseScientific(integer.toString());
  return BigNumber.from(stringified);
};

export const decimal = (x: BigNumberish | Decimal): Decimal => new Decimal(x.toString());

export const maxUint = (e: number): BigNumber => bn(2).pow(e).sub(1);

export const maxInt = (e: number): BigNumber => bn(2).pow(bn(e).sub(1)).sub(1);

export const minInt = (e: number): BigNumber => bn(2).pow(bn(e).sub(1)).mul(-1);

export const pct = (x: BigNumberish, pct: BigNumberish): BigNumber => bn(decimal(x).mul(decimal(pct)));

export const max = (a: BigNumberish, b: BigNumberish): BigNumber => {
  a = bn(a);
  b = bn(b);

  return a.gt(b) ? a : b;
};

export const min = (a: BigNumberish, b: BigNumberish): BigNumber => {
  a = bn(a);
  b = bn(b);

  return a.lt(b) ? a : b;
};

export const arrayAdd = (arrA: BigNumberish[], arrB: BigNumberish[]): BigNumber[] =>
  arrA.map((a, i) => bn(a).add(bn(arrB[i])));

export const arraySub = (arrA: BigNumberish[], arrB: BigNumberish[]): BigNumber[] =>
  arrA.map((a, i) => bn(a).sub(bn(arrB[i])));

export const divCeil = (x: BigNumber, y: BigNumber): BigNumber =>
  // ceil(x/y) == (x + y - 1) / y
  x.add(y).sub(1).div(y);

export const FP_SCALING_FACTOR = bn(SCALING_FACTOR);

function parseScientific(num: string): string {
  // If the number is not in scientific notation return it as it is
  if (!/\d+\.?\d*e[+-]*\d+/i.test(num)) return num;

  // Remove the sign
  const numberSign = Math.sign(Number(num));
  num = Math.abs(Number(num)).toString();

  // Parse into coefficient and exponent
  const [coefficient, exponent] = num.toLowerCase().split('e');
  let zeros = Math.abs(Number(exponent));
  const exponentSign = Math.sign(Number(exponent));
  const [integer, decimals] = coefficient.split('.');

  if (exponentSign === -1) {
    zeros -= integer.length;
    num =
      zeros < 0
        ? integer.slice(0, zeros) + '.' + integer.slice(zeros) + (decimals ? decimals : '')
        : '0.' + '0'.repeat(zeros) + integer + decimals;
  } else {
    if (decimals) zeros -= decimals.length;
    num =
      zeros < 0
        ? integer + decimals.slice(0, zeros) + '.' + decimals.slice(zeros)
        : integer + decimals + '0'.repeat(zeros);
  }

  return numberSign < 0 ? '-' + num : num;
}
