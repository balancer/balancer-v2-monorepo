import { BigNumber, Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime, advanceToTimestamp, currentTimestamp, DAY, MINUTE } from '@balancer-labs/v2-helpers/src/time';
import { expect } from 'chai';

const MAX_RELATIVE_ERROR = 0.0005;

describe('GradualValueChange', function () {
  let mock: Contract;

  before(async function () {
    mock = await deploy('MockGradualValueChange');
  });

  describe('resolveStartTime', () => {
    let now: BigNumber;

    sharedBeforeEach('get current timestamp', async () => {
      now = await currentTimestamp();
    });

    context('when the start time is after the end time', () => {
      it('reverts', async () => {
        const startTime = now.add(DAY);
        await expect(mock.resolveStartTime(startTime, startTime.sub(1))).to.be.revertedWith(
          'GRADUAL_UPDATE_TIME_TRAVEL'
        );
      });
    });

    context('when the start time is before the end time', () => {
      it('returns the start time', async () => {
        const startTime = now.add(DAY);
        expect(await mock.resolveStartTime(startTime, startTime)).to.be.eq(startTime);
        expect(await mock.resolveStartTime(startTime, startTime.add(1))).to.be.eq(startTime);
        expect(await mock.resolveStartTime(startTime, startTime.add(DAY))).to.be.eq(startTime);
      });

      context('when the start time is in the past', () => {
        it('it is fast forwarded up to the current timestamp', async () => {
          const startTime = now.sub(DAY);
          const endTime = startTime.add(DAY);
          expect(await mock.resolveStartTime(startTime, endTime)).to.be.eq(now);
          expect(await mock.resolveStartTime(startTime, endTime)).to.be.eq(now);
          expect(await mock.resolveStartTime(startTime, endTime)).to.be.eq(now);
        });
      });
    });
  });

  describe('getInterpolatedValue', () => {
    function itInterpolatesValuesCorrectly(updateDuration: number) {
      const numValues = 20;
      const startValues = Array.from({ length: numValues }).map((_, i) => fp(i / numValues));
      const endValues = startValues.map((value, i) => {
        if (i % 2 == 0) {
          return value.add(fp(0.02));
        }
        return value.sub(fp(0.02));
      });

      let now, startTime: BigNumber, endTime: BigNumber;
      const START_DELAY = MINUTE * 10;

      sharedBeforeEach('updateWeightsGradually', async () => {
        now = await currentTimestamp();
        startTime = now.add(START_DELAY);
        endTime = startTime.add(updateDuration);
      });

      it('gets start weights if called before the start time', async () => {
        for (let i = 0; i < numValues; i++) {
          const interpolatedWeight = await mock.getInterpolatedValue(startValues[i], endValues[i], startTime, endTime);

          expect(interpolatedWeight).to.equal(startValues[i]);
        }
      });

      it('gets end weights if called after the end time', async () => {
        await advanceToTimestamp(endTime.add(MINUTE));
        for (let i = 0; i < numValues; i++) {
          const interpolatedWeight = await mock.getInterpolatedValue(startValues[i], endValues[i], startTime, endTime);

          expect(interpolatedWeight).to.equal(endValues[i]);
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

      // These tests are only meaningful in the non-degenerate case.
      if (updateDuration > 0) {
        for (let pct = 5; pct < 100; pct += 5) {
          it(`gets correct intermediate weight if called ${pct}% through`, async () => {
            await advanceTime(START_DELAY + (updateDuration * pct) / 100);

            for (let i = 0; i < numValues; i++) {
              const interpolatedWeight = await mock.getInterpolatedValue(
                startValues[i],
                endValues[i],
                startTime,
                endTime
              );
              const expectedInterpolatedWeight = getIntermediateWeight(startValues[i], endValues[i], pct);
              expect(interpolatedWeight).to.equalWithError(expectedInterpolatedWeight, MAX_RELATIVE_ERROR);
            }
          });
        }
      }
    }

    context('when startTime is before end time (standard case)', () => {
      const UPDATE_DURATION = DAY * 2;

      itInterpolatesValuesCorrectly(UPDATE_DURATION);
    });

    context('when startTime is equal to endTime (degenerate case)', () => {
      const UPDATE_DURATION = 0;

      itInterpolatesValuesCorrectly(UPDATE_DURATION);
    });
  });
});
