import { BigNumber, Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime, currentTimestamp, DAY, MINUTE } from '@balancer-labs/v2-helpers/src/time';
import { expect } from 'chai';

const MAX_RELATIVE_ERROR = 0.0005;

describe('WeightChange', function () {
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

      expect(interpolatedWeight).to.equal(startWeights[i]);
    }
  });

  it('gets end weights if called after the end time', async () => {
    await advanceTime(endTime.add(MINUTE));
    for (let i = 0; i < numWeights; i++) {
      const interpolatedWeight = await mock.getNormalizedWeight(startWeights[i], endWeights[i], startTime, endTime);

      expect(interpolatedWeight).to.equal(endWeights[i]);
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
        expect(interpolatedWeight).to.equalWithError(expectedInterpolatedWeight, MAX_RELATIVE_ERROR);
      }
    });
  }
});
