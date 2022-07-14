import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { bn, fp, pct } from '@balancer-labs/v2-helpers/src/numbers';
import { currentTimestamp, WEEK, MONTH } from '@balancer-labs/v2-helpers/src/time';

describe('PriceRateCache', () => {
  const rate = pct(fp(1), Math.random());
  const duration = WEEK;

  let cache: Contract;

  sharedBeforeEach('deploy token', async () => {
    cache = await deploy('MockPriceRateCache');
  });

  context('valid arguments', () => {
    let expectedExpiration: BigNumber;
    let now: BigNumber;

    sharedBeforeEach('encode values', async () => {
      await cache.updateRateAndDuration(rate, duration);
      now = await currentTimestamp();
      expectedExpiration = now.add(duration);
    });

    it('encodes the rate', async () => {
      expect(await cache.getCurrentRate()).to.equal(rate);
    });

    it('initializes the old rate to zero', async () => {
      expect(await cache.getOldRate()).to.equal(0);
    });

    it('encodes the duration', async () => {
      expect(await cache.getDuration()).to.equal(duration);
    });

    it('encodes the timestamps', async () => {
      const { duration: durationResult, expires } = await cache.getTimestamps();
      expect(durationResult).to.equal(duration);
      expect(expires).to.equal(expectedExpiration);
    });

    it('decodes the cached data', async () => {
      const { rate: rateResult, duration: durationResult, expires } = await cache.decode();

      expect(rateResult).to.equal(rate);
      expect(durationResult).to.equal(duration);
      expect(expires).to.equal(expectedExpiration);
    });

    it('updates the old rate', async () => {
      await cache.updateOldRate();

      const rateResult = await cache.getOldRate();
      expect(rateResult).to.equal(rate);
      expect(rateResult).to.not.equal(0);
    });

    it('updates the current rate', async () => {
      const newRate = fp(4.5);

      await cache.updateCurrentRate(newRate);

      const rateResult = await cache.getCurrentRate();
      expect(rateResult).to.equal(newRate);
    });

    it('updates the duration', async () => {
      const newDuration = MONTH;

      await cache.updateDuration(newDuration);
      const currentTime = await currentTimestamp();
      const expectedNewExpiration = currentTime.add(newDuration);

      const { duration: durationResult, expires } = await cache.getTimestamps();
      expect(durationResult).to.equal(newDuration);
      expect(expires).to.equal(expectedNewExpiration);
    });
  });

  context('invalid arguments', () => {
    const badDuration = 2 ** 32;
    const badRate: BigNumber = bn(2 ** 96);

    it('updateRateAndDuration fails with a bad duration', async () => {
      await expect(cache.updateRateAndDuration(rate, badDuration)).to.be.revertedWith('CODEC_OVERFLOW');
    });

    it('updateRateAndDuration fails with a bad rate', async () => {
      await expect(cache.updateRateAndDuration(badRate, duration)).to.be.revertedWith('PRICE_RATE_OVERFLOW');
    });

    it('updateCurrentRate fails with a bad rate', async () => {
      await expect(cache.updateCurrentRate(badRate)).to.be.revertedWith('PRICE_RATE_OVERFLOW');
    });

    it('updateDuration fails with a bad duration', async () => {
      await expect(cache.updateDuration(badDuration)).to.be.revertedWith('CODEC_OVERFLOW');
    });
  });
});
