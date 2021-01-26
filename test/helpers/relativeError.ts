import { expect } from 'chai';
import { Decimal } from 'decimal.js';

export function expectRelativeError(amount1: Decimal, amount2: Decimal, maxRelativeError: Decimal): void {
  expect(amount1.dividedBy(amount2).sub(1).abs().lessThanOrEqualTo(maxRelativeError), 'Relative error too big').to.be
    .true;
}
