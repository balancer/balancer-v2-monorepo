import { expect } from 'chai';
import { Contract } from 'ethers';

import { deploy } from '../../lib/helpers/deploy';
import { BigNumberish } from '../../lib/helpers/numbers';
import { advanceTime, currentTimestamp, fromNow, DAY, MONTH } from '../../lib/helpers/time';

describe('EmergencyPeriod', function () {
  let emergency: Contract;

  const deployEmergencyPeriod = async ({ emergencyResponseWindow = 0, emergencyBufferPeriod = 0 }) => {
    emergency = await deploy('TemporarilyPausableMock', { args: [emergencyResponseWindow, emergencyBufferPeriod] });
  };

  const assertEmergencyPeriod = async (
    expectedStatus: boolean,
    expectedResponseWindow?: BigNumberish,
    expectedBufferPeriod?: BigNumberish
  ): Promise<void> => {
    const { paused, responseWindowEndTime, bufferPeriodEndTime } = await emergency.getPausedState();

    expect(paused).to.equal(expectedStatus);
    if (expectedResponseWindow) expect(responseWindowEndTime).to.equal(expectedResponseWindow);
    if (expectedBufferPeriod) expect(bufferPeriodEndTime).to.equal(responseWindowEndTime.add(expectedBufferPeriod));
  };

  describe('initialization', () => {
    it('can be initialized with an emergency period', async () => {
      const emergencyResponseWindow = MONTH;
      const emergencyBufferPeriod = MONTH;

      await deployEmergencyPeriod({ emergencyResponseWindow, emergencyBufferPeriod });

      await assertEmergencyPeriod(false, await fromNow(emergencyResponseWindow), emergencyBufferPeriod);
    });

    it('can be initialized without emergency period', async () => {
      const emergencyResponseWindow = 0;
      const emergencyBufferPeriod = 0;

      await deployEmergencyPeriod({ emergencyResponseWindow, emergencyBufferPeriod });

      await assertEmergencyPeriod(false, await currentTimestamp(), emergencyBufferPeriod);
    });

    it('cannot be initialized with an emergency period greater than 90 days', async () => {
      const emergencyResponseWindow = DAY * 91;

      await expect(deployEmergencyPeriod({ emergencyResponseWindow })).to.be.revertedWith(
        'MAX_RESPONSE_WINDOW_DURATION'
      );
    });

    it('cannot be initialized with an emergency period check extension greater than 30 days', async () => {
      const emergencyResponseWindow = MONTH;
      const emergencyBufferPeriod = DAY * 31;

      await expect(deployEmergencyPeriod({ emergencyResponseWindow, emergencyBufferPeriod })).to.be.revertedWith(
        'MAX_BUFFER_PERIOD_DURATION'
      );
    });
  });

  describe('set emergency period', () => {
    const EMERGENCY_RESPONSE_WINDOW = MONTH * 3;
    const EMERGENCY_BUFFER_PERIOD = MONTH;

    sharedBeforeEach('deploy emergency period', async () => {
      await deployEmergencyPeriod({
        emergencyResponseWindow: EMERGENCY_RESPONSE_WINDOW,
        emergencyBufferPeriod: EMERGENCY_BUFFER_PERIOD,
      });
    });

    context('before the emergency period end date', () => {
      sharedBeforeEach('advance some time', async () => {
        await advanceTime(EMERGENCY_RESPONSE_WINDOW / 2);
      });

      it('can change the emergency period status', async () => {
        const { endDate: previousEndDate } = await emergency.getPausedState();

        await emergency.setPaused(true);

        await assertEmergencyPeriod(true, previousEndDate, EMERGENCY_BUFFER_PERIOD);
      });

      it('can change the emergency period status multiple times', async () => {
        const { endDate: previousEndDate } = await emergency.getPausedState();

        await emergency.setPaused(true);
        await assertEmergencyPeriod(true, previousEndDate, EMERGENCY_BUFFER_PERIOD);

        await advanceTime(EMERGENCY_RESPONSE_WINDOW / 4);

        await emergency.setPaused(false);
        await assertEmergencyPeriod(false, previousEndDate, EMERGENCY_BUFFER_PERIOD);
      });
    });

    context('when the emergency period end date has been reached', () => {
      context('when the emergency period was off', () => {
        sharedBeforeEach('advance time', async () => {
          await advanceTime(EMERGENCY_RESPONSE_WINDOW);
        });

        function itCannotChangeTheEmergencyPeriod() {
          it('considers the emergency period off', async () => {
            await assertEmergencyPeriod(false);
          });

          it('cannot change the emergency period', async () => {
            await expect(emergency.setPaused(true)).to.be.revertedWith('EMERGENCY_WINDOW_EXPIRED');
          });
        }

        context('before the check extension', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(EMERGENCY_BUFFER_PERIOD / 2);
          });

          itCannotChangeTheEmergencyPeriod();
        });

        context('after the check extension', () => {
          sharedBeforeEach('reach the check extension', async () => {
            await advanceTime(EMERGENCY_BUFFER_PERIOD);
          });

          itCannotChangeTheEmergencyPeriod();
        });
      });

      context('when the emergency period was on', () => {
        sharedBeforeEach('turn on and advance time', async () => {
          await emergency.setPaused(true);
          await advanceTime(EMERGENCY_RESPONSE_WINDOW);
        });

        context('before the check extension', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(EMERGENCY_BUFFER_PERIOD / 2);
          });

          it('considers the emergency period on', async () => {
            await assertEmergencyPeriod(true);
          });

          it('can be turned off', async () => {
            await emergency.setPaused(false);
            await assertEmergencyPeriod(false);
          });
        });

        context('after the check extension', () => {
          sharedBeforeEach('reach the check extension', async () => {
            await advanceTime(EMERGENCY_BUFFER_PERIOD);
          });

          it('considers the emergency period off', async () => {
            await assertEmergencyPeriod(false);
          });

          it('cannot be turned off', async () => {
            await expect(emergency.setPaused(false)).to.be.revertedWith('BUFFER_PERIOD_EXPIRED');
          });
        });
      });
    });
  });
});
