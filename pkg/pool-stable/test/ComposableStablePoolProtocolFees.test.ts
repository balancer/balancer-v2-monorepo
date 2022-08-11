import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import {
  arrayAdd,
  arrayFpMul,
  BigNumberish,
  bn,
  bnSum,
  fp,
  FP_SCALING_FACTOR,
} from '@balancer-labs/v2-helpers/src/numbers';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { DAY } from '@balancer-labs/v2-helpers/src/time';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import { every, random, range } from 'lodash';
import { calculateInvariant } from '@balancer-labs/v2-helpers/src/models/pools/stable/math';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('ComposableStablePoolProtocolFees', () => {
  let admin: SignerWithAddress;
  let vault: Vault, feesCollector: Contract, feesProvider: Contract;
  let math: Contract;

  const INVARIANT_RELATIVE_ERROR = 1e-10;
  const FEE_RELATIVE_ERROR = 1e-3;

  // We want a relatively high amplification factor so that the invariant behaves close to a straight line, meaning all
  // tokens are priced almost the same even if their balances are not exactly the same.
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

  sharedBeforeEach('deploy math', async () => {
    math = await deploy('MockStableMath');
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
    describe('growth invariants', () => {
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

          pool = await deploy('MockComposableStablePoolProtocolFees', {
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

          const expectedSwapFeeGrowthInvariant = calculateInvariant(
            oldRateBalances,
            AMPLIFICATION_FACTOR.div(AMPLIFICATION_PRECISION)
          );

          const { swapFeeGrowthInvariant } = await pool.getGrowthInvariants(balances, AMPLIFICATION_FACTOR);
          expect(swapFeeGrowthInvariant).to.almostEqual(expectedSwapFeeGrowthInvariant, INVARIANT_RELATIVE_ERROR);
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
          expect(totalNonExemptGrowthInvariant).to.almostEqual(
            expectedTotalNonExemptGrowthInvariant,
            INVARIANT_RELATIVE_ERROR
          );
        });

        it('computes the total growth invariant correctly', async () => {
          const expectedTotalGrowthInvariant = calculateInvariant(
            balances,
            AMPLIFICATION_FACTOR.div(AMPLIFICATION_PRECISION)
          );
          const { totalGrowthInvariant } = await pool.getGrowthInvariants(balances, AMPLIFICATION_FACTOR);

          expect(totalGrowthInvariant).to.almostEqual(expectedTotalGrowthInvariant, INVARIANT_RELATIVE_ERROR);
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

    describe('protocol fees before join/exit', () => {
      // We want relatively large values to make the fees much larger than rounding error
      const SWAP_PROTOCOL_FEE_PERCENTAGE = fp(0.5);
      const YIELD_PROTOCOL_FEE_PERCENTAGE = fp(0.3);

      const PREMINTED_BPT = fp(9e9); // This is the BPT normally stored in the Pool's accounting at the Vault

      // We want a Pool that is relatively balaced so that, with a reasonably high amplification factor, each token has
      // similar prices
      const MIN_POOL_TOKEN_BALANCE = 150e6;
      const MAX_POOL_TOKEN_BALANCE = 200e6;

      // 1e-4 roughly corresponds to a 12 hour period with 30% APR.
      const MIN_SWAP_RATE_DELTA = 1e-5;
      const MAX_SWAP_RATE_DELTA = 1e-4;

      // We want for the swap deltas to be in a similar order of magnitude to the rate deltas, so that the resulting
      // fees can be added without the relative error drowning them.
      // A rate delta of 1e-5 on a balance of 150e6 corresponds to a delta of 1.5e3, while a rate delta of 1e-4 on a
      // balance of 200e6 corresponds to a delta of 20e3;

      const MIN_SWAP_BALANCE_DELTA = 1.5e3;
      const MAX_SWAP_BALANCE_DELTA = 20e3;

      let pool: Contract, tokens: TokenList;
      let bptIndex: number;

      let rateProviders: Contract[];
      let exemptFromYieldProtocolFeeFlags: boolean[];

      sharedBeforeEach('deploy tokens', async () => {
        tokens = await TokenList.create(numberOfTokens, { sorted: true });
      });

      sharedBeforeEach('deploy pool', async () => {
        rateProviders = await Promise.all(range(numberOfTokens).map(() => deploy('v2-pool-utils/MockRateProvider')));

        exemptFromYieldProtocolFeeFlags = range(numberOfTokens).map(() => Math.random() < 0.5);
        // We need for at least one token to not be exempt, that is, for their flag to be false. If all are true, we
        // forcefully make one false. This makes it so that if all current rates are larger than 1.0, there will be some
        // yield fees.
        if (every(exemptFromYieldProtocolFeeFlags, (flag) => flag == true))
          exemptFromYieldProtocolFeeFlags[Math.floor(random(numberOfTokens - 1))] = false;

        // The rate durations are actually irrelevant as we forcefully update the cache ourselves.
        const rateCacheDurations = Array(numberOfTokens).fill(DAY);

        pool = await deploy('MockComposableStablePoolProtocolFees', {
          args: [
            vault.address,
            feesProvider.address,
            tokens.addresses,
            rateProviders.map((x) => x.address),
            rateCacheDurations,
            exemptFromYieldProtocolFeeFlags,
          ],
        });

        await pool.setTotalSupply(PREMINTED_BPT);

        bptIndex = (await pool.getBptIndex()).toNumber();
      });

      let preBalances: BigNumber[];
      let preInvariant: BigNumber;
      let preVirtualSupply: BigNumber;

      sharedBeforeEach('setup previous pool state', async () => {
        // Since we're passing the balances directly to the contract, we don't need to worry about scaling factors, and
        // can work with 18 decimal balances directly.
        preBalances = tokens.map(() => fp(random(MIN_POOL_TOKEN_BALANCE, MAX_POOL_TOKEN_BALANCE)));

        // The rate providers start with a value of 1, so we don't need to account for them here. We need to use the
        // actual Solidity math since even small errors will disrupt tests that check for perfect invariant equality
        // (which result in no fees being paid).
        preInvariant = await math.invariant(AMPLIFICATION_FACTOR, preBalances);

        // The virtual supply is some factor of the invariant
        preVirtualSupply = preInvariant.mul(fp(random(1.5, 10))).div(FP_SCALING_FACTOR);

        // This will store the amplification factor and invariant as the lastJoinExit values, as well as setup the
        // old rates.
        await pool.updatePostJoinExit(AMPLIFICATION_FACTOR, preInvariant);
      });

      describe('payProtocolFeesBeforeJoinExit', () => {
        context('when both the protocol swap and yield fee percentages are zero', () => {
          itPaysProtocolFeesGivenGlobalPercentages(bn(0), bn(0));
        });

        context('when the protocol swap fee percentage is non-zero', () => {
          itPaysProtocolFeesGivenGlobalPercentages(SWAP_PROTOCOL_FEE_PERCENTAGE, bn(0));
        });

        context('when the protocol yield fee percentage is non-zero', () => {
          itPaysProtocolFeesGivenGlobalPercentages(bn(0), YIELD_PROTOCOL_FEE_PERCENTAGE);
        });

        context('when both the protocol swap and yield fee percentages are non-zero', () => {
          itPaysProtocolFeesGivenGlobalPercentages(SWAP_PROTOCOL_FEE_PERCENTAGE, YIELD_PROTOCOL_FEE_PERCENTAGE);
        });

        function itPaysProtocolFeesGivenGlobalPercentages(swapFee: BigNumber, yieldFee: BigNumber) {
          function setProtocolFees(swapFee: BigNumberish, yieldFee: BigNumberish) {
            sharedBeforeEach('set protocol fees', async () => {
              await feesProvider.connect(admin).setFeeTypePercentage(ProtocolFee.SWAP, swapFee);
              await feesProvider.connect(admin).setFeeTypePercentage(ProtocolFee.YIELD, yieldFee);

              await pool.updateProtocolFeePercentageCache();
            });
          }

          setProtocolFees(swapFee, yieldFee);

          let currentBalances: BigNumber[];
          let expectedProtocolOwnershipPercentage: BigNumberish;

          context('when neither swap nor yield fees are due', () => {
            prepareNoSwapOrYieldFees();

            itDoesNotPayAnyProtocolFees();
          });

          context('when swap fees are due', () => {
            prepareSwapFees();

            if (swapFee.eq(0)) {
              itDoesNotPayAnyProtocolFees();
            } else {
              itPaysTheExpectedProtocolFees();
            }
          });

          context('when yield fees are due', () => {
            prepareYieldFees();

            if (yieldFee.eq(0)) {
              itDoesNotPayAnyProtocolFees();
            } else {
              itPaysTheExpectedProtocolFees();
            }
          });

          context('when both swap and yield fees are due', () => {
            prepareSwapAndYieldFees();

            if (swapFee.eq(0) && yieldFee.eq(0)) {
              itDoesNotPayAnyProtocolFees();
            } else {
              itPaysTheExpectedProtocolFees();
            }
          });

          function prepareNoSwapOrYieldFees() {
            sharedBeforeEach(async () => {
              currentBalances = preBalances;
              expectedProtocolOwnershipPercentage = 0;
            });
          }

          function prepareSwapFees() {
            sharedBeforeEach(async () => {
              const deltas = range(numberOfTokens).map(() =>
                fp(random(MIN_SWAP_BALANCE_DELTA, MAX_SWAP_BALANCE_DELTA))
              );

              currentBalances = arrayAdd(preBalances, deltas);

              // We assume all tokens have similar value, and simply add all of the amounts together to represent how
              // much value is being added to the Pool. This is equivalent to assuming the invariant is the sum of the
              // tokens (which is a close approximation while the Pool is balanced).

              const deltaSum = bnSum(deltas);
              const currSum = bnSum(currentBalances);
              const poolPercentageDueToDeltas = deltaSum.mul(FP_SCALING_FACTOR).div(currSum);

              expectedProtocolOwnershipPercentage = poolPercentageDueToDeltas.mul(swapFee).div(FP_SCALING_FACTOR);
            });
          }

          function prepareYieldFees() {
            sharedBeforeEach(async () => {
              const rates = range(numberOfTokens).map(() => fp(1 + random(MIN_SWAP_RATE_DELTA, MAX_SWAP_RATE_DELTA)));
              await Promise.all(rateProviders.map((rateProvider, i) => rateProvider.mockRate(rates[i])));

              // We need to get the Pool to update the rate cache of all of its tokens, so that the balance change is
              // seen as a change in rates from old to current.
              await tokens.asyncMap((token) => pool.updateTokenRateCache(token.address));

              currentBalances = arrayFpMul(preBalances, rates);

              // We assume all tokens have similar value, and simply add the non-exempt the amounts together to
              // represent how much value is being added to the Pool. This is equivalent to assuming the invariant is
              // the sum of the tokens (which is a close approximation while the Pool is balanced).

              const deltaSum = bnSum(
                preBalances.map((balance, i) =>
                  exemptFromYieldProtocolFeeFlags[i]
                    ? 0
                    : balance.mul(rates[i].sub(FP_SCALING_FACTOR)).div(FP_SCALING_FACTOR)
                )
              );

              const currSum = bnSum(currentBalances);
              const poolPercentageDueToDeltas = deltaSum.mul(FP_SCALING_FACTOR).div(currSum);

              expectedProtocolOwnershipPercentage = poolPercentageDueToDeltas.mul(yieldFee).div(FP_SCALING_FACTOR);
            });
          }

          function prepareSwapAndYieldFees() {
            sharedBeforeEach(async () => {
              const swapFeeDeltas = range(numberOfTokens).map(() =>
                fp(random(MIN_SWAP_BALANCE_DELTA, MAX_SWAP_BALANCE_DELTA))
              );

              const rates = range(numberOfTokens).map(() => fp(1 + random(MIN_SWAP_RATE_DELTA, MAX_SWAP_RATE_DELTA)));
              await Promise.all(rateProviders.map((rateProvider, i) => rateProvider.mockRate(rates[i])));

              // We need to get the Pool to update the rate cache of all of its tokens, so that there balance change is
              // seen as a change in rates from old to current.
              await tokens.asyncMap((token) => pool.updateTokenRateCache(token.address));

              // We first apply the swap deltas, and then multiply by the rates, which is the model the Pool uses when
              // splitting swap and yield fees.

              currentBalances = arrayFpMul(arrayAdd(preBalances, swapFeeDeltas), rates);

              // We assume all tokens have similar value, and simply add the swap deltas and non-exempt yield deltas
              // together to represent how much value is being added to the Pool. This is equivalent to assuming the
              // invariant is the sum of the tokens (which is a close approximation while the Pool is balanced).

              const swapFeeDeltaSum = bnSum(swapFeeDeltas);
              const yieldDeltaSum = bnSum(
                preBalances.map((balance, i) =>
                  exemptFromYieldProtocolFeeFlags[i] ? 0 : balance.mul(rates[i].sub(fp(1))).div(FP_SCALING_FACTOR)
                )
              );
              const currSum = bnSum(currentBalances);

              const poolPercentageDueToSwapFeeDeltas = swapFeeDeltaSum.mul(FP_SCALING_FACTOR).div(currSum);
              const poolPercentageDueToYieldDeltas = yieldDeltaSum.mul(FP_SCALING_FACTOR).div(currSum);

              expectedProtocolOwnershipPercentage = poolPercentageDueToSwapFeeDeltas
                .mul(swapFee)
                .div(FP_SCALING_FACTOR)
                .add(poolPercentageDueToYieldDeltas.mul(yieldFee).div(FP_SCALING_FACTOR));
            });
          }

          function itDoesNotPayAnyProtocolFees() {
            let currentBalancesWithBpt: BigNumber[];

            sharedBeforeEach(async () => {
              currentBalancesWithBpt = [...currentBalances];
              currentBalancesWithBpt.splice(bptIndex, 0, PREMINTED_BPT.sub(preVirtualSupply));
            });

            it('returns zero protocol ownership percentage', async () => {
              expect(await pool.getProtocolPoolOwnershipPercentage(currentBalances)).to.equal(0);
            });

            it('mints no BPT', async () => {
              const tx = await pool.payProtocolFeesBeforeJoinExit(currentBalancesWithBpt);
              expectEvent.notEmitted(await tx.wait(), 'Transfer');
            });

            it('returns the original virtual supply', async () => {
              const { virtualSupply: updatedVirtualSupply } = await pool.callStatic.payProtocolFeesBeforeJoinExit(
                currentBalancesWithBpt
              );
              expect(updatedVirtualSupply).to.be.equal(preVirtualSupply);
            });

            it('returns the balances sans BPT', async () => {
              const { balances } = await pool.callStatic.payProtocolFeesBeforeJoinExit(currentBalancesWithBpt);
              expect(balances).to.deep.equal(currentBalances);
            });
          }

          function itPaysTheExpectedProtocolFees() {
            let currentBalancesWithBpt: BigNumber[];
            let expectedBptAmount: BigNumber;

            sharedBeforeEach(async () => {
              currentBalancesWithBpt = [...currentBalances];
              currentBalancesWithBpt.splice(bptIndex, 0, PREMINTED_BPT.sub(preVirtualSupply));

              // protocol ownership = to mint / (supply + to mint)
              // to mint = supply * protocol ownership / (1 - protocol ownership)
              expectedBptAmount = preVirtualSupply
                .mul(expectedProtocolOwnershipPercentage)
                .div(fp(1).sub(expectedProtocolOwnershipPercentage));
            });

            it('returns a non-zero protocol ownership percentage', async () => {
              const protocolPoolOwnershipPercentage = await pool.getProtocolPoolOwnershipPercentage(currentBalances);

              expect(protocolPoolOwnershipPercentage).to.be.gt(0);
              expect(protocolPoolOwnershipPercentage).to.be.almostEqual(
                expectedProtocolOwnershipPercentage,
                FEE_RELATIVE_ERROR
              );
            });

            it('mints BPT to the protocol fee collector', async () => {
              const tx = await pool.payProtocolFeesBeforeJoinExit(currentBalancesWithBpt);
              const event = expectEvent.inReceipt(await tx.wait(), 'Transfer', {
                from: ZERO_ADDRESS,
                to: feesCollector.address,
              });
              expect(event.args.value).to.be.almostEqual(expectedBptAmount, FEE_RELATIVE_ERROR);
            });

            it('returns the updated virtual supply', async () => {
              const { virtualSupply: updatedVirtualSupply } = await pool.callStatic.payProtocolFeesBeforeJoinExit(
                currentBalancesWithBpt
              );
              expect(updatedVirtualSupply).to.be.almostEqual(
                preVirtualSupply.add(expectedBptAmount),
                FEE_RELATIVE_ERROR
              );
            });

            it('returns the balances sans BPT', async () => {
              const { balances } = await pool.callStatic.payProtocolFeesBeforeJoinExit(currentBalancesWithBpt);
              expect(balances).to.deep.equal(currentBalances);
            });
          }
        }
      });
    });
  }
});
