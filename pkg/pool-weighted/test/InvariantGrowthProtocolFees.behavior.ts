import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { range } from 'lodash';

export function itPaysProtocolFeesFromInvariantGrowth(type: WeightedPoolType): void {
  const MAX_TOKENS = 10;
  const WEIGHTS = range(1000, 1000 + MAX_TOKENS); // These will be normalized to weights that are close to each other, but different
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  const numTokens = type == WeightedPoolType.ORACLE_WEIGHTED_POOL ? 2 : MAX_TOKENS;

  let pool: WeightedPool;
  let tokens: TokenList;

  let lp: SignerWithAddress;

  before('setup', async () => {
    [, lp] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    tokens = await TokenList.create(numTokens, { sorted: true, varyDecimals: true });

    pool = await WeightedPool.create({
      poolType: WeightedPoolType.WEIGHTED_POOL,
      tokens,
      weights: WEIGHTS.slice(0, numTokens),
      swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
    });
  });

  describe('invariant growth protocol fees', () => {
    const protocolFeePercentage = fp(0.3); // 30 %
    const initialBalances = range(1, numTokens + 1).map(fp);

    describe('last post join/exit invariant', () => {
      it('is set on initialization', async () => {
        await pool.init({ initialBalances });
        expectEqualWithError(await pool.getLastInvariant(), await pool.estimateInvariant());
      });

      context('once initialized and with accumulated fees', () => {
        sharedBeforeEach('initialize pool', async () => {
          await pool.init({ initialBalances, recipient: lp });
        });

        sharedBeforeEach('accumulate fees by increasing balance', async () => {
          await pool.vault.updateBalances(
            pool.poolId,
            initialBalances.map((x) => x.mul(2))
          );
        });

        context('when not paused', () => {
          itIsUpdatedByJoins();

          itIsUpdatedByExits();
        });

        context('when paused', () => {
          sharedBeforeEach(async () => {
            await pool.pause();
          });

          // Joins are disabled while paused
          itIsUpdatedByExits();
        });

        function itIsUpdatedByJoins() {
          it('is updated by joins', async () => {
            // We only test with a proportional join, since all joins are treated equally
            await pool.join({
              data: WeightedPoolEncoder.joinAllTokensInForExactBPTOut(fp(1)),
              from: lp,
            });

            expectEqualWithError(await pool.getLastInvariant(), await pool.estimateInvariant());
          });
        }

        function itIsUpdatedByExits() {
          it('is updated by exits', async () => {
            // We only test with a proportional exit, since all exits are treated equally and proportional exits remain
            // enabled while paused
            await pool.exit({
              data: WeightedPoolEncoder.exitExactBPTInForTokensOut(fp(1)),
              from: lp,
            });

            expectEqualWithError(await pool.getLastInvariant(), await pool.estimateInvariant());
          });
        }
      });
    });

    function itPaysProtocolFees() {}

    function itDoesNotPayProtocolFees() {}

    describe('joins and exits', () => {
      describe('proportional', () => {
        itDoesNotPayProtocolFees();
      });

      describe('single token', () => {
        itDoesNotPayProtocolFees();
      });
    });

    describe('swaps', () => {
      context('when paused', () => {});

      context('when not paused', () => {});
    });

    // context('with previous swap', () => {
    //   let currentBalances: BigNumber[], expectedDueProtocolFeeAmounts: BigNumber[];

    //   sharedBeforeEach('simulate doubled initial balances ', async () => {
    //     // 4/3 of the initial balances
    //     currentBalances = initialBalances.map((balance) => balance.mul(4).div(3));
    //   });

    //   sharedBeforeEach('compute expected due protocol fees', async () => {
    //     const paidTokenIndex = pool.weights.indexOf(pool.maxWeight);
    //     const protocolFeeAmount = await pool.estimateSwapFeeAmount(
    //       paidTokenIndex,
    //       protocolFeePercentage,
    //       currentBalances
    //     );
    //     expectedDueProtocolFeeAmounts = ZEROS.map((n, i) => (i === paidTokenIndex ? protocolFeeAmount : n));
    //   });

    //   it('pays swap protocol fees on join exact tokens in for BPT out', async () => {
    //     const result = await pool.joinGivenIn({ from: lp, amountsIn: fp(1), currentBalances, protocolFeePercentage });

    //     expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.1);
    //   });

    //   it('pays swap protocol fees on exit exact BPT in for one token out', async () => {
    //     const result = await pool.singleExitGivenIn({
    //       from: lp,
    //       bptIn: fp(0.5),
    //       token: 0,
    //       currentBalances,
    //       protocolFeePercentage,
    //     });

    //     expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.1);
    //   });

    //   it('pays swap protocol fees on exit exact BPT in for all tokens out', async () => {
    //     const result = await pool.multiExitGivenIn({
    //       from: lp,
    //       bptIn: fp(1),
    //       currentBalances,
    //       protocolFeePercentage,
    //     });

    //     expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.1);
    //   });

    //   it('pays swap protocol fees on exit BPT In for exact tokens out', async () => {
    //     const result = await pool.exitGivenOut({
    //       from: lp,
    //       amountsOut: fp(1),
    //       currentBalances,
    //       protocolFeePercentage,
    //     });

    //     expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.1);
    //   });

    //   it('does not charges fee on exit if paused', async () => {
    //     await pool.pause();

    //     const exitResult = await pool.multiExitGivenIn({ from: lp, bptIn: fp(0.5), protocolFeePercentage });
    //     expect(exitResult.dueProtocolFeeAmounts).to.be.zeros;
    //   });
    // });
  });
}
