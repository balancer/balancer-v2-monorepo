import { expect } from 'chai';
import { Contract, BigNumber } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { bn, fp, FP_ZERO } from '@balancer-labs/v2-helpers/src/numbers';
import { random } from 'lodash';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { CircuitBreakerParams } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';

describe('CircuitBreakerLib', () => {
  const BPT_PRICE = 0.4212;
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
    setter: (circuitBreakerParams: CircuitBreakerParams) => Promise<string>,
    lowerBoundPct: BigNumber,
    upperBoundPct: BigNumber
  ) {
    const circuitBreakerParams: CircuitBreakerParams = {
      bptPrice: fp(BPT_PRICE),
      weightComplement: fp(WEIGHT_COMPLEMENT),
      lowerBound: lowerBoundPct,
      upperBound: upperBoundPct,
    };

    const data = await setter(circuitBreakerParams);

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
      await assertCircuitBreakerState(
        lib.getCircuitBreakerFields,
        lib.setCircuitBreakerFields,
        fp(lowerBound),
        fp(upperBound)
      );
    });
  }

  context('when parameters are invalid', () => {
    it('reverts if the lower bound > 1', async () => {
      await expect(
        lib.setCircuitBreakerFields({
          bptPrice: fp(BPT_PRICE),
          weightComplement: fp(WEIGHT_COMPLEMENT),
          lowerBound: fp(1).add(1),
          upperBound: 0,
        })
      ).to.be.revertedWith('INVALID_CIRCUIT_BREAKER_BOUNDS');
    });

    it('reverts if the upper bound > MAX_BOUND', async () => {
      await expect(
        lib.setCircuitBreakerFields({
          bptPrice: fp(BPT_PRICE),
          weightComplement: fp(WEIGHT_COMPLEMENT),
          lowerBound: 0,
          upperBound: fp(MAX_BOUND).add(1),
        })
      ).to.be.revertedWith('INVALID_CIRCUIT_BREAKER_BOUNDS');
    });

    it('reverts if the upper bound < lower_bound', async () => {
      await expect(
        lib.setCircuitBreakerFields({
          bptPrice: fp(BPT_PRICE),
          weightComplement: fp(WEIGHT_COMPLEMENT),
          lowerBound: fp(0.9),
          upperBound: fp(0.9).sub(1),
        })
      ).to.be.revertedWith('INVALID_CIRCUIT_BREAKER_BOUNDS');
    });
  });

  context('when circuit breakers are not set', () => {
    itSetsCircuitBreakersCorrectly(FP_ZERO, FP_ZERO);
  });

  context('when only the lower bound is set', () => {
    itSetsCircuitBreakersCorrectly(bn(Math.random()), FP_ZERO);
  });

  context('when only the upper bound is set', () => {
    itSetsCircuitBreakersCorrectly(FP_ZERO, bn(random(2, true)));
  });

  context('when both bounds are set', () => {
    const lowerBound = bn(Math.random());
    const upperBound = lowerBound.add(bn(Math.random()));

    itSetsCircuitBreakersCorrectly(lowerBound, upperBound);
  });

  describe('percentage to BPT price conversion ratios', () => {
    const circuitBreakerParams: CircuitBreakerParams = {
      bptPrice: fp(BPT_PRICE),
      weightComplement: fp(WEIGHT_COMPLEMENT),
      lowerBound: fp(LOWER_BOUND),
      upperBound: fp(UPPER_BOUND),
    };

    let data: string;

    sharedBeforeEach('set default values', async () => {
      data = await lib.setCircuitBreakerFields(circuitBreakerParams);
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
});
