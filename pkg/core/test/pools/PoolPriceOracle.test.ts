import { expect } from 'chai';
import { Contract } from 'ethers';

import * as expectEvent from '../helpers/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/deploy';
import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime, currentTimestamp, MINUTE } from '@balancer-labs/v2-helpers/src/time';
import { MAX_UINT31, MIN_INT22, MAX_INT22, MIN_INT53, MAX_INT53 } from '@balancer-labs/v2-helpers/src/constants';

describe('PoolPriceOracle', () => {
  let oracle: Contract;

  const MAX_BUFFER_SIZE = 1024;

  sharedBeforeEach('deploy oracle', async () => {
    oracle = await deploy('PoolPriceOracleMock');
  });

  describe('packing', () => {
    const assertPacking = async (
      logPairPrice: BigNumberish,
      accLogPairPrice: BigNumberish,
      logBptPrice: BigNumberish,
      accLogBptPrice: BigNumberish,
      logInvariant: BigNumberish,
      accLogInvariant: BigNumberish,
      timestamp: BigNumberish
    ) => {
      const packedSample = await oracle.encode({
        logPairPrice,
        accLogPairPrice,
        logBptPrice,
        accLogBptPrice,
        logInvariant,
        accLogInvariant,
        timestamp,
      });

      const sample = await oracle.decode(packedSample);
      expect(sample.logPairPrice).to.be.equal(logPairPrice);
      expect(sample.accLogPairPrice).to.be.equal(accLogPairPrice);
      expect(sample.logBptPrice).to.be.equal(logBptPrice);
      expect(sample.accLogBptPrice).to.be.equal(accLogBptPrice);
      expect(sample.logInvariant).to.be.equal(logInvariant);
      expect(sample.accLogInvariant).to.be.equal(accLogInvariant);
      expect(sample.timestamp).to.be.equal(timestamp);
    };

    it('packs samples correctly', async () => {
      await assertPacking(1, 10, 2, 20, 3, 30, 400);
      await assertPacking(-1, 10, -2, 20, -3, 30, 400);
      await assertPacking(-1, -10, -2, -20, -3, -30, 400);
      await assertPacking(MIN_INT22, 0, 0, 0, 0, 0, 100);
      await assertPacking(MAX_INT22, 0, 0, 0, 0, 0, 100);
      await assertPacking(0, MIN_INT53, 0, 0, 0, 0, 100);
      await assertPacking(0, MAX_INT53, 0, 0, 0, 0, 100);
      await assertPacking(0, 0, MIN_INT22, 0, 0, 0, 100);
      await assertPacking(0, 0, MAX_INT22, 0, 0, 0, 100);
      await assertPacking(0, 0, 0, MIN_INT53, 0, 0, 100);
      await assertPacking(0, 0, 0, MAX_INT53, 0, 0, 100);
      await assertPacking(0, 0, 0, 0, 0, MIN_INT53, 100);
      await assertPacking(0, 0, 0, 0, 0, MAX_INT53, 100);
      await assertPacking(0, 0, 0, 0, 0, 0, MAX_UINT31);
      await assertPacking(MIN_INT22, MIN_INT53, MIN_INT22, MIN_INT53, MIN_INT22, MIN_INT53, MAX_UINT31);
      await assertPacking(MAX_INT22, MAX_INT53, MAX_INT22, MAX_INT53, MAX_INT22, MAX_INT53, MAX_UINT31);
      await assertPacking(
        MIN_INT22.div(2),
        MIN_INT53.div(2),
        MIN_INT22.div(2),
        MIN_INT53.div(2),
        MIN_INT22.div(2),
        MIN_INT53.div(2),
        MAX_UINT31.div(2)
      );
      await assertPacking(
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
      const prevSample = await oracle.decode(sample);
      const timestamp = prevSample.timestamp.add(elapsed);

      const newSample = await oracle.update(sample, logPairPrice, logBptPrice, logInv, timestamp);

      expect(newSample.logPairPrice).to.be.equal(logPairPrice);
      expect(newSample.accLogPairPrice).to.be.equal(prevSample.accLogPairPrice.add(bn(logPairPrice).mul(elapsed)));
      expect(newSample.logBptPrice).to.be.equal(logBptPrice);
      expect(newSample.accLogBptPrice).to.be.equal(prevSample.accLogBptPrice.add(bn(logBptPrice).mul(elapsed)));
      expect(newSample.logInvariant).to.be.equal(logInv);
      expect(newSample.accLogInvariant).to.be.equal(prevSample.accLogInvariant.add(bn(logInv).mul(elapsed)));
      expect(newSample.timestamp).to.be.equal(timestamp);
    };

    it('updates the sample correctly', async () => {
      const sample = await oracle.encode({
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

  describe('process', () => {
    const newLogPairPrice = 100;
    const newLogBptPrice = 200;
    const newLogInvariant = 300;

    const itUpdatesTheExistingSample = (index: number, elapsed: number) => {
      it('updates the existing sample', async () => {
        const previousSample = await oracle.getSample(index);

        if (elapsed > 0) await advanceTime(elapsed);
        const tx = await oracle.processPriceData(elapsed, index, newLogPairPrice, newLogBptPrice, newLogInvariant);

        expectEvent.inReceipt(await tx.wait(), 'PriceDataProcessed', { newSample: false, sampleIndex: index });
        const updatedSample = await oracle.getSample(index);

        expect(updatedSample.timestamp).to.be.equal(await currentTimestamp());
        const actualElapsed = updatedSample.timestamp.sub(previousSample.timestamp);

        expect(updatedSample.logPairPrice).to.be.equal(newLogPairPrice);
        const expectedAccLogPairPrice = previousSample.accLogPairPrice.add(bn(newLogPairPrice).mul(actualElapsed));
        expect(updatedSample.accLogPairPrice).to.be.equal(expectedAccLogPairPrice);

        expect(updatedSample.logBptPrice).to.be.equal(newLogBptPrice);
        const expectedAccLogBptPrice = previousSample.accLogBptPrice.add(bn(newLogBptPrice).mul(actualElapsed));
        expect(updatedSample.accLogBptPrice).to.be.equal(expectedAccLogBptPrice);

        expect(updatedSample.logInvariant).to.be.equal(newLogInvariant);
        const expectedAccLogInvariant = previousSample.accLogInvariant.add(bn(newLogInvariant).mul(actualElapsed));
        expect(updatedSample.accLogInvariant).to.be.equal(expectedAccLogInvariant);
      });
    };

    const itCreatesAnotherSample = (index: number, elapsed: number) => {
      it('does not update the previous sample', async () => {
        const previousSample = await oracle.getSample(index);

        if (elapsed > 0) await advanceTime(elapsed);
        await oracle.processPriceData(elapsed, index, newLogPairPrice, newLogBptPrice, newLogInvariant);

        const sameSample = await oracle.getSample(index);
        expect(sameSample.logPairPrice).to.be.equal(previousSample.logPairPrice);
        expect(sameSample.accLogPairPrice).to.be.equal(previousSample.accLogPairPrice);
        expect(sameSample.logBptPrice).to.be.equal(previousSample.logBptPrice);
        expect(sameSample.accLogBptPrice).to.be.equal(previousSample.accLogBptPrice);
        expect(sameSample.logInvariant).to.be.equal(previousSample.logInvariant);
        expect(sameSample.accLogInvariant).to.be.equal(previousSample.accLogInvariant);
        expect(sameSample.timestamp).to.be.equal(previousSample.timestamp);
      });

      it('creates another sample', async () => {
        const previousSample = await oracle.getSample(index);

        if (elapsed > 0) await advanceTime(elapsed);
        const tx = await oracle.processPriceData(elapsed, index, newLogPairPrice, newLogBptPrice, newLogInvariant);

        const expectedIndex = (index + 1) % MAX_BUFFER_SIZE;
        expectEvent.inReceipt(await tx.wait(), 'PriceDataProcessed', { newSample: true, sampleIndex: expectedIndex });

        const newSample = await oracle.getSample(expectedIndex);
        expect(newSample.timestamp).to.be.equal(await currentTimestamp());
        const actualElapsed = newSample.timestamp.sub(previousSample.timestamp);

        expect(newSample.logPairPrice).to.be.equal(newLogPairPrice);
        const expectedAccLogPairPrice = previousSample.accLogPairPrice.add(bn(newLogPairPrice).mul(actualElapsed));
        expect(newSample.accLogPairPrice).to.be.equal(expectedAccLogPairPrice);

        expect(newSample.logBptPrice).to.be.equal(newLogBptPrice);
        const expectedAccLogBptPrice = previousSample.accLogBptPrice.add(bn(newLogBptPrice).mul(actualElapsed));
        expect(newSample.accLogBptPrice).to.be.equal(expectedAccLogBptPrice);

        expect(newSample.logInvariant).to.be.equal(newLogInvariant);
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
            logPairPrice: 1,
            accLogPairPrice: 10,
            logBptPrice: 2,
            accLogBptPrice: 20,
            logInvariant: 3,
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

      context('when the next sample completes the buffer', () => {
        const index = MAX_BUFFER_SIZE - 1;

        sharedBeforeEach('create a sample', async () => {
          await oracle.mockSample(index, {
            logPairPrice: 1,
            accLogPairPrice: 10,
            logBptPrice: 2,
            accLogBptPrice: 20,
            logInvariant: 3,
            accLogInvariant: 30,
            timestamp: await currentTimestamp(),
          });
        });

        context('when the current timestamp is greater than the initial timestamp by less than 2 minutes', () => {
          itUpdatesTheExistingSample(index, MINUTE);
        });

        context('when the current timestamp is greater than the initial timestamp by more than 2 minutes', () => {
          itCreatesAnotherSample(index, MINUTE * 3);
        });
      });
    });
  });

  describe('queries', () => {
    const ZEROS = Array(MAX_BUFFER_SIZE).fill(0);

    const PAIR_PRICE = 0;
    const BPT_PRICE = 1;
    const INVARIANT = 2;

    context('without offset', () => {
      const offset = 0;
      itHandlesQueriesProperly(offset);
    });

    context('with a small offset', () => {
      const offset = 15;
      itHandlesQueriesProperly(offset);
    });

    context('with a large offset', () => {
      const offset = MAX_BUFFER_SIZE / 2;
      itHandlesQueriesProperly(offset);
    });

    context('with the highest offset', () => {
      const offset = MAX_BUFFER_SIZE - 1;
      itHandlesQueriesProperly(offset);
    });

    function itHandlesQueriesProperly(offset: number) {
      const currentIndex = (offset - 1 + MAX_BUFFER_SIZE) % MAX_BUFFER_SIZE;

      sharedBeforeEach('mock samples', async () => {
        const indexes = ZEROS.map((_, i) => i);
        const values = ZEROS.map((_, i) => ({
          timestamp: timestampAt(i),
          instant: instantAt(i),
          accumulator: accumAt(i),
        }));

        // Assert mocked buffer was created as expected
        for (let i = 0; i < MAX_BUFFER_SIZE; i++) {
          expect(values[indexAt(i)].timestamp).to.equal(i * 10 + 1);
        }

        for (let from = 0, to = from + 100; from < MAX_BUFFER_SIZE; from += 100, to = from + 100) {
          const samples = values.slice(from, to).map((x) => ({
            logPairPrice: x.instant + PAIR_PRICE,
            logBptPrice: x.instant + BPT_PRICE,
            logInvariant: x.instant + INVARIANT,
            accLogPairPrice: x.accumulator + PAIR_PRICE,
            accLogBptPrice: x.accumulator + BPT_PRICE,
            accLogInvariant: x.accumulator + INVARIANT,
            timestamp: x.timestamp,
          }));
          await oracle.mockSamples(indexes.slice(from, to), samples);
        }
      });

      const timestampAt = (i: number): number => {
        // The offset will always have the oldest value, the previous slot to the offset will be always the latest value
        return ((i + MAX_BUFFER_SIZE - offset) % MAX_BUFFER_SIZE) * 10 + 1;
      };

      const instantAt = (i: number): number => {
        // The offset will always have the oldest value, the previous slot to the offset will be always the latest value
        return ((i + MAX_BUFFER_SIZE - offset) % MAX_BUFFER_SIZE) * 13 + 7;
      };

      const accumAt = (i: number): number => {
        // The offset will always have the oldest value, the previous slot to the offset will be always the latest value
        return ((i + MAX_BUFFER_SIZE - offset) % MAX_BUFFER_SIZE) * 20 + 5;
      };

      const indexAt = (i: number): number => {
        // Computes the corresponding index for the given offset
        return (offset + i) % MAX_BUFFER_SIZE;
      };

      describe('findNearestSample', () => {
        it('can find every exact value', async () => {
          const dates = ZEROS.map((i) => timestampAt(indexAt(i)));
          const intermediates = await oracle.findNearestSamplesTimestamp(dates, offset);

          for (let i = 0; i < dates.length; i++) {
            const expectedDate = dates[i];
            const error = `Failed for [i: ${i}, index: ${indexAt(i)}, date: ${expectedDate}]`;

            const { prev, next } = intermediates[i];
            expect(prev.toNumber()).to.equal(expectedDate, error);
            expect(next.toNumber()).to.equal(expectedDate, error);
          }
        });

        it('can find intermediate values', async () => {
          const delta = 7;

          // The latest sample will end up in an edge case where it's next value is the oldest one
          const dates = ZEROS.map((i) => timestampAt(indexAt(i)) + delta).slice(0, -1);
          const intermediates = await oracle.findNearestSamplesTimestamp(dates, offset);

          for (let i = 0; i < dates.length; i++) {
            const expectedDate = dates[i] - delta;
            const error = `Failed for [i: ${i}, index: ${indexAt(i)}, date: ${expectedDate}]`;

            const { prev, next } = intermediates[i];
            expect(prev.toNumber()).to.equal(expectedDate, error);
            expect(next.toNumber()).to.equal(expectedDate + 10, error);
          }
        });
      });

      describe('getPastAccLogPairPrice', () => {
        describe('pair price', () => {
          const variable = PAIR_PRICE;
          itEstimatesAccumulatorsCorrectly(variable);
        });

        describe('BPT price', () => {
          const variable = BPT_PRICE;
          itEstimatesAccumulatorsCorrectly(variable);
        });

        describe('invariant', () => {
          const variable = INVARIANT;
          itEstimatesAccumulatorsCorrectly(variable);
        });

        function itEstimatesAccumulatorsCorrectly(variable: number) {
          function itFindsLatestAndFutureAccumulators() {
            it('can find the latest accumulator', async () => {
              const actual = await oracle.getPastAccumulator(variable, currentIndex, timestampAt(currentIndex));
              const expected = accumAt(currentIndex) + variable;
              expect(actual).to.equal(expected);
            });

            it('extrapolates future accumulators', async () => {
              const elapsed = 3;
              const futureTimestamp = timestampAt(currentIndex) + elapsed;

              const actual = await oracle.getPastAccumulator(variable, currentIndex, futureTimestamp);
              const expected = accumAt(currentIndex) + variable + (instantAt(currentIndex) + variable) * elapsed;
              expect(actual).to.equal(expected);
            });
          }

          context('with a complete buffer', () => {
            itFindsLatestAndFutureAccumulators();

            it('finds past accumulators', async () => {
              const pastIndex = indexAt(MAX_BUFFER_SIZE / 2);
              const pastTimestamp = timestampAt(pastIndex);

              const actual = await oracle.getPastAccumulator(variable, currentIndex, pastTimestamp);
              const expected = accumAt(pastIndex) + variable;
              expect(actual).to.equal(expected);
            });

            it('interpolates between past accumulators', async () => {
              const timeDelta = 5;

              const previousIndex = indexAt(MAX_BUFFER_SIZE / 2);
              const nextIndex = (previousIndex + 1) % MAX_BUFFER_SIZE;

              const pastTimestamp = timestampAt(previousIndex) + timeDelta;
              expect(pastTimestamp).to.be.lt(timestampAt(nextIndex));

              const slope =
                (accumAt(nextIndex) - accumAt(previousIndex)) / (timestampAt(nextIndex) - timestampAt(previousIndex));

              const actual = await oracle.getPastAccumulator(variable, currentIndex, pastTimestamp);
              const expected = accumAt(previousIndex) + variable + timeDelta * slope;
              expect(actual).to.equal(expected);
            });

            it('finds last accumulator', async () => {
              const oldestIndex = indexAt(0);
              const oldestTimestamp = timestampAt(oldestIndex);

              const actual = await oracle.getPastAccumulator(variable, currentIndex, oldestTimestamp);
              const expected = accumAt(oldestIndex) + variable;
              expect(actual).to.equal(expected);
            });

            it('reverts with too old timestamp', async () => {
              const tooOldTimestamp = timestampAt(indexAt(0)) - 1;

              await expect(oracle.getPastAccumulator(variable, currentIndex, tooOldTimestamp)).to.be.revertedWith(
                'ORACLE_QUERY_TOO_OLD'
              );
            });
          });

          context('with incomplete buffer', () => {
            sharedBeforeEach('remove sample', async () => {
              await oracle.mockSample(indexAt(0), {
                logPairPrice: 0,
                accLogPairPrice: 0,
                logBptPrice: 0,
                accLogBptPrice: 0,
                logInvariant: 0,
                accLogInvariant: 0,
                timestamp: 0,
              });
            });

            context('when querying latest and future timestamps', () => {
              itFindsLatestAndFutureAccumulators();
            });

            context('when querying past timestamps', () => {
              it('reverts', async () => {
                const pastTimestamp = timestampAt(currentIndex) - 1;

                await expect(oracle.getPastAccumulator(variable, currentIndex, pastTimestamp)).to.be.revertedWith(
                  'ORACLE_NOT_INITIALIZED'
                );
              });
            });
          });
        }
      });
    }
  });
});
