import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { DAY } from '@balancer-labs/v2-helpers/src/time';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import { every, random, range } from 'lodash';
import { calculateInvariant } from '@balancer-labs/v2-helpers/src/models/pools/stable-phantom/math';

describe('StablePoolProtocolFees', () => {
  let admin: SignerWithAddress;
  let vault: Vault, feesCollector: Contract, feesProvider: Contract;

  const AMPLIFICATION_PRECISION = 1e3;
  const AMPLIFICATION_FACTOR = bn(200).mul(AMPLIFICATION_PRECISION);

  sharedBeforeEach('setup signers', async () => {
    [, admin] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault', async () => {
    vault = await Vault.create({ admin });
    feesCollector = await vault.getFeesCollector();
    feesProvider = vault.getFeesProvider();
  });

  sharedBeforeEach('grant permissions to admin', async () => {
    await vault.authorizer
      .connect(admin)
      .grantPermissions([actionId(feesProvider, 'setFeeTypePercentage')], admin.address, [feesProvider.address]);

    await vault.authorizer
      .connect(admin)
      .grantPermissions(
        [actionId(feesCollector, 'setSwapFeePercentage'), actionId(feesCollector, 'setFlashLoanFeePercentage')],
        feesProvider.address,
        [feesCollector.address, feesCollector.address]
      );
  });

  context('for a 2 token pool', () => {
    itBehavesAsStablePoolProtocolFees(2);
  });

  context('for a 3 token pool', () => {
    itBehavesAsStablePoolProtocolFees(3);
  });

  context('for a 4 token pool', () => {
    itBehavesAsStablePoolProtocolFees(4);
  });

  context('for a 5 token pool', () => {
    itBehavesAsStablePoolProtocolFees(5);
  });

  function itBehavesAsStablePoolProtocolFees(numberOfTokens: number): void {
    describe('_getGrowthInvariants', () => {
      let pool: Contract, tokens: TokenList;
      let rateProviders: Contract[];
      let exemptFromYieldProtocolFeeFlags: boolean[] = [];

      let balances: BigNumber[];

      enum Exemption {
        NONE,
        SOME,
        ALL,
      }

      function deployPool(exemption: Exemption) {
        sharedBeforeEach('deploy pool', async () => {
          tokens = await TokenList.create(numberOfTokens, { sorted: true });
          balances = range(numberOfTokens).map(() => fp(random(50e6, 200e6)));

          rateProviders = [];
          for (let i = 0; i < numberOfTokens; i++) {
            rateProviders[i] = await deploy('v2-pool-utils/MockRateProvider');
          }

          if (exemption == Exemption.NONE) {
            exemptFromYieldProtocolFeeFlags = Array(numberOfTokens).fill(false);
          } else if (exemption == Exemption.ALL) {
            exemptFromYieldProtocolFeeFlags = Array(numberOfTokens).fill(true);
          } else {
            exemptFromYieldProtocolFeeFlags = range(numberOfTokens).map(() => Math.random() < 0.5);

            if (every(exemptFromYieldProtocolFeeFlags, (flag) => flag == false)) {
              exemptFromYieldProtocolFeeFlags[0] = true;
            } else if (every(exemptFromYieldProtocolFeeFlags, (flag) => flag == true)) {
              exemptFromYieldProtocolFeeFlags[0] = false;
            }
          }

          // The rate durations are actually irrelevant since we're forcing cache updates
          const rateCacheDurations = Array(numberOfTokens).fill(DAY);

          pool = await deploy('MockStablePoolProtocolFees', {
            args: [
              vault.address,
              feesProvider.address,
              tokens.addresses,
              rateProviders.map((x) => x.address),
              rateCacheDurations,
              exemptFromYieldProtocolFeeFlags,
            ],
          });
        });

        sharedBeforeEach('update rate cache', async () => {
          // We set new rates for all providers, and then force a cache update for all of them, updating the current
          // rates. They will now be different from the old rates.
          await Promise.all(rateProviders.map((provider) => provider.mockRate(fp(random(1.1, 1.5)))));
          await tokens.asyncEach((token) => pool.updateTokenRateCache(token.address));

          await tokens.asyncEach(async (token) => {
            const { rate, oldRate } = await pool.getTokenRateCache(token.address);
            expect(rate).to.not.equal(oldRate);
          });
        });
      }

      function itComputesTheInvariantsCorrectly() {
        it('computes the swap fee growth invariant correctly', async () => {
          // The swap fee growth invariant is computed by using old rates for all tokens
          const oldRateBalances = await Promise.all(
            balances.map(async (balance, i) => {
              const { rate, oldRate } = await pool.getTokenRateCache(tokens.get(i).address);
              return balance.mul(oldRate).div(rate);
            })
          );

          const expectedSwapFeeGrowhtInvariant = calculateInvariant(
            oldRateBalances,
            AMPLIFICATION_FACTOR.div(AMPLIFICATION_PRECISION)
          );

          const { swapFeeGrowthInvariant } = await pool.getGrowthInvariants(balances, AMPLIFICATION_FACTOR);
          expect(swapFeeGrowthInvariant).to.almostEqual(expectedSwapFeeGrowhtInvariant, 1e-10);
        });

        it('computes the total non exempt growth invariant correctly', async () => {
          // The total non exempt growth invariant is computed by using old rates for exempt tokens
          const yieldNonExemptBalances = await Promise.all(
            balances.map(async (balance, i) => {
              const { rate, oldRate } = await pool.getTokenRateCache(tokens.get(i).address);
              return exemptFromYieldProtocolFeeFlags[i] ? balance.mul(oldRate).div(rate) : balance;
            })
          );

          const expectedTotalNonExemptGrowthInvariant = calculateInvariant(
            yieldNonExemptBalances,
            AMPLIFICATION_FACTOR.div(AMPLIFICATION_PRECISION)
          );

          const { totalNonExemptGrowthInvariant } = await pool.getGrowthInvariants(balances, AMPLIFICATION_FACTOR);
          expect(totalNonExemptGrowthInvariant).to.almostEqual(expectedTotalNonExemptGrowthInvariant, 1e-10);
        });

        it('computes the total growth invariant correctly', async () => {
          const expectedTotalGrowthInvariant = calculateInvariant(
            balances,
            AMPLIFICATION_FACTOR.div(AMPLIFICATION_PRECISION)
          );
          const { totalGrowthInvariant } = await pool.getGrowthInvariants(balances, AMPLIFICATION_FACTOR);

          expect(totalGrowthInvariant).to.almostEqual(expectedTotalGrowthInvariant, 1e-10);
        });
      }

      context('with no tokens exempt from yield fees', () => {
        deployPool(Exemption.NONE);

        itComputesTheInvariantsCorrectly();

        it('the total non exempt growth and total growth invariants are the same', async () => {
          const { totalNonExemptGrowthInvariant, totalGrowthInvariant } = await pool.getGrowthInvariants(
            balances,
            AMPLIFICATION_FACTOR
          );
          expect(totalNonExemptGrowthInvariant).to.equal(totalGrowthInvariant);
        });

        it('the total non exempt growth is larger than the swap fee growth', async () => {
          const { swapFeeGrowthInvariant, totalNonExemptGrowthInvariant } = await pool.getGrowthInvariants(
            balances,
            AMPLIFICATION_FACTOR
          );
          expect(totalNonExemptGrowthInvariant).to.gt(swapFeeGrowthInvariant);
        });
      });

      context('with all tokens exempt from yield fees', () => {
        deployPool(Exemption.ALL);

        itComputesTheInvariantsCorrectly();

        it('the total non exempt growth and the swap fee growth are the same', async () => {
          const { swapFeeGrowthInvariant, totalNonExemptGrowthInvariant } = await pool.getGrowthInvariants(
            balances,
            AMPLIFICATION_FACTOR
          );
          expect(totalNonExemptGrowthInvariant).to.equal(swapFeeGrowthInvariant);
        });

        it('the total growth invariant is larger than the total non exempt growth', async () => {
          const { totalNonExemptGrowthInvariant, totalGrowthInvariant } = await pool.getGrowthInvariants(
            balances,
            AMPLIFICATION_FACTOR
          );
          expect(totalGrowthInvariant).to.gt(totalNonExemptGrowthInvariant);
        });
      });

      context('with some (but not all) tokens exempt from yield fees', () => {
        deployPool(Exemption.SOME);

        itComputesTheInvariantsCorrectly();

        it('the total non exempt growth is larger than the swap fee growth', async () => {
          const { swapFeeGrowthInvariant, totalNonExemptGrowthInvariant } = await pool.getGrowthInvariants(
            balances,
            AMPLIFICATION_FACTOR
          );
          expect(totalNonExemptGrowthInvariant).to.gt(swapFeeGrowthInvariant);
        });

        it('the total growth invariant is larger than the total non exempt growth', async () => {
          const { totalNonExemptGrowthInvariant, totalGrowthInvariant } = await pool.getGrowthInvariants(
            balances,
            AMPLIFICATION_FACTOR
          );
          expect(totalGrowthInvariant).to.gt(totalNonExemptGrowthInvariant);
        });
      });
    });
  }
});
