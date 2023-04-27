import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { calculateInvariant } from '@balancer-labs/v2-helpers/src/models/pools/weighted/math';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { bn, fp, fpDiv, FP_100_PCT, FP_ZERO } from '@balancer-labs/v2-helpers/src/numbers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { ethers } from 'hardhat';
import { random, range } from 'lodash';

export function itPaysProtocolFeesFromInvariantGrowth(): void {
  const MAX_TOKENS = 8;
  const WEIGHTS = range(1000, 1000 + MAX_TOKENS); // These will be normalized to weights that are close to each other, but different
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  const numTokens = MAX_TOKENS;

  let vault: Vault;
  let pool: WeightedPool;
  let tokens: TokenList;
  let rateProviders: Contract[];
  let protocolFeesCollector: string;

  let lp: SignerWithAddress;

  describe('invariant growth protocol fees', () => {
    before('setup', async () => {
      [, lp] = await ethers.getSigners();
    });

    const protocolFeePercentage = fp(0.3); // 30 %
    const initialBalances = range(1, numTokens + 1).map(fp);
    const initialBalanceGrowth = bn(3);

    sharedBeforeEach(async () => {
      vault = await Vault.create({ mocked: true });
      tokens = await TokenList.create(numTokens, { sorted: true, varyDecimals: true });
      rateProviders = await tokens.asyncMap(() => deploy('v2-pool-utils/MockRateProvider'));

      await vault.setSwapFeePercentage(protocolFeePercentage);
      ({ address: protocolFeesCollector } = await vault.getFeesCollector());

      pool = await WeightedPool.create({
        vault,
        tokens,
        weights: WEIGHTS.slice(0, numTokens),
        rateProviders,
        swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
      });
    });

    describe('last post join/exit invariant', () => {
      it('is set on initialization', async () => {
        await pool.init({ initialBalances });
        expectEqualWithError(await pool.getLastPostJoinExitInvariant(), await pool.estimateInvariant());
      });

      context('once initialized and with accumulated fees', () => {
        sharedBeforeEach('initialize pool', async () => {
          await pool.init({ initialBalances, recipient: lp });
        });

        sharedBeforeEach('accumulate fees by increasing balance', async () => {
          await pool.vault.updateCash(
            pool.poolId,
            initialBalances.map((x) => x.mul(initialBalanceGrowth))
          );
        });

        itIsUpdatedByJoins();

        itIsUpdatedByExits();

        function itIsUpdatedByJoins() {
          it('is updated by joins', async () => {
            // We only test with a proportional join, since all joins are treated equally
            await pool.join({
              data: WeightedPoolEncoder.joinAllTokensInForExactBPTOut((await pool.totalSupply()).div(2)),
              from: lp,
            });

            expectEqualWithError(await pool.getLastPostJoinExitInvariant(), await pool.estimateInvariant());
          });
        }

        function itIsUpdatedByExits() {
          it('is updated by exits', async () => {
            // We only test with a proportional exit, since all exits are treated equally.
            await pool.exit({
              data: WeightedPoolEncoder.exitExactBPTInForTokensOut((await pool.totalSupply()).div(2)),
              from: lp,
            });

            expectEqualWithError(await pool.getLastPostJoinExitInvariant(), await pool.estimateInvariant());
          });
        }
      });
    });

    describe('ath rate product', () => {
      context('when the pool is exempt from yield fees', () => {
        let yieldFeeExemptPool: WeightedPool;

        sharedBeforeEach(async () => {
          yieldFeeExemptPool = await WeightedPool.create({
            tokens,
            weights: WEIGHTS.slice(0, numTokens),
            swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          });
        });

        it('is not set on initialization', async () => {
          await yieldFeeExemptPool.init({ initialBalances });

          expect(await yieldFeeExemptPool.instance.getATHRateProduct()).to.be.eq(0);
        });
      });

      context('when the pool pays yield fees', () => {
        it('is set on initialization', async () => {
          await pool.init({ initialBalances });

          const rates = pool.weights.map(() => FP_100_PCT);
          const expectedRateProduct = calculateInvariant(rates, pool.weights);
          expect(await pool.instance.getATHRateProduct()).to.be.almostEqual(expectedRateProduct, 0.0000001);
        });

        context('once initialized', () => {
          sharedBeforeEach('initialize pool', async () => {
            await pool.init({ initialBalances, recipient: lp });
          });

          context('when rates increase', () => {
            let expectedRateProduct: BigNumber;
            sharedBeforeEach('accumulate fees by increasing balance', async () => {
              const rates = rateProviders.map(() => fp(random(1.0, 5.0)));

              for (const [index, provider] of rateProviders.entries()) {
                if (typeof provider !== 'string') await provider.mockRate(rates[index]);
              }

              expectedRateProduct = calculateInvariant(rates, pool.weights);
            });

            it('is updated by joins', async () => {
              // We only test with a proportional join, since all joins are treated equally
              await pool.join({
                data: WeightedPoolEncoder.joinAllTokensInForExactBPTOut((await pool.totalSupply()).div(2)),
                from: lp,
              });

              expectEqualWithError(await pool.instance.getATHRateProduct(), expectedRateProduct);
            });

            it('is updated by exits', async () => {
              // We only test with a proportional exit, since all exits are treated equally.
              await pool.exit({
                data: WeightedPoolEncoder.exitExactBPTInForTokensOut((await pool.totalSupply()).div(2)),
                from: lp,
              });

              expectEqualWithError(await pool.instance.getATHRateProduct(), expectedRateProduct);
            });
          });

          context('when rates decrease', () => {
            let expectedRateProduct: BigNumber;
            sharedBeforeEach('accumulate fees by increasing balance', async () => {
              const rates = rateProviders.map(() => fp(random(0.5, 1.0)));

              for (const [index, provider] of rateProviders.entries()) {
                if (typeof provider !== 'string') await provider.mockRate(rates[index]);
              }

              expectedRateProduct = await pool.instance.getATHRateProduct();
            });

            it('is unaffected by joins', async () => {
              // We only test with a proportional join, since all joins are treated equally
              await pool.join({
                data: WeightedPoolEncoder.joinAllTokensInForExactBPTOut((await pool.totalSupply()).div(2)),
                from: lp,
              });

              expectEqualWithError(await pool.instance.getATHRateProduct(), expectedRateProduct);
            });

            it('is unaffected by exits', async () => {
              // We only test with a proportional exit, since all exits are treated equally.
              await pool.exit({
                data: WeightedPoolEncoder.exitExactBPTInForTokensOut((await pool.totalSupply()).div(2)),
                from: lp,
              });

              expectEqualWithError(await pool.instance.getATHRateProduct(), expectedRateProduct);
            });
          });
        });
      });
    });

    describe('protocol fees', () => {
      async function protocolFeesPaid(): Promise<BigNumber> {
        const previousProtocolFeeCollectorBalance = await pool.balanceOf(protocolFeesCollector);

        // We trigger protocol fee payment by executing a proportional exit for 0 BPT
        await pool.exit({
          data: WeightedPoolEncoder.exitExactBPTInForTokensOut(FP_ZERO),
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
          await pool.vault.updateCash(
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

            const bptOwnership = fpDiv(fees, totalBPT);
            const expectedOwnership = initialBalanceGrowth.sub(1).mul(protocolFeePercentage).div(initialBalanceGrowth);

            await expectEqualWithError(bptOwnership, expectedOwnership);
          });

          it('does not pay fees again until more are accumulated', async () => {
            await protocolFeesPaid();

            const secondPayment = await protocolFeesPaid();
            expect(secondPayment).to.equal(0);
          });
        });
      });
    });
  });
}
