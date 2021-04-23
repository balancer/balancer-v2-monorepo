import { expect } from 'chai';
import { Contract } from 'ethers';

import * as expectEvent from '../helpers/expectEvent';
import { deploy } from '../../lib/helpers/deploy';
import { BigNumberish, bn } from '../../lib/helpers/numbers';
import { advanceTime, currentTimestamp, MINUTE } from '../../lib/helpers/time';
import { MAX_UINT32, MIN_INT20, MAX_INT20, MIN_INT54, MAX_INT54 } from '../../lib/helpers/constants';

describe('PoolPriceOracle', () => {
  let oracle: Contract;

  const MAX_BUFFER_SIZE = 1024;

  sharedBeforeEach('deploy oracle', async () => {
    oracle = await deploy('PoolPriceOracleMock');
  });

  describe('packing', () => {
    const assertPacking = async (
      lastLogPairPrice: BigNumberish,
      accLogPairPrice: BigNumberish,
      lastLogBptPrice: BigNumberish,
      accLogBptPrice: BigNumberish,
      lastLogInvariant: BigNumberish,
      accLogInvariant: BigNumberish,
      timestamp: BigNumberish
    ) => {
      const packedSample = await oracle.pack({
        lastLogPairPrice,
        accLogPairPrice,
        lastLogBptPrice,
        accLogBptPrice,
        lastLogInvariant,
        accLogInvariant,
        timestamp,
      });

      const sample = await oracle.unpack(packedSample);
      expect(sample.lastLogPairPrice).to.be.equal(lastLogPairPrice);
      expect(sample.accLogPairPrice).to.be.equal(accLogPairPrice);
      expect(sample.lastLogBptPrice).to.be.equal(lastLogBptPrice);
      expect(sample.accLogBptPrice).to.be.equal(accLogBptPrice);
      expect(sample.lastLogInvariant).to.be.equal(lastLogInvariant);
      expect(sample.accLogInvariant).to.be.equal(accLogInvariant);
      expect(sample.timestamp).to.be.equal(timestamp);
    };

    it('packs samples correctly', async () => {
      await assertPacking(1, 10, 2, 20, 3, 30, 400);
      await assertPacking(-1, 10, -2, 20, -3, 30, 400);
      await assertPacking(-1, -10, -2, -20, -3, -30, 400);
      await assertPacking(MIN_INT20, 0, 0, 0, 0, 0, 100);
      await assertPacking(MAX_INT20, 0, 0, 0, 0, 0, 100);
      await assertPacking(0, MIN_INT54, 0, 0, 0, 0, 100);
      await assertPacking(0, MAX_INT54, 0, 0, 0, 0, 100);
      await assertPacking(0, 0, MIN_INT20, 0, 0, 0, 100);
      await assertPacking(0, 0, MAX_INT20, 0, 0, 0, 100);
      await assertPacking(0, 0, 0, MIN_INT54, 0, 0, 100);
      await assertPacking(0, 0, 0, MAX_INT54, 0, 0, 100);
      await assertPacking(0, 0, 0, 0, 0, MIN_INT54, 100);
      await assertPacking(0, 0, 0, 0, 0, MAX_INT54, 100);
      await assertPacking(0, 0, 0, 0, 0, 0, MAX_UINT32);
      await assertPacking(MIN_INT20, MIN_INT54, MIN_INT20, MIN_INT54, MIN_INT20, MIN_INT54, MAX_UINT32);
      await assertPacking(MAX_INT20, MAX_INT54, MAX_INT20, MAX_INT54, MAX_INT20, MAX_INT54, MAX_UINT32);
      await assertPacking(
        MIN_INT20.div(2),
        MIN_INT54.div(2),
        MIN_INT20.div(2),
        MIN_INT54.div(2),
        MIN_INT20.div(2),
        MIN_INT54.div(2),
        MAX_UINT32.div(2)
      );
      await assertPacking(
        MAX_INT20.div(2),
        MAX_INT54.div(2),
        MAX_INT20.div(2),
        MAX_INT54.div(2),
        MAX_INT20.div(2),
        MAX_INT54.div(2),
        MAX_UINT32.div(2)
      );
    });
  });

  describe('update', () => {
    const assertUpdate = async (
      sample: string,
      lastLogPairPrice: BigNumberish,
      lastLogBptPrice: BigNumberish,
      lastLogInv: BigNumberish,
      elapsed: BigNumberish
    ) => {
      const prevSample = await oracle.unpack(sample);
      const timestamp = prevSample.timestamp.add(elapsed);

      const newSample = await oracle.update(sample, lastLogPairPrice, lastLogBptPrice, lastLogInv, timestamp);

      expect(newSample.lastLogPairPrice).to.be.equal(lastLogPairPrice);
      expect(newSample.accLogPairPrice).to.be.equal(prevSample.accLogPairPrice.add(bn(lastLogPairPrice).mul(elapsed)));
      expect(newSample.lastLogBptPrice).to.be.equal(lastLogBptPrice);
      expect(newSample.accLogBptPrice).to.be.equal(prevSample.accLogBptPrice.add(bn(lastLogBptPrice).mul(elapsed)));
      expect(newSample.lastLogInvariant).to.be.equal(lastLogInv);
      expect(newSample.accLogInvariant).to.be.equal(prevSample.accLogInvariant.add(bn(lastLogInv).mul(elapsed)));
      expect(newSample.timestamp).to.be.equal(timestamp);
    };

    it('updates the sample correctly', async () => {
      const sample = await oracle.pack({
        lastLogPairPrice: 1,
        accLogPairPrice: 10,
        lastLogBptPrice: 2,
        accLogBptPrice: 20,
        lastLogInvariant: 3,
        accLogInvariant: 30,
        timestamp: 400,
      });

      await assertUpdate(sample, 100, 0, 0, 0);
      await assertUpdate(sample, 0, 100, 0, 0);
      await assertUpdate(sample, 0, 0, 100, 0);
      await assertUpdate(sample, 0, 0, 0, 100);
      await assertUpdate(sample, 100, 200, 300, 400);
      await assertUpdate(sample, MIN_INT20.div(2), MIN_INT20.div(2), MIN_INT20.div(2), MAX_UINT32.div(2));
      await assertUpdate(sample, MAX_INT20.div(2), MAX_INT20.div(2), MAX_INT20.div(2), MAX_UINT32.div(2));
    });
  });

  describe('process', () => {
    const newLogPairPrice = 100;
    const newLogBptPrice = 200;
    const newLogInvariant = 300;

    const itUpdatesTheExistingSample = (index: number, elapsed: number, newSample = false) => {
      it('updates the existing sample', async () => {
        const previousSample = await oracle.getSample(index);

        if (elapsed > 0) await advanceTime(elapsed);
        const tx = await oracle.processPriceData(elapsed, index, newLogPairPrice, newLogBptPrice, newLogInvariant);

        const expectedIndex = newSample ? (index + 1) % MAX_BUFFER_SIZE : index;
        expectEvent.inReceipt(await tx.wait(), 'PriceDataProcessed', { newSample, sampleIndex: expectedIndex });

        const updatedSample = await oracle.getSample(expectedIndex);
        expect(updatedSample.timestamp).to.be.equal(await currentTimestamp());
        const actualElapsed = updatedSample.timestamp.sub(previousSample.timestamp);

        const expectedAccLogPairPrice = previousSample.accLogPairPrice.add(bn(newLogPairPrice).mul(actualElapsed));
        expect(updatedSample.lastLogPairPrice).to.be.equal(newLogPairPrice);
        expect(updatedSample.accLogPairPrice).to.be.equal(expectedAccLogPairPrice);

        const expectedAccLogBptPrice = previousSample.accLogBptPrice.add(bn(newLogBptPrice).mul(actualElapsed));
        expect(updatedSample.lastLogBptPrice).to.be.equal(newLogBptPrice);
        expect(updatedSample.accLogBptPrice).to.be.equal(expectedAccLogBptPrice);

        const expectedAccLogInvariant = previousSample.accLogInvariant.add(bn(newLogInvariant).mul(actualElapsed));
        expect(updatedSample.lastLogInvariant).to.be.equal(newLogInvariant);
        expect(updatedSample.accLogInvariant).to.be.equal(expectedAccLogInvariant);
      });
    };

    const itCreatesAnotherSample = (index: number, elapsed: number) => {
      it('does not update the previous sample', async () => {
        const previousSample = await oracle.getSample(index);

        if (elapsed > 0) await advanceTime(elapsed);
        await oracle.processPriceData(elapsed, index, newLogPairPrice, newLogBptPrice, newLogInvariant);

        const sameSample = await oracle.getSample(index);
        expect(sameSample.lastLogPairPrice).to.be.equal(previousSample.lastLogPairPrice);
        expect(sameSample.accLogPairPrice).to.be.equal(previousSample.accLogPairPrice);
        expect(sameSample.lastLogBptPrice).to.be.equal(previousSample.lastLogBptPrice);
        expect(sameSample.accLogBptPrice).to.be.equal(previousSample.accLogBptPrice);
        expect(sameSample.lastLogInvariant).to.be.equal(previousSample.lastLogInvariant);
        expect(sameSample.accLogInvariant).to.be.equal(previousSample.accLogInvariant);
        expect(sameSample.timestamp).to.be.equal(previousSample.timestamp);
      });

      it('creates another sample', async () => {
        const previousSample = await oracle.getSample(index);

        if (elapsed > 0) await advanceTime(elapsed);
        const tx = await oracle.processPriceData(elapsed, index, newLogPairPrice, newLogBptPrice, newLogInvariant);
        expectEvent.inReceipt(await tx.wait(), 'PriceDataProcessed', { newSample: true, sampleIndex: index + 1 });

        const newSample = await oracle.getSample(index + 1);
        expect(newSample.timestamp).to.be.equal(await currentTimestamp());
        const actualElapsed = newSample.timestamp.sub(previousSample.timestamp);

        expect(newSample.lastLogPairPrice).to.be.equal(newLogPairPrice);
        const expectedAccLogPairPrice = previousSample.accLogPairPrice.add(bn(newLogPairPrice).mul(actualElapsed));
        expect(newSample.accLogPairPrice).to.be.equal(expectedAccLogPairPrice);

        expect(newSample.lastLogBptPrice).to.be.equal(newLogBptPrice);
        const expectedAccLogBptPrice = previousSample.accLogBptPrice.add(bn(newLogBptPrice).mul(actualElapsed));
        expect(newSample.accLogBptPrice).to.be.equal(expectedAccLogBptPrice);

        expect(newSample.lastLogInvariant).to.be.equal(newLogInvariant);
        const expectedAccLogInvariant = previousSample.accLogInvariant.add(bn(newLogInvariant).mul(actualElapsed));
        expect(newSample.accLogInvariant).to.be.equal(expectedAccLogInvariant);
      });
    };

    context('when there was no sample in the given index', () => {
      const index = 0;
      // Some elapsed time must exist the first time the oracle is updated
      itCreatesAnotherSample(index, MINUTE * 60);
    });

    context('when there was a sample in the given index', () => {
      context('when the next sample does not complete the buffer', () => {
        const index = 506;

        sharedBeforeEach('create a sample', async () => {
          await oracle.mockSample(index, {
            lastLogPairPrice: 1,
            accLogPairPrice: 10,
            lastLogBptPrice: 2,
            accLogBptPrice: 20,
            lastLogInvariant: 3,
            accLogInvariant: 30,
            timestamp: await currentTimestamp(),
          });
        });

        context('when the current timestamp is the same as the initial timestamp of the current sample', () => {
          itUpdatesTheExistingSample(index, 0);
        });

        context('when the current timestamp is greater than the initial timestamp by less than 2 minutes', () => {
          itUpdatesTheExistingSample(index, MINUTE);
        });

        context('when the current timestamp is greater than the initial timestamp by more than 2 minutes', () => {
          itCreatesAnotherSample(index, MINUTE * 3);
        });
      });

      context('when the next sample does not complete the buffer', () => {
        const index = MAX_BUFFER_SIZE - 1;

        sharedBeforeEach('create a sample', async () => {
          await oracle.mockSample(index, {
            lastLogPairPrice: 1,
            accLogPairPrice: 10,
            lastLogBptPrice: 2,
            accLogBptPrice: 20,
            lastLogInvariant: 3,
            accLogInvariant: 30,
            timestamp: await currentTimestamp(),
          });
        });

        context('when the current timestamp is greater than the initial timestamp by less than 2 minutes', () => {
          itUpdatesTheExistingSample(index, MINUTE);
        });

        context('when the current timestamp is greater than the initial timestamp by 2048 minutes', () => {
          itUpdatesTheExistingSample(index, MINUTE * 3, true);
        });
      });
    });
  });
});
