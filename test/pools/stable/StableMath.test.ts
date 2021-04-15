import { deploy } from '../../../lib/helpers/deploy';
import {
  calculateAnalyticalInvariantForTwoTokens,
  calculateInvariant,
  calcInGivenOut,
  calcOutGivenIn,
  calculateOneTokenSwapFeeAmount,
} from '../../helpers/math/stable';
import { expectEqualWithError } from '../../helpers/relativeError';
import { bn, decimal, fp } from '../../../lib/helpers/numbers';
import { Contract } from 'ethers';

const MAX_RELATIVE_ERROR = 0.001; //Max relative error

//TODO: Test this math by checking  extremes values for the amplification field (0 and infinite)
//to verify that it equals constant sum and constant product (weighted) invariants.

describe('StableMath', function () {
  let mock: Contract;

  before(async function () {
    mock = await deploy('MockStableMath');
  });

  context('invariant', () => {
    context('two tokens', () => {
      it('returns invariant', async () => {
        const amp = bn(100e18);
        const balances = [bn(10e18), bn(12e18)];

        const result = await mock.invariant(amp, balances);
        const expectedInvariant = calculateInvariant(balances, amp);

        expectEqualWithError(result, expectedInvariant, MAX_RELATIVE_ERROR);
      });
      it('returns invariant equals analytical solution', async () => {
        const amp = bn(100e18);
        const balances = [bn(10e18), bn(12e18)];

        const result = await mock.invariant(amp, balances);
        const expectedInvariant = calculateAnalyticalInvariantForTwoTokens(balances, amp);

        expectEqualWithError(result, expectedInvariant, MAX_RELATIVE_ERROR);
      });
    });
    context('three tokens', () => {
      it('returns invariant', async () => {
        const amp = bn(100e18);
        const balances = [bn(10e18), bn(12e18), bn(14e18)];

        const result = await mock.invariant(amp, balances);
        const expectedInvariant = calculateInvariant(balances, amp);

        expectEqualWithError(result, expectedInvariant, MAX_RELATIVE_ERROR);
      });
    });
  });

  context('in given out', () => {
    context('two tokens', () => {
      it('returns in given out', async () => {
        const amp = bn(100e18);
        const balances = [bn(10e18), bn(12e18)];
        const tokenIndexIn = 0;
        const tokenIndexOut = 1;
        const amountOut = bn(1e18);

        const result = await mock.inGivenOut(amp, balances, tokenIndexIn, tokenIndexOut, amountOut);
        const expectedAmountIn = calcInGivenOut(balances, amp, tokenIndexIn, tokenIndexOut, amountOut);

        expectEqualWithError(result, bn(expectedAmountIn.toFixed(0)), MAX_RELATIVE_ERROR);
      });
    });
    context('three tokens', () => {
      it('returns in given out', async () => {
        const amp = bn(100e18);
        const balances = [bn(10e18), bn(12e18), bn(14e18)];
        const tokenIndexIn = 0;
        const tokenIndexOut = 1;
        const amountOut = bn(1e18);

        const result = await mock.inGivenOut(amp, balances, tokenIndexIn, tokenIndexOut, amountOut);
        const expectedAmountIn = calcInGivenOut(balances, amp, tokenIndexIn, tokenIndexOut, amountOut);

        expectEqualWithError(result, bn(expectedAmountIn.toFixed(0)), MAX_RELATIVE_ERROR);
      });
    });
  });

  context('out given in', () => {
    context('two tokens', () => {
      it('returns out given in', async () => {
        const amp = bn(10e18);
        const balances = [bn(10e18), bn(11e18)];
        const tokenIndexIn = 0;
        const tokenIndexOut = 1;
        const amountIn = bn(1e18);

        const result = await mock.outGivenIn(amp, balances, tokenIndexIn, tokenIndexOut, amountIn);
        const expectedAmountOut = calcOutGivenIn(balances, amp, tokenIndexIn, tokenIndexOut, amountIn);

        expectEqualWithError(result, bn(expectedAmountOut.toFixed(0)), MAX_RELATIVE_ERROR);
      });
    });
    context('three tokens', () => {
      it('returns out given in', async () => {
        const amp = bn(10e18);
        const balances = [bn(10e18), bn(11e18), bn(12e18)];
        const tokenIndexIn = 0;
        const tokenIndexOut = 1;
        const amountIn = bn(1e18);

        const result = await mock.outGivenIn(amp, balances, tokenIndexIn, tokenIndexOut, amountIn);
        const expectedAmountOut = calcOutGivenIn(balances, amp, tokenIndexIn, tokenIndexOut, amountIn);

        expectEqualWithError(result, bn(expectedAmountOut.toFixed(0)), MAX_RELATIVE_ERROR);
      });
    });
  });

  context('protocol swap fees', () => {
    context('two tokens', () => {
      it('returns protocol swap fees', async () => {
        const amp = bn(100e18);
        const balances = [bn(10e18), bn(11e18)];
        const lastInvariant = bn(10e18);
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
        const amp = bn(100e18);
        const balances = [bn(10e18), bn(11e18), bn(12e18)];
        const lastInvariant = bn(10e18);
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
