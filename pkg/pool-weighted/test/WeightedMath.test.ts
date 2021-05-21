import { Contract } from 'ethers';

import { bn, decimal, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import {
  calculateInvariant,
  calcInGivenOut,
  calcOutGivenIn,
  calculateOneTokenSwapFeeAmount,
} from '@balancer-labs/v2-helpers/src/models/pools/weighted/math';
import { expect } from 'chai';

const MAX_RELATIVE_ERROR = 0.0001; //Max relative error

describe('WeightedMath', function () {
  let mock: Contract;

  before(async function () {
    mock = await deploy('MockWeightedMath');
  });

  context('invariant', () => {
    context('zero invariant', () => {
      it('reverts', async () => {
        await expect(mock.invariant([bn(1)], [0])).to.be.revertedWith('ZERO_INVARIANT');
      });
    });

    context('two tokens', () => {
      it('returns invariant', async () => {
        const normalizedWeights = [bn(0.3e18), bn(0.7e18)];
        const balances = [bn(10e18), bn(12e18)];

        const result = await mock.invariant(normalizedWeights, balances);
        const expectedInvariant = calculateInvariant(balances, normalizedWeights);

        expectEqualWithError(result, bn(expectedInvariant), MAX_RELATIVE_ERROR);
      });
    });
    context('three tokens', () => {
      it('returns invariant', async () => {
        const normalizedWeights = [bn(0.3e18), bn(0.2e18), bn(0.5e18)];
        const balances = [bn(10e18), bn(12e18), bn(14e18)];

        const result = await mock.invariant(normalizedWeights, balances);
        const expectedInvariant = calculateInvariant(balances, normalizedWeights);

        expectEqualWithError(result, bn(expectedInvariant), MAX_RELATIVE_ERROR);
      });
    });
  });

  describe('Simple swap', () => {
    it('outGivenIn', async () => {
      const tokenBalanceIn = bn(100e18);
      const tokenWeightIn = bn(50e18);
      const tokenBalanceOut = bn(100e18);
      const tokenWeightOut = bn(40e18);
      const tokenAmountIn = bn(15e18);

      const outAmountMath = calcOutGivenIn(
        tokenBalanceIn,
        tokenWeightIn,
        tokenBalanceOut,
        tokenWeightOut,
        tokenAmountIn
      );
      const outAmountPool = await mock.outGivenIn(
        tokenBalanceIn,
        tokenWeightIn,
        tokenBalanceOut,
        tokenWeightOut,
        tokenAmountIn
      );
      expectEqualWithError(outAmountPool, bn(outAmountMath.toFixed(0)), MAX_RELATIVE_ERROR);
    });

    it('inGivenOut', async () => {
      const tokenBalanceIn = bn(100e18);
      const tokenWeightIn = bn(50e18);
      const tokenBalanceOut = bn(100e18);
      const tokenWeightOut = bn(40e18);
      const tokenAmountOut = bn(15e18);

      const inAmountMath = calcInGivenOut(
        tokenBalanceIn,
        tokenWeightIn,
        tokenBalanceOut,
        tokenWeightOut,
        tokenAmountOut
      );
      const inAmountPool = await mock.inGivenOut(
        tokenBalanceIn,
        tokenWeightIn,
        tokenBalanceOut,
        tokenWeightOut,
        tokenAmountOut
      );
      expectEqualWithError(inAmountPool, bn(inAmountMath.toFixed(0)), MAX_RELATIVE_ERROR);
    });
  });

  describe('Extreme amounts', () => {
    it('outGivenIn - min amount in', async () => {
      const tokenBalanceIn = bn(100e18);
      const tokenWeightIn = bn(50e18);
      const tokenBalanceOut = bn(100e18);
      const tokenWeightOut = bn(40e18);
      const tokenAmountIn = bn(10e6); // (MIN AMOUNT = 0.00000000001)

      const outAmountMath = calcOutGivenIn(
        tokenBalanceIn,
        tokenWeightIn,
        tokenBalanceOut,
        tokenWeightOut,
        tokenAmountIn
      );
      const outAmountPool = await mock.outGivenIn(
        tokenBalanceIn,
        tokenWeightIn,
        tokenBalanceOut,
        tokenWeightOut,
        tokenAmountIn
      );
      //TODO: review high rel error for small amount
      expectEqualWithError(outAmountPool, bn(outAmountMath.toFixed(0)), 0.1);
    });

    it('inGivenOut - min amount out', async () => {
      const tokenBalanceIn = bn(100e18);
      const tokenWeightIn = bn(50e18);
      const tokenBalanceOut = bn(100e18);
      const tokenWeightOut = bn(40e18);
      const tokenAmountOut = bn(10e6); // (MIN AMOUNT = 0.00000000001)

      const inAmountMath = calcInGivenOut(
        tokenBalanceIn,
        tokenWeightIn,
        tokenBalanceOut,
        tokenWeightOut,
        tokenAmountOut
      );
      const inAmountPool = await mock.inGivenOut(
        tokenBalanceIn,
        tokenWeightIn,
        tokenBalanceOut,
        tokenWeightOut,
        tokenAmountOut
      );
      //TODO: review high rel error for small amount
      expectEqualWithError(inAmountPool, bn(inAmountMath.toFixed(0)), 0.5);
    });
  });

  describe('Extreme weights', () => {
    it('outGivenIn - max weights relation', async () => {
      //Weight relation = 130.07

      const tokenBalanceIn = bn(100e18);
      const tokenWeightIn = bn(130.7e18);
      const tokenBalanceOut = bn(100e18);
      const tokenWeightOut = bn(1e18);
      const tokenAmountIn = bn(15e18);

      const outAmountMath = calcOutGivenIn(
        tokenBalanceIn,
        tokenWeightIn,
        tokenBalanceOut,
        tokenWeightOut,
        tokenAmountIn
      );
      const outAmountPool = await mock.outGivenIn(
        tokenBalanceIn,
        tokenWeightIn,
        tokenBalanceOut,
        tokenWeightOut,
        tokenAmountIn
      );
      expectEqualWithError(outAmountPool, bn(outAmountMath.toFixed(0)), MAX_RELATIVE_ERROR);
    });

    it('outGivenIn - min weights relation', async () => {
      //Weight relation = 0.00769

      const tokenBalanceIn = bn(100e18);
      const tokenWeightIn = bn(0.00769e18);
      const tokenBalanceOut = bn(100e18);
      const tokenWeightOut = bn(1e18);
      const tokenAmountIn = bn(15e18);

      const outAmountMath = calcOutGivenIn(
        tokenBalanceIn,
        tokenWeightIn,
        tokenBalanceOut,
        tokenWeightOut,
        tokenAmountIn
      );
      const outAmountPool = await mock.outGivenIn(
        tokenBalanceIn,
        tokenWeightIn,
        tokenBalanceOut,
        tokenWeightOut,
        tokenAmountIn
      );
      expectEqualWithError(outAmountPool, bn(outAmountMath.toFixed(0)), MAX_RELATIVE_ERROR);
    });
  });

  context('protocol swap fees', () => {
    context('two tokens', () => {
      it('returns protocol swap fees', async () => {
        const normalizedWeights = [bn(0.3e18), bn(0.7e18)];
        const balances = [bn(10e18), bn(11e18)];
        const lastInvariant = bn(10e18);
        const tokenIndex = 1;

        const currentInvariant = calculateInvariant(balances, normalizedWeights);
        const protocolSwapFeePercentage = fp(0.1);

        const result = await mock.calculateDueTokenProtocolSwapFeeAmount(
          balances[tokenIndex],
          normalizedWeights[tokenIndex],
          lastInvariant,
          currentInvariant,
          protocolSwapFeePercentage
        );

        const expectedFeeAmount = calculateOneTokenSwapFeeAmount(
          balances,
          normalizedWeights,
          lastInvariant,
          tokenIndex
        );
        const expectedProtocolFeeAmount = expectedFeeAmount.mul(decimal(protocolSwapFeePercentage).div(1e18));

        expectEqualWithError(result, bn(expectedProtocolFeeAmount.toFixed(0)), MAX_RELATIVE_ERROR);
      });

      context('with large accumulated fees', () => {
        it('caps the invariant growth', async () => {
          const normalizedWeights = [bn(0.3e18), bn(0.7e18)];
          const balances = [bn(10e18), bn(11e18)];
          const tokenIndex = 1;

          const currentInvariant = calculateInvariant(balances, normalizedWeights);
          const protocolSwapFeePercentage = fp(0.1);

          // The last to current ratio is 1:2, which is larger than the math libraries can handle. This will be capped
          // to 0.7:1.
          const lastInvariant = currentInvariant.div(2);
          const cappedLastInvariant = currentInvariant.mul(fp(0.7)).div(fp(1));

          const result = await mock.calculateDueTokenProtocolSwapFeeAmount(
            balances[tokenIndex],
            normalizedWeights[tokenIndex],
            lastInvariant,
            currentInvariant,
            protocolSwapFeePercentage
          );

          const expectedFeeAmount = calculateOneTokenSwapFeeAmount(
            balances,
            normalizedWeights,
            cappedLastInvariant,
            tokenIndex
          );
          const expectedProtocolFeeAmount = expectedFeeAmount.mul(decimal(protocolSwapFeePercentage).div(1e18));

          expectEqualWithError(result, bn(expectedProtocolFeeAmount.toFixed(0)), MAX_RELATIVE_ERROR);
        });
      });
    });

    context('three tokens', () => {
      it('returns protocol swap fees', async () => {
        const normalizedWeights = [bn(0.3e18), bn(0.2e18), bn(0.5e18)];
        const balances = [bn(10e18), bn(11e18), bn(12e18)];
        const lastInvariant = bn(10e18);
        const tokenIndex = 2;

        const currentInvariant = calculateInvariant(balances, normalizedWeights);
        const protocolSwapFeePercentage = fp(0.1);

        const result = await mock.calculateDueTokenProtocolSwapFeeAmount(
          balances[tokenIndex],
          normalizedWeights[tokenIndex],
          lastInvariant,
          currentInvariant,
          protocolSwapFeePercentage
        );

        const expectedFeeAmount = calculateOneTokenSwapFeeAmount(
          balances,
          normalizedWeights,
          lastInvariant,
          tokenIndex
        );
        const expectedProtocolFeeAmount = expectedFeeAmount.mul(decimal(protocolSwapFeePercentage).div(1e18));

        expectEqualWithError(result, bn(expectedProtocolFeeAmount.toFixed(0)), MAX_RELATIVE_ERROR);
      });
    });
  });
});
