import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { bn, decimal, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import {
  calculateAnalyticalInvariantForTwoTokens,
  calculateInvariant,
  calcInGivenOut,
  calcOutGivenIn,
  calculateOneTokenSwapFeeAmount,
} from '@balancer-labs/v2-helpers/src/models/pools/stable/math';

const MAX_RELATIVE_ERROR = 0.001; //Max relative error

// TODO: Test this math by checking extremes values for the amplification field (0 and infinite)
// to verify that it equals constant sum and constant product (weighted) invariants.

describe('StableMath', function () {
  let mock: Contract;

  before(async function () {
    mock = await deploy('MockStableMath');
  });

  context('invariant', () => {
    context('two tokens', () => {
      it('returns invariant', async () => {
        const amp = bn(100);
        const balances = [fp(10), fp(12)];

        const result = await mock.invariant(amp, balances);
        const expectedInvariant = calculateInvariant(balances, amp);

        expectEqualWithError(result, expectedInvariant, MAX_RELATIVE_ERROR);
      });
      it('returns invariant equals analytical solution', async () => {
        const amp = bn(100);
        const balances = [fp(10), fp(12)];

        const result = await mock.invariant(amp, balances);
        const expectedInvariant = calculateAnalyticalInvariantForTwoTokens(balances, amp);

        expectEqualWithError(result, expectedInvariant, MAX_RELATIVE_ERROR);
      });
    });
    context('three tokens', () => {
      it('returns invariant', async () => {
        const amp = bn(100);
        const balances = [fp(10), fp(12), fp(14)];

        const result = await mock.invariant(amp, balances);
        const expectedInvariant = calculateInvariant(balances, amp);

        expectEqualWithError(result, expectedInvariant, MAX_RELATIVE_ERROR);
      });
    });
  });

  context('in given out', () => {
    context('two tokens', () => {
      it('returns in given out', async () => {
        const amp = bn(100);
        const balances = [fp(10), fp(12)];
        const tokenIndexIn = 0;
        const tokenIndexOut = 1;
        const amountOut = fp(1);

        const result = await mock.inGivenOut(amp, balances, tokenIndexIn, tokenIndexOut, amountOut);
        const expectedAmountIn = calcInGivenOut(balances, amp, tokenIndexIn, tokenIndexOut, amountOut);

        expectEqualWithError(result, bn(expectedAmountIn.toFixed(0)), MAX_RELATIVE_ERROR);
      });
    });
    context('three tokens', () => {
      it('returns in given out', async () => {
        const amp = bn(100);
        const balances = [fp(10), fp(12), fp(14)];
        const tokenIndexIn = 0;
        const tokenIndexOut = 1;
        const amountOut = fp(1);

        const result = await mock.inGivenOut(amp, balances, tokenIndexIn, tokenIndexOut, amountOut);
        const expectedAmountIn = calcInGivenOut(balances, amp, tokenIndexIn, tokenIndexOut, amountOut);

        expectEqualWithError(result, bn(expectedAmountIn.toFixed(0)), MAX_RELATIVE_ERROR);
      });
    });
  });

  context('out given in', () => {
    context('two tokens', () => {
      it('returns out given in', async () => {
        const amp = bn(10);
        const balances = [fp(10), fp(11)];
        const tokenIndexIn = 0;
        const tokenIndexOut = 1;
        const amountIn = fp(1);

        const result = await mock.outGivenIn(amp, balances, tokenIndexIn, tokenIndexOut, amountIn);
        const expectedAmountOut = calcOutGivenIn(balances, amp, tokenIndexIn, tokenIndexOut, amountIn);

        expectEqualWithError(result, bn(expectedAmountOut.toFixed(0)), MAX_RELATIVE_ERROR);
      });
    });
    context('three tokens', () => {
      it('returns out given in', async () => {
        const amp = bn(10);
        const balances = [fp(10), fp(11), fp(12)];
        const tokenIndexIn = 0;
        const tokenIndexOut = 1;
        const amountIn = fp(1);

        const result = await mock.outGivenIn(amp, balances, tokenIndexIn, tokenIndexOut, amountIn);
        const expectedAmountOut = calcOutGivenIn(balances, amp, tokenIndexIn, tokenIndexOut, amountIn);

        expectEqualWithError(result, bn(expectedAmountOut.toFixed(0)), MAX_RELATIVE_ERROR);
      });
    });
  });

  context('protocol swap fees', () => {
    context('two tokens', () => {
      it('returns protocol swap fees', async () => {
        const amp = bn(100);
        const balances = [fp(10), fp(11)];
        const lastInvariant = fp(10);
        const tokenIndex = 0;

        const protocolSwapFeePercentage = fp(0.1);

        const result = await mock.calculateDueTokenProtocolSwapFeeAmount(
          amp,
          balances,
          lastInvariant,
          tokenIndex,
          protocolSwapFeePercentage
        );

        const expectedFeeAmount = calculateOneTokenSwapFeeAmount(balances, amp, lastInvariant, tokenIndex);
        const expectedProtocolFeeAmount = expectedFeeAmount.mul(decimal(protocolSwapFeePercentage).div(1e18));

        expectEqualWithError(result, bn(expectedProtocolFeeAmount.toFixed(0)), MAX_RELATIVE_ERROR);
      });
    });
    context('three tokens', () => {
      it('returns protocol swap fees', async () => {
        const amp = bn(100);
        const balances = [fp(10), fp(11), fp(12)];
        const lastInvariant = fp(10);
        const tokenIndex = 0;

        const protocolSwapFeePercentage = fp(0.1);

        const result = await mock.calculateDueTokenProtocolSwapFeeAmount(
          amp,
          balances,
          lastInvariant,
          tokenIndex,
          protocolSwapFeePercentage
        );
        const expectedFeeAmount = calculateOneTokenSwapFeeAmount(balances, amp, lastInvariant, tokenIndex);

        const expectedProtocolFeeAmount = expectedFeeAmount.mul(decimal(protocolSwapFeePercentage).div(1e18));

        expectEqualWithError(result, bn(expectedProtocolFeeAmount.toFixed(0)), MAX_RELATIVE_ERROR);
      });
    });
  });
});
