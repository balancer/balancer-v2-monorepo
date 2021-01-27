import { expect } from 'chai';
import { BigNumber } from 'ethers';

const SCALING_FACTOR = 1e18;

export type BigNumberish = string | number | BigNumber;

export const fp = (x: number): BigNumber => bn(x * SCALING_FACTOR);

export const bn = (x: BigNumberish): BigNumber => BigNumber.from(x.toString());

export const FP_SCALING_FACTOR = bn(SCALING_FACTOR);

export const maxUint = (e: number): BigNumber => bn(2).pow(e).sub(1);

export const maxInt = (e: number): BigNumber => bn(2).pow(bn(e).sub(1)).sub(1);

export const minInt = (e: number): BigNumber => bn(2).pow(bn(e).sub(1)).mul(-1);

export const pct = (n: BigNumber, pct: number): BigNumber => n.div(bn(1 / pct));

export const bnMax = (a: BigNumberish, b: BigNumberish): BigNumber => {
  a = bn(a);
  b = bn(b);

  return a.gt(b) ? a : b;
};

export const bnMin = (a: BigNumberish, b: BigNumberish): BigNumber => {
  a = bn(a);
  b = bn(b);

  return a.lt(b) ? a : b;
};

export function arrayAdd(arrA: BigNumberish[], arrB: BigNumberish[]): BigNumber[] {
  return arrA.map((a, i) => bn(a).add(bn(arrB[i])));
}

export function arraySub(arrA: BigNumberish[], arrB: BigNumberish[]): BigNumber[] {
  return arrA.map((a, i) => bn(a).sub(bn(arrB[i])));
}

export function divCeil(x: BigNumber, y: BigNumber): BigNumber {
  // ceil(x/y) == (x + y - 1) / y
  return x.add(y).sub(1).div(y);
}

export function expectEqualWithError(actualValue: BigNumberish, expectedValue: BigNumberish, error = 0.001): void {
  actualValue = bn(actualValue);
  expectedValue = bn(expectedValue);
  const acceptedError = pct(expectedValue, error);

  expect(actualValue).to.be.at.least(expectedValue.sub(acceptedError));
  expect(actualValue).to.be.at.most(expectedValue.add(acceptedError));
}
