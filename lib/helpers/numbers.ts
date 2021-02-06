import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

const SCALING_FACTOR = 1e18;

export type BigNumberish = string | number | BigNumber;

export const fp = (x: number): BigNumber => bn(x * SCALING_FACTOR);

export const bn = (x: BigNumberish | Decimal): BigNumber =>
  BigNumber.isBigNumber(x) ? x : BigNumber.from(parseInt(x.toString()).toString());

export const decimal = (x: BigNumberish): Decimal => new Decimal(x.toString());

export const fromFp = (x: BigNumberish): Decimal => decimal(x).div(SCALING_FACTOR);
export const toFp = (x: Decimal): BigNumber => bn(x.mul(SCALING_FACTOR));

export const maxUint = (e: number): BigNumber => bn(2).pow(e).sub(1);

export const maxInt = (e: number): BigNumber => bn(2).pow(bn(e).sub(1)).sub(1);

export const minInt = (e: number): BigNumber => bn(2).pow(bn(e).sub(1)).mul(-1);

export const pct = (x: BigNumberish, pct: number): BigNumber => bn(decimal(x).div(decimal(1).div(decimal(pct))));

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
