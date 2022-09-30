import { expect } from 'chai';
import { Contract, BigNumber } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp, fpDiv, fpMul, FP_ZERO, randomFromInterval } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { MAX_UINT96 } from '@balancer-labs/v2-helpers/src/constants';

describe('CircuitBreakerLib', () => {
  const TOTAL_SUPPLY = 4202.444487;
  const NORMALIZED_WEIGHT = 0.8;
  const TOKEN_BALANCE = 8000;

  const BPT_PRICE = (TOTAL_SUPPLY * NORMALIZED_WEIGHT) / TOKEN_BALANCE;
  const MIN_BOUND = 0.1;
  const MAX_BOUND = 10;
  const MAX_RELATIVE_ERROR = 0.01;
  const LOWER_BOUND = 0.8;
  const UPPER_BOUND = 2;
  const WEIGHT_COMPLEMENT = 0.2; // e.g., 1 - 0.8

  let lib: Contract;

  before('deploy lib', async () => {
    lib = await deploy('MockCircuitBreakerLib');
  });

  async function assertCircuitBreakerState(
    getter: (word: string) => Promise<BigNumber[]>,
    setter: (
      bptPrice: BigNumber,
      weightComplement: BigNumber,
      lowerBound: BigNumber,
      upperBound: BigNumber
    ) => Promise<string>,
    lowerBoundPct: BigNumber,
    upperBoundPct: BigNumber
  ) {
    const data = await setter(fp(BPT_PRICE), fp(WEIGHT_COMPLEMENT), lowerBoundPct, upperBoundPct);

    // Bounds set correctly.
    const [bptPrice, weightComplement, lowerBound, upperBound] = await getter(data);

    expect(bptPrice).to.equal(fp(BPT_PRICE));
    expect(weightComplement).to.equal(fp(WEIGHT_COMPLEMENT));
    // These are high precision random numbers, and there is compression, so it's not exact
    expect(lowerBound).to.almostEqual(lowerBoundPct, MAX_RELATIVE_ERROR);
    expect(upperBound).to.almostEqual(upperBoundPct, MAX_RELATIVE_ERROR);
  }

  async function itSetsCircuitBreakersCorrectly(lowerBound: BigNumber, upperBound: BigNumber) {
    it('sets and retrieves the bounds', async () => {
      await assertCircuitBreakerState(lib.getCircuitBreakerFields, lib.setCircuitBreaker, lowerBound, upperBound);
    });
  }

  async function itReportsTrippedBreakersCorrectly(lowerBound: BigNumber, upperBound: BigNumber) {
    it('checks tripped status', async () => {
      const data = await lib.setCircuitBreaker(fp(BPT_PRICE), fp(WEIGHT_COMPLEMENT), lowerBound, upperBound);

      // Pass in the same weight factor it was constructed with to get the reference bounds
      const [lowerBptPriceBound, upperBptPriceBound] = await lib.getCurrentCircuitBreakerBounds(
        data,
        fp(WEIGHT_COMPLEMENT)
      );

      let lowerBoundTripped: boolean;
      let upperBoundTripped: boolean;
      let priceMultiplier: BigNumber;
      let supplyAtBoundary: BigNumber;

      // if the lowerBound/lowerBound is 0, the corresponding price bound should also be zero
      if (lowerBound == FP_ZERO) {
        expect(lowerBptPriceBound).to.equal(FP_ZERO);
        // It is never tripped, even with a 0 price (0 supply = 0 price)
        const [lowerBoundTripped] = await lib.hasCircuitBreakerTripped(
          data,
          FP_ZERO,
          fp(NORMALIZED_WEIGHT),
          fp(TOKEN_BALANCE)
        );
        expect(lowerBoundTripped).to.be.false;
      } else {
        // The breaker should NOT be tripped with the nominal bpt price
        [lowerBoundTripped] = await lib.hasCircuitBreakerTripped(
          data,
          fp(TOTAL_SUPPLY),
          fp(NORMALIZED_WEIGHT),
          fp(TOKEN_BALANCE)
        );
        expect(lowerBoundTripped).to.be.false;

        // The breaker should be tripped with a price slightly below the bound
        priceMultiplier = fpDiv(lowerBptPriceBound, fp(BPT_PRICE));
        supplyAtBoundary = fpMul(fp(TOTAL_SUPPLY), priceMultiplier);

        [lowerBoundTripped] = await lib.hasCircuitBreakerTripped(
          data,
          fpMul(supplyAtBoundary, fp(0.9999)),
          fp(NORMALIZED_WEIGHT),
          fp(TOKEN_BALANCE)
        );
        expect(lowerBoundTripped).to.be.true;
      }

      if (upperBound == FP_ZERO) {
        expect(upperBptPriceBound).to.equal(FP_ZERO);
        // It is never tripped, even with a max price
        const [, upperBoundTripped] = await lib.hasCircuitBreakerTripped(
          data,
          MAX_UINT96,
          fp(NORMALIZED_WEIGHT),
          fp(TOKEN_BALANCE)
        );
        expect(upperBoundTripped).to.be.false;
      } else {
        // The breaker should NOT be tripped with the nominal bpt price
        [, upperBoundTripped] = await lib.hasCircuitBreakerTripped(
          data,
          fp(TOTAL_SUPPLY),
          fp(NORMALIZED_WEIGHT),
          fp(TOKEN_BALANCE)
        );
        expect(upperBoundTripped).to.be.false;

        // The breaker should be tripped with a price slightly above the bound
        priceMultiplier = fpDiv(upperBptPriceBound, fp(BPT_PRICE));
        supplyAtBoundary = fpMul(fp(TOTAL_SUPPLY), priceMultiplier);

        [, upperBoundTripped] = await lib.hasCircuitBreakerTripped(
          data,
          fpMul(supplyAtBoundary, fp(1.0001)),
          fp(NORMALIZED_WEIGHT),
          fp(TOKEN_BALANCE)
        );
        expect(upperBoundTripped).to.be.true;
      }
    });
  }

  context('when parameters are invalid', () => {
    it('reverts if the lower bound < 0.1', async () => {
      await expect(
        lib.setCircuitBreaker(fp(BPT_PRICE), fp(WEIGHT_COMPLEMENT), fp(MIN_BOUND).sub(1), 0)
      ).to.be.revertedWith('INVALID_CIRCUIT_BREAKER_BOUNDS');
    });

    it('reverts if the lower bound > 1', async () => {
      await expect(
        lib.setCircuitBreaker(fp(BPT_PRICE), fp(WEIGHT_COMPLEMENT), fp(1).add(1), 0)
      ).to.be.revertedWith('INVALID_CIRCUIT_BREAKER_BOUNDS');
    });

    it('reverts if the upper bound > MAX_BOUND', async () => {
      await expect(
        lib.setCircuitBreaker(fp(BPT_PRICE), fp(WEIGHT_COMPLEMENT), 0, fp(MAX_BOUND).add(1))
      ).to.be.revertedWith('INVALID_CIRCUIT_BREAKER_BOUNDS');
    });

    it('reverts if the upper bound < lower_bound', async () => {
      await expect(
        lib.setCircuitBreaker(fp(BPT_PRICE), fp(WEIGHT_COMPLEMENT), fp(0.9), fp(0.9).sub(1))
      ).to.be.revertedWith('INVALID_CIRCUIT_BREAKER_BOUNDS');
    });
  });

  context('when circuit breakers are not set', () => {
    itSetsCircuitBreakersCorrectly(FP_ZERO, FP_ZERO);
    itReportsTrippedBreakersCorrectly(FP_ZERO, FP_ZERO);
  });

  context('when only the lower bound is set', () => {
    const lowerBound = fp(randomFromInterval(MIN_BOUND, 1));

    itSetsCircuitBreakersCorrectly(lowerBound, FP_ZERO);
    itReportsTrippedBreakersCorrectly(lowerBound, FP_ZERO);
  });

  context('when only the upper bound is set', () => {
    const upperBound = fp(randomFromInterval(1, MAX_BOUND));

    itSetsCircuitBreakersCorrectly(FP_ZERO, upperBound);
    itReportsTrippedBreakersCorrectly(FP_ZERO, upperBound);
  });

  context('when both bounds are set', () => {
    const lowerBound = fp(randomFromInterval(MIN_BOUND, 1));
    const upperBound = lowerBound.add(fp(randomFromInterval(MIN_BOUND, MAX_BOUND - 1)));

    itSetsCircuitBreakersCorrectly(lowerBound, upperBound);
    itReportsTrippedBreakersCorrectly(lowerBound, upperBound);
  });

  describe('percentage to BPT price conversion ratios', () => {
    let data: string;

    sharedBeforeEach('set default values', async () => {
      data = await lib.setCircuitBreaker(fp(BPT_PRICE), fp(WEIGHT_COMPLEMENT), fp(LOWER_BOUND), fp(UPPER_BOUND));
    });

    it('should store default reference values', async () => {
      // Pass in the same weight factor it was constructed with
      const [lowerBptPriceBound, upperBptPriceBound] = await lib.getCurrentCircuitBreakerBounds(
        data,
        fp(WEIGHT_COMPLEMENT)
      );

      const expLower = LOWER_BOUND ** WEIGHT_COMPLEMENT;
      const expHigher = UPPER_BOUND ** WEIGHT_COMPLEMENT;

      const expectedLowerBound = fp(BPT_PRICE * expLower);
      const expectedUpperBound = fp(BPT_PRICE * expHigher);

      // There is compression, so it won't match exactly
      expect(lowerBptPriceBound).to.almostEqual(expectedLowerBound);
      expect(upperBptPriceBound).to.almostEqual(expectedUpperBound);
    });

    it('should compute the bounds manually when necessary', async () => {
      const newWeightComplement = WEIGHT_COMPLEMENT * (Math.random() < 0.5 ? 1 + Math.random() : 1 - Math.random());

      const [lowerBptPriceBound, upperBptPriceBound] = await lib.getCurrentCircuitBreakerBounds(
        data,
        fp(newWeightComplement)
      );

      const expLower = LOWER_BOUND ** newWeightComplement;
      const expHigher = UPPER_BOUND ** newWeightComplement;

      const expectedLowerBound = fp(BPT_PRICE * expLower);
      const expectedUpperBound = fp(BPT_PRICE * expHigher);

      // There is compression, so it won't match exactly
      expect(lowerBptPriceBound).to.almostEqual(expectedLowerBound);
      expect(upperBptPriceBound).to.almostEqual(expectedUpperBound);
    });
  });

  describe('update bounds', () => {
    let data: string;

    sharedBeforeEach('set default values', async () => {
      data = await lib.setCircuitBreaker(fp(BPT_PRICE), fp(WEIGHT_COMPLEMENT), fp(LOWER_BOUND), fp(UPPER_BOUND));
    });

    it('should update the bounds given a new weight complement', async () => {
      const newWeightComplement = WEIGHT_COMPLEMENT * (Math.random() < 0.5 ? 1 + Math.random() : 1 - Math.random());

      data = await lib.updateBoundRatios(data, fp(newWeightComplement));

      const [lowerBptPriceBound, upperBptPriceBound] = await lib.getCurrentCircuitBreakerBounds(
        data,
        fp(newWeightComplement)
      );

      const expLower = LOWER_BOUND ** newWeightComplement;
      const expHigher = UPPER_BOUND ** newWeightComplement;

      const expectedLowerBound = fp(BPT_PRICE * expLower);
      const expectedUpperBound = fp(BPT_PRICE * expHigher);

      // There is compression, so it won't match exactly
      expect(lowerBptPriceBound).to.almostEqual(expectedLowerBound);
      expect(upperBptPriceBound).to.almostEqual(expectedUpperBound);
    });
  });
});
