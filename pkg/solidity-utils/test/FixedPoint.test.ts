import { Contract } from 'ethers';
import Decimal from 'decimal.js';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { decimal, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('FixedPoint', () => {
  let lib: Contract;

  const EXPECTED_RELATIVE_ERROR = 1e-14;

  const valuesPow4 = [
    0.0007, 0.0022, 0.093, 2.9, 13.3, 450.8, 1550.3339, 69039.11, 7834839.432, 83202933.5433, 9983838318.4,
    15831567871.1,
  ];

  const valuesPow2 = [
    8e-9,
    0.0000013,
    0.000043,
    ...valuesPow4,
    8382392893832.1,
    38859321075205.1,
    decimal('848205610278492.2383'),
    decimal('371328129389320282.3783289'),
  ];

  const valuesPow1 = [
    1.7e-18,
    1.7e-15,
    1.7e-11,
    ...valuesPow2,
    decimal('701847104729761867823532.139'),
    decimal('175915239864219235419349070.947'),
  ];

  sharedBeforeEach('deploy lib', async () => {
    lib = await deploy('FixedPointMock', { args: [] });
  });

  const checkPow = async (x: Decimal, pow: number) => {
    const result = fp(x.pow(pow));
    expectEqualWithError(await lib.powDown(fp(x), fp(pow)), result, EXPECTED_RELATIVE_ERROR);
    expectEqualWithError(await lib.powUp(fp(x), fp(pow)), result, EXPECTED_RELATIVE_ERROR);
  };

  const checkPows = async (pow: number, values: (Decimal | number)[]) => {
    for (const value of values) {
      it(`handles ${value}`, async () => {
        await checkPow(decimal(value), pow);
      });
    }
  };

  context('non-fractional pow 1', () => {
    checkPows(1, valuesPow1);
  });

  context('non-fractional pow 2', async () => {
    checkPows(2, valuesPow2);
  });

  context('non-fractional pow 4', async () => {
    checkPows(4, valuesPow4);
  });
});
