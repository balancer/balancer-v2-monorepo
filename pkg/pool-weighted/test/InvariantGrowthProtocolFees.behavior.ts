import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { bn, fp, FP_SCALING_FACTOR } from '@balancer-labs/v2-helpers/src/numbers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { range } from 'lodash';

export function itPaysProtocolFeesFromInvariantGrowth(): void {
  const MAX_TOKENS = 10;
  const WEIGHTS = range(1000, 1000 + MAX_TOKENS); // These will be normalized to weights that are close to each other, but different
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  const numTokens = MAX_TOKENS;

  let pool: WeightedPool;
  let tokens: TokenList;
  let protocolFeesCollector: string;

  let lp: SignerWithAddress;

  describe('invariant growth protocol fees', () => {
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

      ({ address: protocolFeesCollector } = await pool.vault.getFeesCollector());
    });

    const protocolFeePercentage = fp(0.3); // 30 %
    const initialBalances = range(1, numTokens + 1).map(fp);
    const initialBalanceGrowth = bn(3);

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
            initialBalances.map((x) => x.mul(initialBalanceGrowth))
          );
        });

        context('when not paused', () => {
          itIsUpdatedByJoins();

          itIsUpdatedByExits();
        });

        context.skip('when paused', () => {
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
              data: WeightedPoolEncoder.joinAllTokensInForExactBPTOut((await pool.totalSupply()).div(2)),
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
              data: WeightedPoolEncoder.exitExactBPTInForTokensOut((await pool.totalSupply()).div(2)),
              from: lp,
            });

            expectEqualWithError(await pool.getLastInvariant(), await pool.estimateInvariant());
          });
        }
      });
    });

    describe('protocol fees', () => {
      async function protocolFeesPaid(): Promise<BigNumber> {
        const previousProtocolFeeCollectorBalance = await pool.balanceOf(protocolFeesCollector);

        // We trigger protocol fee payment by executing a proportional exit (which works even while paused) for 0 BPT
        await pool.exit({
          data: WeightedPoolEncoder.exitExactBPTInForTokensOut(fp(0)),
          protocolFeePercentage,
        });

        const currentProtocolFeeCollectorBalance = await pool.balanceOf(protocolFeesCollector);
        return currentProtocolFeeCollectorBalance.sub(previousProtocolFeeCollectorBalance);
      }

      context('once initialized and with accumulated fees', () => {
        sharedBeforeEach('initialize pool', async () => {
          await pool.init({ initialBalances, recipient: lp });
        });

        sharedBeforeEach('accumulate fees by increasing balance', async () => {
          await pool.vault.updateBalances(
            pool.poolId,
            initialBalances.map((x) => x.mul(initialBalanceGrowth))
          );
        });

        context('when not paused', () => {
          it('pays protocol fees', async () => {
            const fees = await protocolFeesPaid();
            const totalBPT = await pool.totalSupply();

            // Balances increased by initialBalanceGrowth, and protocol was due protocolFeePercentage of that. It should
            // therefore have been paid (initialBalanceGrowth - 1) * protocolFeePercentage / initialBalanceGrowth of the
            // total BPT.

            const bptOwnership = fees.mul(FP_SCALING_FACTOR).div(totalBPT);
            const expectedOwnership = initialBalanceGrowth.sub(1).mul(protocolFeePercentage).div(initialBalanceGrowth);

            await expectEqualWithError(bptOwnership, expectedOwnership);
          });

          it('does not pay fees again until more are accumulated', async () => {
            await protocolFeesPaid();

            const secondPayment = await protocolFeesPaid();
            expect(secondPayment).to.equal(0);
          });
        });

        context.skip('when paused', () => {
          sharedBeforeEach(async () => {
            await pool.pause();
          });

          it('does not pay protocol fees', async () => {
            expect(await protocolFeesPaid()).to.equal(0);
          });
        });
      });
    });
  });
}
