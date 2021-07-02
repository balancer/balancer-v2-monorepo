import { range } from 'lodash';
import { Contract } from 'ethers';

import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';

const MAX_RELATIVE_ERROR = 0.00005; // 0.05%, or ~e^0.00005

describe('LogCompression', function () {
  let mock: Contract;

  before(async function () {
    mock = await deploy('MockLogCompression');
  });

  function valuesInMagnitude(power: number) {
    return [0.4, 1.2, 2.9, 3.3, 4.8, 5.3, 6.1, 7.4, 8.5, 9.4].map((x) => bn(x * 10 ** power));
  }

  function itRecoversOriginalValueWithError(minPower: number, maxPower: number, maxRelativeError: number) {
    for (const power of range(minPower, maxPower)) {
      it(`encodes and decodes powers of ${power}`, async () => {
        for (const original of valuesInMagnitude(power)) {
          const actual = await mock.fromLowResLog(await mock.toLowResLog(original));
          expectEqualWithError(actual, original, maxRelativeError);
        }
      });
    }
  }

  describe('small values', () => {
    itRecoversOriginalValueWithError(1, 5, 0.1); // Smaller values have larger error due to a lack of resolution
  });

  describe('medium and large values', () => {
    itRecoversOriginalValueWithError(5, 35, MAX_RELATIVE_ERROR);
  });
});
