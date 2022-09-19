import { expect } from 'chai';
import { Contract, BigNumber } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp, fpMul, FP_ZERO, fromFp } from '@balancer-labs/v2-helpers/src/numbers';
import { random } from 'lodash';
import { ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { CircuitBreakerParams } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';

describe('CircuitBreakerLib', () => {
  const BPT_PRICE = fp(0.4212);
  const WEIGHT_FACTOR = fp(0.2); // 1 - 0.8
  const MAX_BOUND = fp(10);
  const MAX_RELATIVE_ERROR = 0.01;
  const LOWER_BOUND = fp(0.8);
  const UPPER_BOUND = fp(2);

  let lib: Contract;

  before('deploy lib', async () => {
    lib = await deploy('MockCircuitBreakerLib');
  });

  async function assertCircuitBreakerState(
    getter: (word: string) => Promise<BigNumber[]>,
    setter: (tokenState: string, circuitBreakerParams: CircuitBreakerParams) => Promise<string>,
    lowerBoundPct: BigNumber,
    upperBoundPct: BigNumber
  ) {
    const circuitBreakerParams: CircuitBreakerParams = {
      referenceBptPrice: BPT_PRICE,
      referenceWeightFactor: WEIGHT_FACTOR,
      lowerBoundPercentage: lowerBoundPct,
      upperBoundPercentage: upperBoundPct,
    };

    const data = await setter(ZERO_BYTES32, circuitBreakerParams);

    // Bounds set correctly.
    const [referenceBptPrice, currentWeightFactor, lowerBoundPercentage, upperBoundPercentage] = await getter(data);

    expect(referenceBptPrice).to.equal(BPT_PRICE);
    expect(currentWeightFactor).to.almostEqual(WEIGHT_FACTOR);
    // These are high precision random numbers, and there is compression, so it's not exact
    expect(lowerBoundPercentage).to.almostEqual(lowerBoundPct, MAX_RELATIVE_ERROR);
    expect(upperBoundPercentage).to.almostEqual(upperBoundPct, MAX_RELATIVE_ERROR);
  }

  async function itSetsCircuitBreakersCorrectly(lowerBound: BigNumber, upperBound: BigNumber) {
    it('sets and retrieves the bounds', async () => {
      await assertCircuitBreakerState(lib.getCircuitBreakerFields, lib.setCircuitBreakerFields, lowerBound, upperBound);
    });
  }

  context('when parameters are invalid', () => {
    it('reverts if the lower bound > 1', async () => {
      await expect(
        lib.setCircuitBreakerFields(ZERO_BYTES32, {
          referenceBptPrice: BPT_PRICE,
          referenceWeightFactor: WEIGHT_FACTOR,
          lowerBoundPercentage: fp(1).add(1),
          upperBoundPercentage: 0,
        })
      ).to.be.revertedWith('INVALID_CIRCUIT_BREAKER_BOUNDS');
    });

    it('reverts if the upper bound > MAX_BOUND', async () => {
      await expect(
        lib.setCircuitBreakerFields(ZERO_BYTES32, {
          referenceBptPrice: BPT_PRICE,
          referenceWeightFactor: WEIGHT_FACTOR,
          lowerBoundPercentage: MAX_BOUND,
          upperBoundPercentage: 0,
        })
      ).to.be.revertedWith('INVALID_CIRCUIT_BREAKER_BOUNDS');
    });

    it('reverts if the upper bound < lower_bound', async () => {
      await expect(
        lib.setCircuitBreakerFields(ZERO_BYTES32, {
          referenceBptPrice: BPT_PRICE,
          referenceWeightFactor: WEIGHT_FACTOR,
          lowerBoundPercentage: fp(0.9),
          upperBoundPercentage: fp(0.7),
        })
      ).to.be.revertedWith('INVALID_CIRCUIT_BREAKER_BOUNDS');
    });
  });

  context('when circuit breakers are not set', () => {
    itSetsCircuitBreakersCorrectly(FP_ZERO, FP_ZERO);
  });

  context('when only the lower bound is set', () => {
    itSetsCircuitBreakersCorrectly(fp(Math.random()), FP_ZERO);
  });

  context('when only the upper bound is set', () => {
    itSetsCircuitBreakersCorrectly(FP_ZERO, fp(random(2, true)));
  });

  context('when both bounds are set', () => {
    itSetsCircuitBreakersCorrectly(fp(Math.random()), fp(random(2, true)));
  });

  describe('percentage to BPT price conversion ratios', () => {
    const circuitBreakerParams: CircuitBreakerParams = {
      referenceBptPrice: BPT_PRICE,
      referenceWeightFactor: WEIGHT_FACTOR,
      lowerBoundPercentage: LOWER_BOUND,
      upperBoundPercentage: UPPER_BOUND,
    };

    let data: string;

    sharedBeforeEach('set default values', async () => {
      data = await lib.setCircuitBreakerFields(ZERO_BYTES32, circuitBreakerParams);
    });

    it('should store default reference values', async () => {
      // Pass in the same weight factor it was constructed with
      const [lowerBptPriceBound, upperBptPriceBound] = await lib.getCurrentCircuitBreakerBounds(data, WEIGHT_FACTOR);
      // Messy because of fp vs decimal/number
      const weightFactor = Number(fromFp(WEIGHT_FACTOR));

      const expLower = fp(Number(fromFp(LOWER_BOUND)) ** weightFactor);
      const expHigher = fp(Number(fromFp(UPPER_BOUND)) ** weightFactor);

      const expectedLowerBound = fpMul(BPT_PRICE, expLower);
      const expectedUpperBound = fpMul(BPT_PRICE, expHigher);

      // There is compression, so it won't match exactly
      expect(lowerBptPriceBound).to.almostEqual(expectedLowerBound);
      expect(upperBptPriceBound).to.almostEqual(expectedUpperBound);
    });

    it('should compute the bounds manually when necessary', async () => {
      const newWeightFactor = WEIGHT_FACTOR.mul(2); // e.g., 0.4

      const [lowerBptPriceBound, upperBptPriceBound] = await lib.getCurrentCircuitBreakerBounds(data, newWeightFactor);
      const weightFactor = Number(fromFp(newWeightFactor));

      const expLower = fp(Number(fromFp(LOWER_BOUND)) ** weightFactor);
      const expHigher = fp(Number(fromFp(UPPER_BOUND)) ** weightFactor);

      const expectedLowerBound = fpMul(BPT_PRICE, expLower);
      const expectedUpperBound = fpMul(BPT_PRICE, expHigher);

      // There is compression, so it won't match exactly
      expect(lowerBptPriceBound).to.almostEqual(expectedLowerBound);
      expect(upperBptPriceBound).to.almostEqual(expectedUpperBound);
    });
  });
});
