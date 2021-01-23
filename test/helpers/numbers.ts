import { expect } from 'chai';
import { BigNumber } from 'ethers';

const SCALING_FACTOR = 1e18;

export type BigNumberish = string | number | BigNumber;

export const fp = (x: number): BigNumber => bn(x * SCALING_FACTOR);

export const bn = (x: BigNumberish): BigNumber => BigNumber.from(x.toString());

export const bigExp = (x: BigNumberish, y: BigNumberish): BigNumber => bn(x).mul(bn(10).pow(bn(y)));

export const maxUint = (e: number): BigNumber => bn(2).pow(e).sub(1);

export const maxInt = (e: number): BigNumber => bn(2).pow(bn(e).sub(1)).sub(1);

export const minInt = (e: number): BigNumber => bn(2).pow(bn(e).sub(1)).mul(-1);

export const pct = (n: BigNumber, pct: number): BigNumber => n.div(bn(1 / pct));

export const FP_SCALING_FACTOR = bn(SCALING_FACTOR);

export function assertEqualWithError(actualValue: BigNumber, expectedValue: BigNumber, error: number): void {
  const acceptedError = pct(expectedValue, error);
  expect(actualValue).to.be.at.least(expectedValue.sub(acceptedError));
  expect(actualValue).to.be.at.most(expectedValue.add(acceptedError));
}
