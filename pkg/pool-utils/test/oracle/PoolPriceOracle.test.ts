import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { bn, decimal, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { advanceTime, advanceToTimestamp, currentTimestamp, MINUTE } from '@balancer-labs/v2-helpers/src/time';

describe('PoolPriceOracle', () => {
  let oracle: Contract;

  const MAX_BUFFER_SIZE = 1024;

  const newLogPairPrice = 100;
  const newLogBptPrice = 200;
  const newLogInvariant = 300;

  sharedBeforeEach('deploy oracle', async () => {
    oracle = await deploy('MockPoolPriceOracle', {
      libraries: { QueryProcessor: (await deploy('QueryProcessor')).address },
    });
  });

  describe('process', () => {
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

      const expectedIndex = (index + 1) % MAX_BUFFER_SIZE;
      const itCreatesANewSample = (index: number, elapsed: number) => {
        it('creates a new sample', async () => {
          const previousSample = await oracle.getSample(index);

          if (elapsed > 0) await advanceTime(elapsed);
          const tx = await oracle.processPriceData(elapsed, index, newLogPairPrice, newLogBptPrice, newLogInvariant);

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

      context('with clean storage slot', () => {
        itCreatesANewSample(index, elapsed);
      });

      context('with dirty storage slot', () => {
        sharedBeforeEach(async () => {
          await oracle.dirtyUninitializedOracleSamples(expectedIndex, expectedIndex + 1);
        });

        itCreatesANewSample(index, elapsed);
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

  describe('findNearestSample', () => {
    const ZEROS = Array(MAX_BUFFER_SIZE).fill(0);

    function itHandlesSearchesProperly(offset: number) {
      sharedBeforeEach('mock samples', async () => {
        const indexes = ZEROS.map((_, i) => i);
        const values = ZEROS.map((_, i) => timestampAt(i));

        // Assert mocked buffer was created as expected
        for (let i = 0; i < MAX_BUFFER_SIZE; i++) {
          expect(values[indexAt(i)]).to.equal(i * 10 + 1);
        }

        const defaults = { accLogPairPrice: 0, logBptPrice: 0, accLogBptPrice: 0, logInvariant: 0, accLogInvariant: 0 };
        for (let from = 0, to = from + 100; from < MAX_BUFFER_SIZE; from += 100, to = from + 100) {
          const samples = values.slice(from, to).map((x) => ({ ...defaults, logPairPrice: x, timestamp: x }));
          await oracle.mockSamples(indexes.slice(from, to), samples);
        }
      });

      const timestampAt = (i: number): number => {
        // The offset will always have the oldest value, the previous slot to the offset will be always the latest value
        return ((i + MAX_BUFFER_SIZE - offset) % MAX_BUFFER_SIZE) * 10 + 1;
      };

      const indexAt = (i: number): number => {
        // Computes the corresponding index for the given offset
        return (offset + i) % MAX_BUFFER_SIZE;
      };

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
    }

    context('without offset', () => {
      const offset = 0;

      itHandlesSearchesProperly(offset);
    });

    context('with a small offset', () => {
      const offset = 15;

      itHandlesSearchesProperly(offset);
    });

    context('with a large offset', () => {
      const offset = MAX_BUFFER_SIZE / 2;

      itHandlesSearchesProperly(offset);
    });

    context('with the highest offset', () => {
      const offset = MAX_BUFFER_SIZE - 1;

      itHandlesSearchesProperly(offset);
    });
  });

  describe('getPastAccumulator', () => {
    const ZEROS = Array(MAX_BUFFER_SIZE).fill(0);

    const VARIABLES = {
      PAIR_PRICE: 0,
      BPT_PRICE: 1,
      INVARIANT: 2,
    };

    context('without offset', () => {
      const offset = 0;

      itEstimatesPastAccumulatorCorrectly(offset);
    });

    context('with a small offset', () => {
      const offset = 15;

      itEstimatesPastAccumulatorCorrectly(offset);
    });

    context('with a large offset', () => {
      const offset = MAX_BUFFER_SIZE / 2;

      itEstimatesPastAccumulatorCorrectly(offset);
    });

    context('with the highest offset', () => {
      const offset = MAX_BUFFER_SIZE - 1;

      itEstimatesPastAccumulatorCorrectly(offset);
    });

    function itEstimatesPastAccumulatorCorrectly(offset: number) {
      const currentIndex = (offset - 1 + MAX_BUFFER_SIZE) % MAX_BUFFER_SIZE;

      // Computes the corresponding index for the given offset
      // The offset will always have the oldest value, the previous slot to the offset will be always the latest value
      const indexAt = (i: number): number => (offset + i) % MAX_BUFFER_SIZE;
      const valueAt = (i: number): number => (i + MAX_BUFFER_SIZE - offset) % MAX_BUFFER_SIZE;
      const timestampAt = (i: number): number => valueAt(i) * 10 + 1;
      const baseAccumAt = (i: number): number => valueAt(i) * 20 + 5;
      const baseInstantAt = (i: number): number => valueAt(i) * 13 + 7;

      sharedBeforeEach('mock samples', async () => {
        const indexes = ZEROS.map((_, i) => i);
        const samples = ZEROS.map((_, i) => ({
          instant: baseInstantAt(i),
          accumulator: baseAccumAt(i),
          timestamp: timestampAt(i),
        })).map((x) => ({
          logPairPrice: x.instant + VARIABLES.PAIR_PRICE,
          logBptPrice: x.instant + VARIABLES.BPT_PRICE,
          logInvariant: x.instant + VARIABLES.INVARIANT,
          accLogPairPrice: x.accumulator + VARIABLES.PAIR_PRICE,
          accLogBptPrice: x.accumulator + VARIABLES.BPT_PRICE,
          accLogInvariant: x.accumulator + VARIABLES.INVARIANT,
          timestamp: x.timestamp,
        }));

        // Assert mocked buffer was created as expected
        for (let i = 0; i < MAX_BUFFER_SIZE; i++) {
          expect(samples[indexAt(i)].timestamp).to.equal(i * 10 + 1);
        }

        for (let from = 0, to = from + 100; from < MAX_BUFFER_SIZE; from += 100, to = from + 100) {
          await oracle.mockSamples(indexes.slice(from, to), samples.slice(from, to));
        }
      });

      describe('invariant', () => itEstimatesPastAccumulatorVariableCorrectly(VARIABLES.INVARIANT));
      describe('BPT price', () => itEstimatesPastAccumulatorVariableCorrectly(VARIABLES.BPT_PRICE));
      describe('pair price', () => itEstimatesPastAccumulatorVariableCorrectly(VARIABLES.PAIR_PRICE));

      function itEstimatesPastAccumulatorVariableCorrectly(variable: number) {
        const accumAt = (i: number): number => baseAccumAt(i) + variable;
        const instantAt = (i: number): number => baseInstantAt(i) + variable;

        context('with a complete buffer', () => {
          it('finds past accumulators', async () => {
            const pastIndex = indexAt(MAX_BUFFER_SIZE / 2);
            const pastTimestamp = timestampAt(pastIndex);

            const accumulator = await oracle.getPastAccumulator(variable, currentIndex, pastTimestamp);
            expect(accumulator).to.equal(accumAt(pastIndex));
          });

          it('interpolates between past accumulators', async () => {
            const timeDelta = 5;

            const previousIndex = indexAt(MAX_BUFFER_SIZE / 2);
            const nextIndex = (previousIndex + 1) % MAX_BUFFER_SIZE;

            const pastTimestamp = timestampAt(previousIndex) + timeDelta;
            expect(pastTimestamp).to.be.lt(timestampAt(nextIndex));

            const slope =
              (accumAt(nextIndex) - accumAt(previousIndex)) / (timestampAt(nextIndex) - timestampAt(previousIndex));

            const expectedAccum = accumAt(previousIndex) + timeDelta * slope;
            const actualAccum = await oracle.getPastAccumulator(variable, currentIndex, pastTimestamp);
            expect(actualAccum).to.equal(expectedAccum);
          });

          it('finds last accumulator', async () => {
            const oldestIndex = indexAt(0);
            const oldestTimestamp = timestampAt(oldestIndex);

            const expectedAccum = await oracle.getPastAccumulator(variable, currentIndex, oldestTimestamp);
            expect(expectedAccum).to.equal(accumAt(oldestIndex));
          });

          it('reverts with too old timestamp', async () => {
            const tooOldTimestamp = timestampAt(indexAt(0)) - 1;

            await expect(oracle.getPastAccumulator(variable, currentIndex, tooOldTimestamp)).to.be.revertedWith(
              'ORACLE_QUERY_TOO_OLD'
            );
          });
        });

        if (offset === 0) {
          context('with incomplete buffer', () => {
            const latestIndex = currentIndex - 1;

            sharedBeforeEach('simulate last sample missing', async () => {
              await oracle.mockSample(currentIndex, {
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
              it('can find the latest accumulator', async () => {
                const accumulator = await oracle.getPastAccumulator(variable, latestIndex, timestampAt(latestIndex));
                expect(accumulator).to.equal(accumAt(latestIndex));
              });

              it('extrapolates future accumulators', async () => {
                const elapsed = 3;
                const futureTimestamp = timestampAt(latestIndex) + elapsed;

                const expectedAccum = accumAt(latestIndex) + instantAt(latestIndex) * elapsed;
                const actualAccum = await oracle.getPastAccumulator(variable, latestIndex, futureTimestamp);
                expect(actualAccum).to.equal(expectedAccum);
              });
            });

            context('when querying past timestamps', () => {
              it('can find past accumulators', async () => {
                const pastIndex = latestIndex - 10;
                const pastTimestamp = timestampAt(pastIndex);

                const accumulator = await oracle.getPastAccumulator(variable, latestIndex, pastTimestamp);
                expect(accumulator).to.equal(accumAt(pastIndex));
              });

              it('reverts with too old timestamp', async () => {
                const tooOldTimestamp = timestampAt(0) - 1;

                await expect(oracle.getPastAccumulator(variable, latestIndex, tooOldTimestamp)).to.be.revertedWith(
                  'ORACLE_QUERY_TOO_OLD'
                );
              });
            });
          });
        }
      }
    }
  });

  describe('queries', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let samples: any[];

    const MAX_BUFFER_SIZE = 1024;
    const OLDEST = 0;
    const MID = MAX_BUFFER_SIZE / 2;
    const LATEST = MAX_BUFFER_SIZE - 1;

    const ago = (index: number) => (LATEST - index) * 2 * MINUTE;

    const VARIABLES = {
      PAIR_PRICE: 0,
      BPT_PRICE: 1,
      INVARIANT: 2,
    };

    const mockSamples = (ascending: boolean) => {
      sharedBeforeEach('mock samples', async () => {
        const now = await currentTimestamp();
        const ZEROS = Array(MAX_BUFFER_SIZE).fill(0);
        const indexes = ZEROS.map((_, i) => i);

        samples = ZEROS.map((_, i) => ({
          timestamp: now.add(i * 2 * MINUTE),
          instant: (ascending ? i : MAX_BUFFER_SIZE - i) * 5,
          accumulator: (ascending ? i : MAX_BUFFER_SIZE - i) * 100,
        })).map((x) => ({
          logPairPrice: x.instant + VARIABLES.PAIR_PRICE,
          logBptPrice: x.instant + VARIABLES.BPT_PRICE,
          logInvariant: x.instant + VARIABLES.INVARIANT,
          accLogPairPrice: x.accumulator + VARIABLES.PAIR_PRICE,
          accLogBptPrice: x.accumulator + VARIABLES.BPT_PRICE,
          accLogInvariant: x.accumulator + VARIABLES.INVARIANT,
          timestamp: x.timestamp,
        }));

        for (let from = 0, to = from + 100; from < MAX_BUFFER_SIZE; from += 100, to = from + 100) {
          await oracle.mockSamples(indexes.slice(from, to), samples.slice(from, to));
        }

        await oracle.mockOracleIndex(LATEST);
        await advanceToTimestamp(samples[LATEST].timestamp);
      });
    };

    const itAnswersQueriesCorrectly = (ascendingAccumulators: boolean) => {
      mockSamples(ascendingAccumulators);

      describe('getLatest', () => {
        it('returns the latest pair price', async () => {
          const actual = await oracle.getLatest(VARIABLES.PAIR_PRICE);
          const expected = fp(decimal(samples[LATEST].logPairPrice).div(1e4).exp());
          expect(actual).to.be.equal(expected);
        });

        it('returns the latest BPT price', async () => {
          const actual = await oracle.getLatest(VARIABLES.BPT_PRICE);
          const expected = fp(decimal(samples[LATEST].logBptPrice).div(1e4).exp());
          expect(actual).to.be.equal(expected);
        });

        it('returns the latest pair price', async () => {
          const actual = await oracle.getLatest(VARIABLES.INVARIANT);
          const expected = fp(decimal(samples[LATEST].logInvariant).div(1e4).exp());
          expect(actual).to.be.equal(expected);
        });
      });

      describe('getPastAccumulators', () => {
        const queries = [
          { variable: VARIABLES.PAIR_PRICE, ago: ago(LATEST) },
          { variable: VARIABLES.BPT_PRICE, ago: ago(OLDEST) },
          { variable: VARIABLES.INVARIANT, ago: ago(MID) },
        ];

        it('returns the expected values', async () => {
          const results = await oracle.getPastAccumulators(queries);

          expect(results.length).to.be.equal(3);

          expect(results[0]).to.be.equal(samples[LATEST].accLogPairPrice);
          expect(results[1]).to.be.equal(samples[OLDEST].accLogBptPrice);
          expect(results[2]).to.be.equal(samples[MID].accLogInvariant);
        });
      });

      describe('getTimeWeightedAverage', () => {
        const secs = 2 * MINUTE;

        const queries = [
          { variable: VARIABLES.PAIR_PRICE, secs, ago: ago(LATEST) },
          { variable: VARIABLES.BPT_PRICE, secs, ago: ago(OLDEST + 1) },
          { variable: VARIABLES.INVARIANT, secs, ago: ago(MID) },
        ];

        const assertAverage = (actual: BigNumber, diff: number) => {
          const expectedAverage = fp(decimal(diff).div(secs).div(1e4).exp());
          expect(actual).to.be.equalWithError(expectedAverage, 0.0001);
        };

        it('returns the expected values', async () => {
          const results = await oracle.getTimeWeightedAverage(queries);

          expect(results.length).to.be.equal(3);

          assertAverage(results[0], samples[LATEST].accLogPairPrice - samples[LATEST - 1].accLogPairPrice);
          assertAverage(results[1], samples[OLDEST + 1].accLogBptPrice - samples[OLDEST].accLogBptPrice);
          assertAverage(results[2], samples[MID].accLogInvariant - samples[MID - 1].accLogInvariant);
        });
      });
    };

    context('with positive values', () => {
      itAnswersQueriesCorrectly(true);
    });

    context('with negative values', () => {
      itAnswersQueriesCorrectly(false);
    });
  });

  describe('dirty', () => {
    it('reverts if end <= start', async () => {
      await expect(oracle.dirtyUninitializedOracleSamples(1, 1)).to.be.revertedWith('OUT_OF_BOUNDS');
      await expect(oracle.dirtyUninitializedOracleSamples(1, 0)).to.be.revertedWith('OUT_OF_BOUNDS');
    });

    it('reverts if  end > buffer size', async () => {
      await expect(oracle.dirtyUninitializedOracleSamples(0, 1025)).to.be.revertedWith('OUT_OF_BOUNDS');
    });

    it('dirty samples have zero timestamp but non-zero data (dirty storage slot)', async () => {
      const ZERO_SAMPLE = [fp(0), fp(0), fp(0), fp(0), fp(0), fp(0), fp(0)];

      const sampleIndex = 0;
      await oracle.dirtyUninitializedOracleSamples(sampleIndex, sampleIndex + 1);

      const dirtySample = await oracle.getSample(sampleIndex);
      expect(dirtySample.timestamp).to.equal(0);
      expect(dirtySample).to.not.deep.equal(ZERO_SAMPLE);
    });

    context('with initialized sample', () => {
      const index = 5;

      sharedBeforeEach(async () => {
        await oracle.processPriceData(0, index, newLogPairPrice, newLogBptPrice, newLogInvariant);
      });

      it('does not modify initialized samples', async () => {
        const lastSample = await oracle.getSample(index);

        await oracle.dirtyUninitializedOracleSamples(index, index + 1);
        const unmodifiedSample = await oracle.getSample(index);

        expect(unmodifiedSample).to.deep.equal(lastSample);
      });
    });
  });
});
