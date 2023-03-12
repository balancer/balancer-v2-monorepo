import { expect } from 'chai';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime, currentTimestamp, fromNow, MONTH } from '@balancer-labs/v2-helpers/src/time';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('TemporarilyPausable', function () {
  let instance: Contract;

  const deployTemporarilyPausable = async ({ pauseWindowDuration = 0, bufferPeriodDuration = 0 }) => {
    instance = await deploy('TemporarilyPausableMock', { args: [pauseWindowDuration, bufferPeriodDuration] });
  };

  const assertPauseState = async (
    expectedStatus: boolean,
    expectedPauseWindowEndTime?: BigNumberish,
    expectedBufferPeriodDuration?: BigNumberish
  ): Promise<void> => {
    const { paused, pauseWindowEndTime, bufferPeriodEndTime } = await instance.getPausedState();

    expect(paused).to.equal(expectedStatus);
    if (expectedPauseWindowEndTime) expect(pauseWindowEndTime).to.equal(expectedPauseWindowEndTime);
    if (expectedBufferPeriodDuration)
      expect(bufferPeriodEndTime).to.equal(pauseWindowEndTime.add(expectedBufferPeriodDuration));
  };

  describe('initialization', () => {
    it('can be initialized with pause window and buffer period duration', async () => {
      const pauseWindowDuration = MONTH;
      const bufferPeriodDuration = MONTH;

      await deployTemporarilyPausable({ pauseWindowDuration, bufferPeriodDuration });

      await assertPauseState(false, await fromNow(pauseWindowDuration), bufferPeriodDuration);
    });

    it('can be initialized with no pause window or buffer period duration', async () => {
      const pauseWindowDuration = 0;
      const bufferPeriodDuration = 0;

      await deployTemporarilyPausable({ pauseWindowDuration, bufferPeriodDuration });

      await assertPauseState(false, await currentTimestamp(), bufferPeriodDuration);
    });

    it('cannot be initialized with a pause window greater than the max', async () => {
      const maxPauseWindowDuration = await instance.getMaxPauseWindowDuration();
      const pauseWindowDuration = maxPauseWindowDuration + 1;

      await expect(deployTemporarilyPausable({ pauseWindowDuration })).to.be.revertedWith('MAX_PAUSE_WINDOW_DURATION');
    });

    it('cannot be initialized with a buffer period greater than the max', async () => {
      const maxBufferPeriodDuration = await instance.getMaxBufferPeriodDuration();
      const pauseWindowDuration = MONTH;
      const bufferPeriodDuration = maxBufferPeriodDuration + 1;

      await expect(deployTemporarilyPausable({ pauseWindowDuration, bufferPeriodDuration })).to.be.revertedWith(
        'MAX_BUFFER_PERIOD_DURATION'
      );
    });
  });

  describe('pause/unpause', () => {
    const PAUSE_WINDOW_DURATION = MONTH * 3;
    const BUFFER_PERIOD_DURATION = MONTH;

    sharedBeforeEach('deploy', async () => {
      await deployTemporarilyPausable({
        pauseWindowDuration: PAUSE_WINDOW_DURATION,
        bufferPeriodDuration: BUFFER_PERIOD_DURATION,
      });
    });

    context('before the pause window end date', () => {
      sharedBeforeEach('advance some time', async () => {
        await advanceTime(PAUSE_WINDOW_DURATION / 2);
      });

      it('can be paused', async () => {
        const { endDate: previousEndDate } = await instance.getPausedState();

        await instance.setPaused(true);

        await assertPauseState(true, previousEndDate, BUFFER_PERIOD_DURATION);
      });

      it('can be paused and unpaused', async () => {
        const { endDate: previousEndDate } = await instance.getPausedState();

        await instance.setPaused(true);
        await assertPauseState(true, previousEndDate, BUFFER_PERIOD_DURATION);

        await advanceTime(PAUSE_WINDOW_DURATION / 4);

        await instance.setPaused(false);
        await assertPauseState(false, previousEndDate, BUFFER_PERIOD_DURATION);
      });
    });

    context('when the pause window end date has been reached', () => {
      context('when unpaused', () => {
        sharedBeforeEach('advance time', async () => {
          await advanceTime(PAUSE_WINDOW_DURATION);
        });

        function itIsForeverUnpaused() {
          it('is unpaused', async () => {
            await assertPauseState(false);
          });

          it('cannot be paused', async () => {
            await expect(instance.setPaused(true)).to.be.revertedWith('PAUSE_WINDOW_EXPIRED');
          });
        }

        context('before the buffer period end date', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(BUFFER_PERIOD_DURATION / 2);
          });

          itIsForeverUnpaused();
        });

        context('after the buffer period end date', () => {
          sharedBeforeEach('reach the buffer period end date', async () => {
            await advanceTime(BUFFER_PERIOD_DURATION);
          });

          itIsForeverUnpaused();
        });
      });

      context('when paused', () => {
        sharedBeforeEach('pause and advance time', async () => {
          await instance.setPaused(true);
          await advanceTime(PAUSE_WINDOW_DURATION);
        });

        context('before the buffer period end date', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(BUFFER_PERIOD_DURATION / 2);
          });

          it('is paused', async () => {
            await assertPauseState(true);
          });

          it('can be unpaused', async () => {
            await instance.setPaused(false);
            await assertPauseState(false);
          });

          it('cannot be unpaused and paused', async () => {
            await instance.setPaused(false);
            await assertPauseState(false);

            await expect(instance.setPaused(true)).to.be.revertedWith('PAUSE_WINDOW_EXPIRED');
          });
        });

        context('after the buffer period end date', () => {
          sharedBeforeEach('reach the buffer period end date', async () => {
            await advanceTime(BUFFER_PERIOD_DURATION);
          });

          it('is unpaused', async () => {
            await assertPauseState(false);
          });

          it('cannot be paused', async () => {
            await expect(instance.setPaused(true)).to.be.revertedWith('PAUSE_WINDOW_EXPIRED');
          });

          it('cannot be unpaused', async () => {
            await expect(instance.setPaused(false)).to.be.revertedWith('BUFFER_PERIOD_EXPIRED');
          });
        });
      });
    });
  });
});
