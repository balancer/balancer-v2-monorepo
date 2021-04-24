import { Contract } from 'ethers';

import { bn } from '../../../lib/helpers/numbers';
import { deploy } from '../../../lib/helpers/deploy';
import { expectEqualWithError } from '../../helpers/relativeError';
import { range } from 'lodash';

describe('WeighteOracledMath', function () {
  let mock: Contract;

  before(async function () {
    mock = await deploy('MockWeightedOracleMath');
  });

  context('low resolution logarithm', () => {
    function itRecoversOriginalValueWithError(minPower: number, maxPower: number, maxRelativeError: number) {
      for (const power of range(minPower, maxPower)) {
        it(`encodes and decodes powers of ${power}`, async () => {
          for (const original of [0.4, 1.2, 2.9, 3.3, 4.8, 5.3, 6.1, 7.4, 8.5, 9.4].map((x) => bn(x * 10 ** power))) {
            const actual = await mock.fromLowResLog(await mock.toLowResLog(original));
            expectEqualWithError(actual, original, maxRelativeError);
          }
        });
      }
    }

    context('small values', () => {
      itRecoversOriginalValueWithError(1, 5, 0.1); // Smaller values have larger error due to a lack of resolution
    });

    context('medium and large values', () => {
      itRecoversOriginalValueWithError(5, 35, 0.00005); // 0.0005%, or ~e^0.00005
    });
  });
});
