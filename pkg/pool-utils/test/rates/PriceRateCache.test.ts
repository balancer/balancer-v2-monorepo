import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { bn, fp, pct } from '@balancer-labs/v2-helpers/src/numbers';
import { currentTimestamp, WEEK } from '@balancer-labs/v2-helpers/src/time';

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
      await cache.updateRate(rate, duration);
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
  });

  context('invalid arguments', () => {
    const badDuration = 2 ** 32;
    const badRate: BigNumber = bn(2 ** 96);

    it('fails with a bad duration', async () => {
      await expect(cache.updateRate(rate, badDuration)).to.be.revertedWith('CODEC_OVERFLOW');
    });

    it('fails with a bad rate', async () => {
      await expect(cache.updateRate(badRate, duration)).to.be.revertedWith('PRICE_RATE_OVERFLOW');
    });
  });
});
