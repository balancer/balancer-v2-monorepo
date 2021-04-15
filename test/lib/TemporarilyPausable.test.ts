import { expect } from 'chai';
import { Contract } from 'ethers';

import { deploy } from '../../lib/helpers/deploy';
import { BigNumberish } from '../../lib/helpers/numbers';
import { advanceTime, currentTimestamp, fromNow, DAY, MONTH } from '../../lib/helpers/time';

describe('TemporarilyPausable', function () {
  let instance: Contract;

  const deployTemporarilyPausable = async ({ responseWindowDuration = 0, bufferPeriodDuration = 0 }) => {
    instance = await deploy('TemporarilyPausableMock', { args: [responseWindowDuration, bufferPeriodDuration] });
  };

  const assertPauseState = async (
    expectedStatus: boolean,
    expectedResponseWindowEndTime?: BigNumberish,
    expectedBufferPeriodDuration?: BigNumberish
  ): Promise<void> => {
    const { paused, responseWindowEndTime, bufferPeriodEndTime } = await instance.getPausedState();

    expect(paused).to.equal(expectedStatus);
    if (expectedResponseWindowEndTime) expect(responseWindowEndTime).to.equal(expectedResponseWindowEndTime);
    if (expectedBufferPeriodDuration)
      expect(bufferPeriodEndTime).to.equal(responseWindowEndTime.add(expectedBufferPeriodDuration));
  };

  describe('initialization', () => {
    it('can be initialized with response window and buffer period duration', async () => {
      const responseWindowDuration = MONTH;
      const bufferPeriodDuration = MONTH;

      await deployTemporarilyPausable({ responseWindowDuration, bufferPeriodDuration });

      await assertPauseState(false, await fromNow(responseWindowDuration), bufferPeriodDuration);
    });

    it('can be initialized with no response window or buffer period duration', async () => {
      const responseWindowDuration = 0;
      const bufferPeriodDuration = 0;

      await deployTemporarilyPausable({ responseWindowDuration, bufferPeriodDuration });

      await assertPauseState(false, await currentTimestamp(), bufferPeriodDuration);
    });

    it('cannot be initialized with a response window greater than 90 days', async () => {
      const responseWindowDuration = DAY * 91;

      await expect(deployTemporarilyPausable({ responseWindowDuration })).to.be.revertedWith(
        'MAX_RESPONSE_WINDOW_DURATION'
      );
    });

    it('cannot be initialized with a buffer period greater than 30 days', async () => {
      const responseWindowDuration = MONTH;
      const bufferPeriodDuration = DAY * 31;

      await expect(deployTemporarilyPausable({ responseWindowDuration, bufferPeriodDuration })).to.be.revertedWith(
        'MAX_BUFFER_PERIOD_DURATION'
      );
    });
  });

  describe('pause/unpause', () => {
    const RESPONSE_WINDOW_DURATION = MONTH * 3;
    const BUFFER_PERIOD_DURATION = MONTH;

    sharedBeforeEach('deploy', async () => {
      await deployTemporarilyPausable({
        responseWindowDuration: RESPONSE_WINDOW_DURATION,
        bufferPeriodDuration: BUFFER_PERIOD_DURATION,
      });
    });

    context('before the response window end date', () => {
      sharedBeforeEach('advance some time', async () => {
        await advanceTime(RESPONSE_WINDOW_DURATION / 2);
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

        await advanceTime(RESPONSE_WINDOW_DURATION / 4);

        await instance.setPaused(false);
        await assertPauseState(false, previousEndDate, BUFFER_PERIOD_DURATION);
      });
    });

    context('when the response window end date has been reached', () => {
      context('when unpaused', () => {
        sharedBeforeEach('advance time', async () => {
          await advanceTime(RESPONSE_WINDOW_DURATION);
        });

        function itIsForeverUnpaused() {
          it('is unpaused', async () => {
            await assertPauseState(false);
          });

          it('cannot be paused', async () => {
            await expect(instance.setPaused(true)).to.be.revertedWith('RESPONSE_WINDOW_EXPIRED');
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
          await advanceTime(RESPONSE_WINDOW_DURATION);
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

            await expect(instance.setPaused(true)).to.be.revertedWith('RESPONSE_WINDOW_EXPIRED');
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
            await expect(instance.setPaused(true)).to.be.revertedWith('RESPONSE_WINDOW_EXPIRED');
          });

          it('cannot be unpaused', async () => {
            await expect(instance.setPaused(false)).to.be.revertedWith('BUFFER_PERIOD_EXPIRED');
          });
        });
      });
    });
  });
});
