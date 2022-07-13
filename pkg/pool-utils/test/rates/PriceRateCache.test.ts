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
      await cache.encode(rate, duration);
      now = await currentTimestamp();
      expectedExpiration = now.add(duration);
    });

    it('encodes the rate', async () => {
      expect(await cache.getRate()).to.equal(rate);
    });

    it('encodes the duration', async () => {
      expect(await cache.getDuration()).to.equal(duration);
    });

    it('encodes the timestamps', async () => {
      const { duration: durationResult, expires } = await cache.getTimestamps();
      expect(durationResult).to.equal(duration);
      expect(expires).to.equal(expectedExpiration);
    });

    it('decodes the encoding', async () => {
      const { rate: rateResult, duration: durationResult, expires } = await cache.decode();

      expect(rateResult).to.equal(rate);
      expect(durationResult).to.equal(duration);
      expect(expires).to.equal(expectedExpiration);
    });

    it('encodes/decodes the postJoin rate', async () => {
      const postJoinRate = pct(rate, 0.46);

      await cache.setPostJoinExitRate(postJoinRate);

      const rateResult = await cache.getPostJoinExitRate();
      expect(rateResult).to.equal(postJoinRate);
      expect(rateResult).to.not.equal(rate);
    });
  });

  context('invalid arguments', () => {
    const badDuration = 2 ** 32;
    const badRate: BigNumber = bn(2 ** 96);

    it('fails with a bad duration', async () => {
      await expect(cache.encode(rate, badDuration)).to.be.revertedWith('CODEC_OVERFLOW');
    });

    it('fails with a bad rate', async () => {
      await expect(cache.encode(badRate, duration)).to.be.revertedWith('PRICE_RATE_OVERFLOW');
    });

    it('fails with a bad postJoin rate', async () => {
      await expect(cache.setPostJoinExitRate(badRate)).to.be.revertedWith('PRICE_RATE_OVERFLOW');
    });
  });
});
