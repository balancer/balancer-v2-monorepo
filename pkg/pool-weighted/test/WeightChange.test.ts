import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { DAY, MINUTE } from '@balancer-labs/v2-helpers/src/time';

const MAX_RELATIVE_ERROR = 0.00005;

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

  const START_DELAY = MINUTE * 10;
  const UPDATE_DURATION = DAY * 2;

  const offset = bn(50 * 365 * DAY);
  const startTime = offset.add(START_DELAY);
  const endTime = startTime.add(UPDATE_DURATION);

  it('gets start weights if called before the start time', async () => {
    const now = offset;
    for (let i = 0; i < numWeights; i++) {
      const interpolatedWeight = await mock.getNormalizedWeight(
        startWeights[i],
        endWeights[i],
        now,
        startTime,
        endTime
      );

      // Need to decrease precision
      expect(interpolatedWeight).to.equal(startWeights[i]);
    }
  });

  it('gets end weights if called after the end time', async () => {
    const now = endTime.add(MINUTE);
    for (let i = 0; i < numWeights; i++) {
      const interpolatedWeight = await mock.getNormalizedWeight(
        startWeights[i],
        endWeights[i],
        now,
        startTime,
        endTime
      );

      // Need to decrease precision
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
      const now = startTime.add((UPDATE_DURATION * pct) / 100);

      for (let i = 0; i < numWeights; i++) {
        const interpolatedWeight = await mock.getNormalizedWeight(
          startWeights[i],
          endWeights[i],
          now,
          startTime,
          endTime
        );
        const expectedInterpolatedWeight = getIntermediateWeight(startWeights[i], endWeights[i], pct);
        // Need to decrease precision
        expect(interpolatedWeight).to.equalWithError(expectedInterpolatedWeight, MAX_RELATIVE_ERROR);
      }
    });
  }
});
