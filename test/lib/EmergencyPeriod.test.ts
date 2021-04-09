import { expect } from 'chai';
import { Contract } from 'ethers';

import { deploy } from '../../lib/helpers/deploy';
import { BigNumberish } from '../../lib/helpers/numbers';
import { advanceTime, currentTimestamp, fromNow, DAY, MONTH } from '../../lib/helpers/time';

describe('EmergencyPeriod', function () {
  let emergency: Contract;

  const deployEmergencyPeriod = async ({ emergencyPeriod = 0, emergencyPeriodCheckExtension = 0 }) => {
    emergency = await deploy('EmergencyPeriodMock', { args: [emergencyPeriod, emergencyPeriodCheckExtension] });
  };

  const assertEmergencyPeriod = async (
    expectedStatus: boolean,
    expectedEndDate?: BigNumberish,
    expectedCheckExtension?: BigNumberish
  ): Promise<void> => {
    const { active, endDate, checkEndDate } = await emergency.getEmergencyPeriod();

    expect(active).to.equal(expectedStatus);
    if (expectedEndDate) expect(endDate).to.equal(expectedEndDate);
    if (expectedCheckExtension) expect(checkEndDate).to.equal(endDate.add(expectedCheckExtension));
  };

  describe('initialization', () => {
    it('can be initialized with an emergency period', async () => {
      const emergencyPeriod = MONTH;
      const emergencyPeriodCheckExtension = MONTH;

      await deployEmergencyPeriod({ emergencyPeriod, emergencyPeriodCheckExtension });

      await assertEmergencyPeriod(false, await fromNow(emergencyPeriod), emergencyPeriodCheckExtension);
    });

    it('can be initialized without emergency period', async () => {
      const emergencyPeriod = 0;
      const emergencyPeriodCheckExtension = 0;

      await deployEmergencyPeriod({ emergencyPeriod, emergencyPeriodCheckExtension });

      await assertEmergencyPeriod(false, await currentTimestamp(), emergencyPeriodCheckExtension);
    });

    it('cannot be initialized with an emergency period greater than 90 days', async () => {
      const emergencyPeriod = DAY * 91;

      await expect(deployEmergencyPeriod({ emergencyPeriod })).to.be.revertedWith('MAX_EMERGENCY_PERIOD');
    });

    it('cannot be initialized with an emergency period check extension greater than 30 days', async () => {
      const emergencyPeriod = MONTH;
      const emergencyPeriodCheckExtension = DAY * 31;

      await expect(deployEmergencyPeriod({ emergencyPeriod, emergencyPeriodCheckExtension })).to.be.revertedWith(
        'MAX_EMERGENCY_PERIOD_CHECK_EXT'
      );
    });
  });

  describe('set emergency period', () => {
    const EMERGENCY_PERIOD = MONTH * 3;
    const EMERGENCY_PERIOD_CHECK_EXTENSION = MONTH;

    sharedBeforeEach('deploy emergency period', async () => {
      await deployEmergencyPeriod({
        emergencyPeriod: EMERGENCY_PERIOD,
        emergencyPeriodCheckExtension: EMERGENCY_PERIOD_CHECK_EXTENSION,
      });
    });

    context('before the emergency period end date', () => {
      sharedBeforeEach('advance some time', async () => {
        await advanceTime(EMERGENCY_PERIOD / 2);
      });

      it('can change the emergency period status', async () => {
        const { endDate: previousEndDate } = await emergency.getEmergencyPeriod();

        await emergency.setEmergencyPeriod(true);

        await assertEmergencyPeriod(true, previousEndDate, EMERGENCY_PERIOD_CHECK_EXTENSION);
      });

      it('can change the emergency period status multiple times', async () => {
        const { endDate: previousEndDate } = await emergency.getEmergencyPeriod();

        await emergency.setEmergencyPeriod(true);
        await assertEmergencyPeriod(true, previousEndDate, EMERGENCY_PERIOD_CHECK_EXTENSION);

        await advanceTime(EMERGENCY_PERIOD / 4);

        await emergency.setEmergencyPeriod(false);
        await assertEmergencyPeriod(false, previousEndDate, EMERGENCY_PERIOD_CHECK_EXTENSION);
      });
    });

    context('when the emergency period end date has been reached', () => {
      context('when the emergency period was off', () => {
        sharedBeforeEach('advance time', async () => {
          await advanceTime(EMERGENCY_PERIOD);
        });

        function itCannotChangeTheEmergencyPeriod() {
          it('considers the emergency period off', async () => {
            await assertEmergencyPeriod(false);
          });

          it('cannot change the emergency period', async () => {
            await expect(emergency.setEmergencyPeriod(true)).to.be.revertedWith('EMERGENCY_PERIOD_FINISHED');
          });
        }

        context('before the check extension', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(EMERGENCY_PERIOD_CHECK_EXTENSION / 2);
          });

          itCannotChangeTheEmergencyPeriod();
        });

        context('after the check extension', () => {
          sharedBeforeEach('reach the check extension', async () => {
            await advanceTime(EMERGENCY_PERIOD_CHECK_EXTENSION);
          });

          itCannotChangeTheEmergencyPeriod();
        });
      });

      context('when the emergency period was on', () => {
        sharedBeforeEach('turn on and advance time', async () => {
          await emergency.setEmergencyPeriod(true);
          await advanceTime(EMERGENCY_PERIOD);
        });

        context('before the check extension', () => {
          sharedBeforeEach('advance some time', async () => {
            await advanceTime(EMERGENCY_PERIOD_CHECK_EXTENSION / 2);
          });

          it('considers the emergency period on', async () => {
            await assertEmergencyPeriod(true);
          });

          it('can be turned off', async () => {
            await emergency.setEmergencyPeriod(false);
            await assertEmergencyPeriod(false);
          });
        });

        context('after the check extension', () => {
          sharedBeforeEach('reach the check extension', async () => {
            await advanceTime(EMERGENCY_PERIOD_CHECK_EXTENSION);
          });

          it('considers the emergency period off', async () => {
            await assertEmergencyPeriod(false);
          });

          it('cannot be turned off', async () => {
            await expect(emergency.setEmergencyPeriod(false)).to.be.revertedWith('EMERGENCY_PERIOD_FINISHED');
          });
        });
      });
    });
  });
});
