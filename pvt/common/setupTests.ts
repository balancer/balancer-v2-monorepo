import { AsyncFunc } from 'mocha';
import { BigNumber } from 'ethers';
import chai, { expect } from 'chai';

import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';

import { BalancerErrors } from '@balancer-labs/balancer-js';
import { NAry } from '@balancer-labs/v2-helpers/src/models/types/types';
import { expectEqualWithError, expectLessThanOrEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';

import { sharedBeforeEach } from './sharedBeforeEach';

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

chai.use(function (chai, utils) {
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
          const regExp = /(Expected transaction to be reverted with )(.*)(, but other exception was thrown: .*Error: VM Exception while processing transaction: reverted with reason string ')(.*)(')/;
          const matches = error.message.match(regExp);
          if (!matches || matches.length !== 6) throw error;

          const expectedReason: string = matches[2];
          const actualErrorCode: string = matches[4];

          let actualReason: string;
          if (BalancerErrors.isErrorCode(actualErrorCode)) {
            actualReason = BalancerErrors.parseErrorCode(actualErrorCode);
          } else {
            if (actualErrorCode.includes('BAL#')) {
              // If we failed to decode the error but it looks like a Balancer error code
              // then it might be a Balancer error we don't know about yet.
              actualReason = 'Could not match a Balancer error message';
            } else {
              // If it's not a Balancer error then rethrow
              throw error;
            }
          }

          let expectedErrorCode: string;
          if (BalancerErrors.isBalancerError(expectedReason)) {
            expectedErrorCode = BalancerErrors.encodeError(expectedReason);
          } else {
            // If there is no balancer error matching the expected revert reason re-throw the error
            error.message = `${error.message} (${actualReason})`;
            throw error;
          }

          // Assert the error code matched the actual reason
          const message = `Expected transaction to be reverted with ${expectedErrorCode} (${expectedReason}), but other exception was thrown: Error: VM Exception while processing transaction: revert ${actualErrorCode} (${actualReason})`;
          expect(actualErrorCode).to.be.equal(expectedErrorCode, message);
        }
      }
    };
  });

  ['eq', 'equal', 'equals'].forEach((fn: string) => {
    Assertion.overwriteMethod(fn, function (_super) {
      return function (this: any, expected: any) {
        const actual = utils.flag(this, 'object');
        if (
          utils.flag(this, 'deep') &&
          Array.isArray(actual) &&
          Array.isArray(expected) &&
          actual.length === expected.length &&
          (actual.some(BigNumber.isBigNumber) || expected.some(BigNumber.isBigNumber))
        ) {
          const equal = actual.every((value: any, i: number) => BigNumber.from(value).eq(expected[i]));
          this.assert(
            equal,
            `Expected "[${expected}]" to be deeply equal [${actual}]`,
            `Expected "[${expected}]" NOT to be deeply equal [${actual}]`,
            expected,
            actual
          );
        } else {
          // eslint-disable-next-line prefer-rest-params
          _super.apply(this, arguments);
        }
      };
    });
  });
});
