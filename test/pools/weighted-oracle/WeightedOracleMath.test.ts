import { Contract } from 'ethers';

import { BigNumberish, bn } from '../../../lib/helpers/numbers';
import { deploy } from '../../../lib/helpers/deploy';
import { expectEqualWithError } from '../../helpers/relativeError';
import { range } from 'lodash';
import { toNormalizedWeights } from '../../../lib/helpers/weights';
import { calculateSpotPrice } from '../../helpers/math/weighted';

const MAX_RELATIVE_ERROR = 0.00005;

describe('WeighteOracledMath', function () {
  let mock: Contract;

  before(async function () {
    mock = await deploy('MockWeightedOracleMath');
  });

  function valuesInMagnitude(power: number) {
    return [0.4, 1.2, 2.9, 3.3, 4.8, 5.3, 6.1, 7.4, 8.5, 9.4].map((x) => bn(x * 10 ** power));
  }

  describe('low resolution logarithm', () => {
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

    context('small values', () => {
      itRecoversOriginalValueWithError(1, 5, 0.1); // Smaller values have larger error due to a lack of resolution
    });

    context('medium and large values', () => {
      itRecoversOriginalValueWithError(5, 35, MAX_RELATIVE_ERROR); // 0.05%, or ~e^0.00005
    });
  });

  describe('spot price', () => {
    function itComputesLogWithError(normWeights: BigNumberish[]) {
      const minPower = 18;
      const maxPower = 23;

      for (const powerA of range(minPower, maxPower)) {
        for (const powerB of range(minPower, maxPower)) {
          context(`with balances powers of ${powerA} and ${powerB}`, () => {
            it('computes log spot price with bounded relative error', async () => {
              for (const balanceA of valuesInMagnitude(powerA)) {
                for (const balanceB of valuesInMagnitude(powerB)) {
                  const actual = await mock.fromLowResLog(
                    await mock.calcLogSpotPrice(normWeights[0], balanceA, normWeights[1], balanceB)
                  );

                  const expected = bn(
                    calculateSpotPrice(balanceA, normWeights[0], balanceB, normWeights[1]).toFixed(0)
                  );
                  expectEqualWithError(actual, expected, MAX_RELATIVE_ERROR);
                }
              }
            });
          });
        }
      }
    }

    context('with equal weights', () => {
      const weights = toNormalizedWeights([bn(50), bn(50)]);
      itComputesLogWithError(weights);
    });

    context('with different weights', () => {
      const weights = toNormalizedWeights([bn(30), bn(70)]);
      itComputesLogWithError(weights);
    });

    context('with extreme weights', () => {
      const weights = toNormalizedWeights([bn(1), bn(99)]);
      itComputesLogWithError(weights);
    });

    context('with partial weights', () => {
      const weights = toNormalizedWeights([bn(25), bn(50), bn(25)]).slice(0, 2);
      itComputesLogWithError(weights);
    });
  });
});
