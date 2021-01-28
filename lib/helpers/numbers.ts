import { Decimal } from 'decimal.js';
import { BigNumber as BN } from 'ethers';

const SCALING_FACTOR = 1e18;

export type BigNumberish = string | number | BN;

export const fp = (x: number): BN => bn(x * SCALING_FACTOR);

export const bn = (x: BigNumberish | Decimal): BN =>
  BN.isBigNumber(x) ? x : BN.from(parseInt(x.toString()).toString());

export const decimal = (x: BigNumberish): Decimal => new Decimal(x.toString());

export const maxUint = (e: number): BN => bn(2).pow(e).sub(1);

export const maxInt = (e: number): BN => bn(2).pow(bn(e).sub(1)).sub(1);

export const minInt = (e: number): BN => bn(2).pow(bn(e).sub(1)).mul(-1);

export const pct = (n: BN, pct: number): BN => n.div(bn(1 / pct));

export const max = (a: BigNumberish, b: BigNumberish): BN => {
  a = bn(a);
  b = bn(b);

  return a.gt(b) ? a : b;
};

export const min = (a: BigNumberish, b: BigNumberish): BN => {
  a = bn(a);
  b = bn(b);

  return a.lt(b) ? a : b;
};

export const arrayAdd = (arrA: BigNumberish[], arrB: BigNumberish[]): BN[] =>
  arrA.map((a, i) => bn(a).add(bn(arrB[i])));

export const arraySub = (arrA: BigNumberish[], arrB: BigNumberish[]): BN[] =>
  arrA.map((a, i) => bn(a).sub(bn(arrB[i])));

export const divCeil = (x: BN, y: BN): BN =>
  // ceil(x/y) == (x + y - 1) / y
  x.add(y).sub(1).div(y);

export const FP_SCALING_FACTOR = bn(SCALING_FACTOR);
