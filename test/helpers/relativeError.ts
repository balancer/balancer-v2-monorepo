import { expect } from 'chai';
import { Decimal } from 'decimal.js';
import { BigNumberish, bn, pct } from '../../lib/helpers/numbers';

export function expectEqualWithError(actualValue: BigNumberish, expectedValue: BigNumberish, error = 0.001): void {
  actualValue = bn(actualValue);
  expectedValue = bn(expectedValue);
  const acceptedError = pct(expectedValue, error);

  expect(actualValue).to.be.at.least(expectedValue.sub(acceptedError));
  expect(actualValue).to.be.at.most(expectedValue.add(acceptedError));
}

export function expectRelativeError(actual: Decimal, expected: Decimal, maxRelativeError: Decimal): void {
  const lessThanOrEqualTo = actual.dividedBy(expected).sub(1).abs().lessThanOrEqualTo(maxRelativeError);
  expect(lessThanOrEqualTo, 'Relative error too big').to.be.true;
}
