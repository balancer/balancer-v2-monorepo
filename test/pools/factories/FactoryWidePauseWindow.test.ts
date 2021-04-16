import { BigNumber, Contract } from 'ethers';
import { deploy } from '../../../lib/helpers/deploy';
import { expect } from 'chai';
import { advanceTime, currentTimestamp, DAY } from '../../../lib/helpers/time';
import { bn } from '../../../lib/helpers/numbers';

describe('FactoryWidePauseWindow', function () {
  let factory: Contract;
  let factoryDeployTime: BigNumber;

  const PAUSE_WINDOW_DURATION = DAY * 90;
  const BUFFER_PERIOD_DURATION = DAY * 30;

  sharedBeforeEach(async () => {
    factory = await deploy('MockFactoryWidePauseWindow', { args: [] });
    factoryDeployTime = await currentTimestamp();
  });

  context('before the pause window end time', () => {
    itReturnsANonZeroWindow();

    context('after some time has passed', () => {
      sharedBeforeEach(async () => {
        await advanceTime(DAY * 50);
      });

      itReturnsANonZeroWindow();
    });
  });

  context('at the pause window end time', () => {
    sharedBeforeEach(async () => {
      await advanceTime(PAUSE_WINDOW_DURATION);
    });

    itReturnsAZeroWindow();
  });

  context('after the pause window end time', () => {
    sharedBeforeEach(async () => {
      await advanceTime(PAUSE_WINDOW_DURATION * 2);
    });

    itReturnsAZeroWindow();
  });

  function itReturnsANonZeroWindow() {
    it('returns the current pause window duration', async () => {
      const now = await currentTimestamp();
      const expectedDuration = bn(PAUSE_WINDOW_DURATION).sub(now.sub(factoryDeployTime));

      const { pauseWindowDuration } = await factory.getCurrentPauseConfiguration();
      expect(pauseWindowDuration).to.equal(expectedDuration);
    });

    it('returns the full buffer period duration', async () => {
      const { bufferPeriodDuration } = await factory.getCurrentPauseConfiguration();
      expect(bufferPeriodDuration).to.equal(BUFFER_PERIOD_DURATION);
    });
  }

  function itReturnsAZeroWindow() {
    it('returns a zero pause window duration', async () => {
      const { pauseWindowDuration } = await factory.getCurrentPauseConfiguration();
      expect(pauseWindowDuration).to.equal(0);
    });

    it('returns a zero buffer period duration', async () => {
      const { bufferPeriodDuration } = await factory.getCurrentPauseConfiguration();
      expect(bufferPeriodDuration).to.equal(0);
    });
  }
});
