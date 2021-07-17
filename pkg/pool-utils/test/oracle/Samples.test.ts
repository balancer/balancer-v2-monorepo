import { expect } from 'chai';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT31, MIN_INT22, MAX_INT22, MIN_INT53, MAX_INT53 } from '@balancer-labs/v2-helpers/src/constants';

describe('Samples', () => {
  let samples: Contract;

  sharedBeforeEach('deploy samples', async () => {
    samples = await deploy('MockSamples');
  });

  describe('encoding', () => {
    const assertEncoding = async (
      logPairPrice: BigNumberish,
      accLogPairPrice: BigNumberish,
      logBptPrice: BigNumberish,
      accLogBptPrice: BigNumberish,
      logInvariant: BigNumberish,
      accLogInvariant: BigNumberish,
      timestamp: BigNumberish
    ) => {
      const encodedSample = await samples.encode({
        logPairPrice,
        accLogPairPrice,
        logBptPrice,
        accLogBptPrice,
        logInvariant,
        accLogInvariant,
        timestamp,
      });

      const sample = await samples.decode(encodedSample);
      expect(sample.logPairPrice).to.be.equal(logPairPrice);
      expect(sample.accLogPairPrice).to.be.equal(accLogPairPrice);
      expect(sample.logBptPrice).to.be.equal(logBptPrice);
      expect(sample.accLogBptPrice).to.be.equal(accLogBptPrice);
      expect(sample.logInvariant).to.be.equal(logInvariant);
      expect(sample.accLogInvariant).to.be.equal(accLogInvariant);
      expect(sample.timestamp).to.be.equal(timestamp);
    };

    it('encodes samples correctly', async () => {
      await assertEncoding(1, 10, 2, 20, 3, 30, 400);
      await assertEncoding(-1, 10, -2, 20, -3, 30, 400);
      await assertEncoding(-1, -10, -2, -20, -3, -30, 400);
      await assertEncoding(MIN_INT22, 0, 0, 0, 0, 0, 100);
      await assertEncoding(MAX_INT22, 0, 0, 0, 0, 0, 100);
      await assertEncoding(0, MIN_INT53, 0, 0, 0, 0, 100);
      await assertEncoding(0, MAX_INT53, 0, 0, 0, 0, 100);
      await assertEncoding(0, 0, MIN_INT22, 0, 0, 0, 100);
      await assertEncoding(0, 0, MAX_INT22, 0, 0, 0, 100);
      await assertEncoding(0, 0, 0, MIN_INT53, 0, 0, 100);
      await assertEncoding(0, 0, 0, MAX_INT53, 0, 0, 100);
      await assertEncoding(0, 0, 0, 0, 0, MIN_INT53, 100);
      await assertEncoding(0, 0, 0, 0, 0, MAX_INT53, 100);
      await assertEncoding(0, 0, 0, 0, 0, 0, MAX_UINT31);
      await assertEncoding(MIN_INT22, MIN_INT53, MIN_INT22, MIN_INT53, MIN_INT22, MIN_INT53, MAX_UINT31);
      await assertEncoding(MAX_INT22, MAX_INT53, MAX_INT22, MAX_INT53, MAX_INT22, MAX_INT53, MAX_UINT31);
      await assertEncoding(
        MIN_INT22.div(2),
        MIN_INT53.div(2),
        MIN_INT22.div(2),
        MIN_INT53.div(2),
        MIN_INT22.div(2),
        MIN_INT53.div(2),
        MAX_UINT31.div(2)
      );
      await assertEncoding(
        MAX_INT22.div(2),
        MAX_INT53.div(2),
        MAX_INT22.div(2),
        MAX_INT53.div(2),
        MAX_INT22.div(2),
        MAX_INT53.div(2),
        MAX_UINT31.div(2)
      );
    });
  });

  describe('update', () => {
    const assertUpdate = async (
      sample: string,
      logPairPrice: BigNumberish,
      logBptPrice: BigNumberish,
      logInv: BigNumberish,
      elapsed: BigNumberish
    ) => {
      const prevSample = await samples.decode(sample);
      const timestamp = prevSample.timestamp.add(elapsed);

      const newSample = await samples.update(sample, logPairPrice, logBptPrice, logInv, timestamp);

      expect(newSample.logPairPrice).to.be.equal(logPairPrice);
      expect(newSample.accLogPairPrice).to.be.equal(prevSample.accLogPairPrice.add(bn(logPairPrice).mul(elapsed)));
      expect(newSample.logBptPrice).to.be.equal(logBptPrice);
      expect(newSample.accLogBptPrice).to.be.equal(prevSample.accLogBptPrice.add(bn(logBptPrice).mul(elapsed)));
      expect(newSample.logInvariant).to.be.equal(logInv);
      expect(newSample.accLogInvariant).to.be.equal(prevSample.accLogInvariant.add(bn(logInv).mul(elapsed)));
      expect(newSample.timestamp).to.be.equal(timestamp);
    };

    it('updates the sample correctly', async () => {
      const sample = await samples.encode({
        logPairPrice: 1,
        accLogPairPrice: 10,
        logBptPrice: 2,
        accLogBptPrice: 20,
        logInvariant: 3,
        accLogInvariant: 30,
        timestamp: 400,
      });

      await assertUpdate(sample, 100, 0, 0, 0);
      await assertUpdate(sample, 0, 100, 0, 0);
      await assertUpdate(sample, 0, 0, 100, 0);
      await assertUpdate(sample, 0, 0, 0, 100);
      await assertUpdate(sample, 100, 200, 300, 400);
      await assertUpdate(sample, MIN_INT22.div(2), MIN_INT22.div(2), MIN_INT22.div(2), MAX_UINT31.div(2));
      await assertUpdate(sample, MAX_INT22.div(2), MAX_INT22.div(2), MAX_INT22.div(2), MAX_UINT31.div(2));
    });
  });
});
