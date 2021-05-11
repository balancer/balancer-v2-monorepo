import { expect } from 'chai';
import { Decimal } from 'decimal.js';
import { BigNumberish, bn, pct } from '@balancer-labs/v2-helpers/src/numbers';

export function expectEqualWithError(actual: BigNumberish, expected: BigNumberish, error: BigNumberish = 0.001): void {
  actual = bn(actual);
  expected = bn(expected);
  const acceptedError = pct(expected, error);

  expect(actual).to.be.at.least(expected.sub(acceptedError));
  expect(actual).to.be.at.most(expected.add(acceptedError));
}

export function expectLessThanOrEqualWithError(
  actual: BigNumberish,
  expected: BigNumberish,
  error: BigNumberish = 0.001
): void {
  actual = bn(actual);
  expected = bn(expected);
  const minimumValue = expected.sub(pct(expected, error));

  expect(actual).to.be.at.most(expected);
  expect(actual).to.be.at.least(minimumValue);
}

export function expectRelativeError(actual: Decimal, expected: Decimal, maxRelativeError: Decimal): void {
  const lessThanOrEqualTo = actual.dividedBy(expected).sub(1).abs().lessThanOrEqualTo(maxRelativeError);
  expect(lessThanOrEqualTo, 'Relative error too big').to.be.true;
}
