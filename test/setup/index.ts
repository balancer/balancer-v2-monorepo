import chai from 'chai';
import { AsyncFunc } from 'mocha';

import { ZERO_ADDRESS } from '../../lib/helpers/constants';
import { BigNumberish, bn } from '../../lib/helpers/numbers';

import { NAry } from '../helpers/models/types/types';
import { sharedBeforeEach } from './sharedBeforeEach';
import { expectEqualWithError, expectLessThanOrEqualWithError } from '../helpers/relativeError';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  export namespace Chai {
    interface Assertion {
      zero: void;
      zeros: void;
      zeroAddress: void;
      lteWithError(value: NAry<BigNumberish>, error: BigNumberish): void;
      equalWithError(value: NAry<BigNumberish>, error: BigNumberish): void;
    }
  }

  function sharedBeforeEach(fn: AsyncFunc): void;
  function sharedBeforeEach(name: string, fn: AsyncFunc): void;
}

global.sharedBeforeEach = (nameOrFn: string | AsyncFunc, maybeFn?: AsyncFunc): void => {
  sharedBeforeEach(nameOrFn, maybeFn);
};

chai.use(function (chai) {
  const { Assertion } = chai;

  Assertion.addProperty('zero', function () {
    new Assertion(this._obj).to.be.equal(bn(0));
  });

  Assertion.addProperty('zeros', function () {
    const obj = this._obj;
    const expectedValue = Array(obj.length).fill(bn(0));
    new Assertion(obj).to.be.deep.equal(expectedValue);
  });

  Assertion.addProperty('zeroAddress', function () {
    new Assertion(this._obj).to.be.equal(ZERO_ADDRESS);
  });

  Assertion.addMethod('equalWithError', function (expectedValue: NAry<BigNumberish>, error: BigNumberish) {
    if (Array.isArray(expectedValue)) {
      const actual: BigNumberish[] = this._obj;
      actual.forEach((actual, i) => expectEqualWithError(actual, expectedValue[i], error));
    } else {
      expectEqualWithError(this._obj, expectedValue, error);
    }
  });

  Assertion.addMethod('lteWithError', function (expectedValue: NAry<BigNumberish>, error: BigNumberish) {
    if (Array.isArray(expectedValue)) {
      const actual: BigNumberish[] = this._obj;
      actual.forEach((actual, i) => expectLessThanOrEqualWithError(actual, expectedValue[i], error));
    } else {
      expectLessThanOrEqualWithError(this._obj, expectedValue, error);
    }
  });
});
