import { expect } from 'chai';
import { BigNumber } from 'ethers';

export const bn = (x: string | number): BigNumber => BigNumber.from(x.toString());

export const bigExp = (x: string | number, y: string | number): BigNumber => bn(x).mul(bn(10).pow(bn(y)));

export const maxUint = (e: number): BigNumber => bn(2).pow(e).sub(1);

export const maxInt = (e: number): BigNumber => bn(2).pow(bn(e).sub(1)).sub(1);

export const minInt = (e: number): BigNumber => bn(2).pow(bn(e).sub(1)).mul(-1);

export const pct = (n: BigNumber, pct: number): BigNumber => n.div(bn(1 / pct));

export function assertEqualWithError(actualValue: BigNumber, expectedValue: BigNumber, error: number): void {
  const acceptedError = pct(expectedValue, error);
  expect(actualValue).to.be.at.least(expectedValue.sub(acceptedError));
  expect(actualValue).to.be.at.most(expectedValue.add(acceptedError));
}
