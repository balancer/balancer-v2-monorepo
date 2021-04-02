import chai, { expect } from 'chai';
import { AsyncFunc } from 'mocha';

import { ZERO_ADDRESS } from '../../lib/helpers/constants';
import { BigNumberish, bn } from '../../lib/helpers/numbers';

import * as reasons from '../helpers/balancer-errors.json';
import { NAry } from '../helpers/models/types/types';
import { sharedBeforeEach } from './sharedBeforeEach';
import { expectEqualWithError, expectLessThanOrEqualWithError } from '../helpers/relativeError';

/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */

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

  Assertion.overwriteMethod('revertedWith', function (_super) {
    return async function (this: any) {
      // eslint-disable-next-line prefer-rest-params
      const assertion = _super.apply(this, arguments);
      const promise = assertion._obj;
      try {
        // Execute promise given to assert method and catch revert reason if there was any
        await promise;
        // If the statement didn't revert throw
        this.assert(
          false,
          'Expected transaction to be reverted',
          'Expected transaction NOT to be reverted',
          'Transaction reverted.',
          'Transaction NOT reverted.'
        );
      } catch (revert) {
        try {
          // Run catch function
          const catchResult = await assertion.catch(revert);
          // If the catch function didn't throw, then return it because it did match what we were expecting
          return catchResult;
        } catch (error) {
          // If the catch didn't throw because another reason was expected, re-throw the error
          if (!error.message.includes('but other exception was thrown')) throw error;

          // Decode the actual revert reason and look for it in the balancer errors list
          const regExp = /(Expected transaction to be reverted with )(.*)(, but other exception was thrown: .*Error: VM Exception while processing transaction: revert )(.*)/;
          const matches = error.message.match(regExp);
          if (!matches || matches.length !== 5) throw error;

          const expectedReason: string = matches[2];
          let actualErrorCode: string = matches[4];

          // If the actual error code is not a balancer error, re-throw error
          if (!actualErrorCode.includes('BAL#')) throw error;
          actualErrorCode = actualErrorCode.replace('BAL#', '');

          // If there is no balancer error matching the expected revert reason re-throw the error
          // @ts-ignore
          const expectedError = Object.entries(reasons).find(([, value]) => value == expectedReason);
          if (!expectedError) throw error;
          const expectedErrorCode = expectedError[0];

          // @ts-ignore
          let actualReason = reasons[actualErrorCode];
          if (!actualReason) actualReason = `Could not match a Balancer error message`;

          // Otherwise, assert the error code matched the actual reason
          const message = `Expected transaction to be reverted with BAL#${expectedErrorCode} (${expectedReason}), but other exception was thrown: Error: VM Exception while processing transaction: revert BAL#${actualErrorCode} (${actualReason})`;
          expect(actualErrorCode).to.be.equal(expectedErrorCode, message);
        }
      }
    };
  });
});
