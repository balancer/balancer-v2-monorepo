import { Contract } from 'ethers';

import { bn, fp, FP_SCALING_FACTOR } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import {
  calculateInvariant,
  calcInGivenOut,
  calcOutGivenIn,
  calculateBPTSwapFeeFeeAmount,
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
    context('with invariant growth', () => {
      it('returns protocol swap fees', async () => {
        const normalizedWeights = [bn(0.3e18), bn(0.7e18)];
        const lastBalances = [bn(25e18), bn(500e18)];

        // Both balances increase by 40%
        const currentBalances = [bn(35e18), bn(700e18)];

        const protocolSwapFeePercentage = fp(0.3);
        // The protocol is due 30% of the 10 extra tokens in token A (3 tokens), and 30% of the 200 extra tokens in token B
        // (60 tokens).

        const totalSupply = fp(100);

        const lastInvariant = calculateInvariant(lastBalances, normalizedWeights);
        const currentInvariant = calculateInvariant(currentBalances, normalizedWeights);

        const toMint = await mock.calculateDueProtocolSwapFeeBPTAmount(
          totalSupply,
          lastInvariant,
          currentInvariant,
          protocolSwapFeePercentage
        );

        // The BPT to mint should be such that it'd let the protocol claim the tokens it is due if exiting proportionally
        const protocolPoolOwnership = toMint.mul(FP_SCALING_FACTOR).div(totalSupply.add(toMint)); // The BPT supply grows

        const tokenAFeeAmount = currentBalances[0].mul(protocolPoolOwnership).div(FP_SCALING_FACTOR);
        const tokenBFeeAmount = currentBalances[1].mul(protocolPoolOwnership).div(FP_SCALING_FACTOR);

        expectEqualWithError(tokenAFeeAmount, bn(3e18), MAX_RELATIVE_ERROR);
        expectEqualWithError(tokenBFeeAmount, bn(60e18), MAX_RELATIVE_ERROR);

        // The TS helper outputs the same value

        const expectedToMint = calculateBPTSwapFeeFeeAmount(
          totalSupply,
          lastInvariant,
          currentInvariant,
          protocolSwapFeePercentage
        );

        expectEqualWithError(toMint, fp(expectedToMint), MAX_RELATIVE_ERROR);
      });
    });

    context('with smaller invariant', async () => {
      const protocolSwapFeePercentage = fp(0.3);
      const totalSupply = fp(100);

      const lastInvariant = fp(300);
      const currentInvariant = fp(299);

      const toMint = await mock.calculateDueProtocolSwapFeeBPTAmount(
        totalSupply,
        lastInvariant,
        currentInvariant,
        protocolSwapFeePercentage
      );

      expect(toMint).to.equal(0);
    });
  });
});
