import { BigNumber, Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime, currentTimestamp, DAY, MINUTE } from '@balancer-labs/v2-helpers/src/time';
import { expect } from 'chai';

describe.only('WeightChange', function () {
  let mock: Contract;

  before(async function () {
    mock = await deploy('MockWeightChange');
  });

  const numWeights = 20;
  const startWeights = Array.from({ length: numWeights }).map((_, i) => fp(i / numWeights));
  const endWeights = startWeights.map((weight, i) => {
    if (i % 2 == 0) {
      return weight.add(fp(0.02));
    }
    return weight.sub(fp(0.02));
  });

  context('with valid parameters (ongoing weight update)', () => {
    let now, startTime: BigNumber, endTime: BigNumber;
    const START_DELAY = MINUTE * 10;
    const UPDATE_DURATION = DAY * 2;

    sharedBeforeEach('updateWeightsGradually', async () => {
      now = await currentTimestamp();
      startTime = now.add(START_DELAY);
      endTime = startTime.add(UPDATE_DURATION);
    });

    it('gets start weights if called before the start time', async () => {
      for (let i = 0; i < numWeights; i++) {
        const interpolatedWeight = await mock.getNormalizedWeight(startWeights[i], endWeights[i], startTime, endTime);

        // Need to decrease precision
        expect(interpolatedWeight).to.equalWithError(startWeights[i], 0.0001);
      }
    });

    it('gets end weights if called after the end time', async () => {
      await advanceTime(endTime.add(MINUTE));
      for (let i = 0; i < numWeights; i++) {
        const interpolatedWeight = await mock.getNormalizedWeight(startWeights[i], endWeights[i], startTime, endTime);

        // Need to decrease precision
        expect(interpolatedWeight).to.equalWithError(endWeights[i], 0.0001);
      }
    });

    function getIntermediateWeight(startWeight: BigNumber, endWeight: BigNumber, pct: number): BigNumber {
      if (startWeight < endWeight) {
        // Weight is increasing
        return startWeight.add(endWeight.sub(startWeight).mul(pct).div(100));
      } else {
        // Weight is decreasing (or not changing)
        return startWeight.sub(startWeight.sub(endWeight).mul(pct).div(100));
      }
    }

    for (let pct = 5; pct < 100; pct += 5) {
      it(`gets correct intermediate weight if called ${pct}% through`, async () => {
        await advanceTime(START_DELAY + (UPDATE_DURATION * pct) / 100);
        for (let i = 0; i < numWeights; i++) {
          const interpolatedWeight = await mock.getNormalizedWeight(startWeights[i], endWeights[i], startTime, endTime);
          const expectedInterpolatedWeight = getIntermediateWeight(startWeights[i], endWeights[i], pct);
          // Need to decrease precision
          expect(interpolatedWeight).to.equalWithError(expectedInterpolatedWeight, 0.0001);
        }
      });
    }
  });
});
