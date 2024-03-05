import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import {
  arrayAdd,
  BigNumberish,
  bn,
  bnSum,
  fp,
  arraySub,
  arrayFpMul,
  fpMul,
  fpDiv,
  FP_ONE,
  FP_100_PCT,
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
      .grantPermission(actionId(feesProvider, 'setFeeTypePercentage'), admin.address, feesProvider.address);

    await vault.authorizer
      .connect(admin)
      .grantPermission(actionId(feesCollector, 'setSwapFeePercentage'), feesProvider.address, feesCollector.address);
    await vault.authorizer
      .connect(admin)
      .grantPermission(
        actionId(feesCollector, 'setFlashLoanFeePercentage'),
        feesProvider.address,
        feesCollector.address
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

    describe('protocol fees on join/exit', () => {
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

      function setProtocolFees(swapFee: BigNumberish, yieldFee: BigNumberish) {
        sharedBeforeEach('set protocol fees', async () => {
          await feesProvider.connect(admin).setFeeTypePercentage(ProtocolFee.SWAP, swapFee);
          await feesProvider.connect(admin).setFeeTypePercentage(ProtocolFee.YIELD, yieldFee);

          await pool.updateProtocolFeePercentageCache();
        });
      }

      sharedBeforeEach('setup previous pool state', async () => {
        // Since we're passing the balances directly to the contract, we don't need to worry about scaling factors, and
        // can work with 18 decimal balances directly.
        preBalances = tokens.map(() => fp(random(MIN_POOL_TOKEN_BALANCE, MAX_POOL_TOKEN_BALANCE)));

        // The rate providers start with a value of 1, so we don't need to account for them here. We need to use the
        // actual Solidity math since even small errors will disrupt tests that check for perfect invariant equality
        // (which result in no fees being paid).
        preInvariant = await math.calculateInvariant(AMPLIFICATION_FACTOR, preBalances);

        // The virtual supply is some factor of the invariant
        preVirtualSupply = fpMul(preInvariant, fp(random(1.5, 10)));

        // We don't use the stored amplification factor and invariant as the lastJoinExit values in tests as we pass
        // them in. However this function also sets the old token rates which we *do* use.
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
              const poolPercentageDueToDeltas = fpDiv(deltaSum, currSum);

              expectedProtocolOwnershipPercentage = fpMul(poolPercentageDueToDeltas, swapFee);
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
                  exemptFromYieldProtocolFeeFlags[i] ? 0 : fpMul(balance, rates[i].sub(FP_ONE))
                )
              );

              const currSum = bnSum(currentBalances);
              const poolPercentageDueToDeltas = fpDiv(deltaSum, currSum);

              expectedProtocolOwnershipPercentage = fpMul(poolPercentageDueToDeltas, yieldFee);
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
                  exemptFromYieldProtocolFeeFlags[i] ? 0 : fpMul(balance, rates[i].sub(FP_ONE))
                )
              );
              const currSum = bnSum(currentBalances);

              const poolPercentageDueToSwapFeeDeltas = fpDiv(swapFeeDeltaSum, currSum);
              const poolPercentageDueToYieldDeltas = fpDiv(yieldDeltaSum, currSum);

              expectedProtocolOwnershipPercentage = fpMul(poolPercentageDueToSwapFeeDeltas, swapFee).add(
                fpMul(poolPercentageDueToYieldDeltas, yieldFee)
              );
            });
          }

          function itDoesNotPayAnyProtocolFees() {
            let currentBalancesWithBpt: BigNumber[];

            sharedBeforeEach(async () => {
              currentBalancesWithBpt = [...currentBalances];
              currentBalancesWithBpt.splice(bptIndex, 0, PREMINTED_BPT.sub(preVirtualSupply));
            });

            it('returns zero protocol ownership percentage', async () => {
              expect(
                await pool.getProtocolPoolOwnershipPercentage(currentBalances, AMPLIFICATION_FACTOR, preInvariant)
              ).to.equal(0);
            });

            it('mints no BPT', async () => {
              const tx = await pool.payProtocolFeesBeforeJoinExit(
                currentBalancesWithBpt,
                AMPLIFICATION_FACTOR,
                preInvariant
              );
              expectEvent.notEmitted(await tx.wait(), 'Transfer');
            });

            it('returns the original virtual supply', async () => {
              const { virtualSupply: updatedVirtualSupply } = await pool.callStatic.payProtocolFeesBeforeJoinExit(
                currentBalancesWithBpt,
                AMPLIFICATION_FACTOR,
                preInvariant
              );
              expect(updatedVirtualSupply).to.be.equal(preVirtualSupply);
            });

            it('returns the balances sans BPT', async () => {
              const { balances } = await pool.callStatic.payProtocolFeesBeforeJoinExit(
                currentBalancesWithBpt,
                AMPLIFICATION_FACTOR,
                preInvariant
              );
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
                .div(FP_100_PCT.sub(expectedProtocolOwnershipPercentage));
            });

            it('returns a non-zero protocol ownership percentage', async () => {
              const protocolPoolOwnershipPercentage = await pool.getProtocolPoolOwnershipPercentage(
                currentBalances,
                AMPLIFICATION_FACTOR,
                preInvariant
              );

              expect(protocolPoolOwnershipPercentage).to.be.gt(0);
              expect(protocolPoolOwnershipPercentage).to.be.almostEqual(
                expectedProtocolOwnershipPercentage,
                FEE_RELATIVE_ERROR
              );
            });

            it('mints BPT to the protocol fee collector', async () => {
              const tx = await pool.payProtocolFeesBeforeJoinExit(
                currentBalancesWithBpt,
                AMPLIFICATION_FACTOR,
                preInvariant
              );
              const event = expectEvent.inReceipt(await tx.wait(), 'Transfer', {
                from: ZERO_ADDRESS,
                to: feesCollector.address,
              });
              expect(event.args.value).to.be.almostEqual(expectedBptAmount, FEE_RELATIVE_ERROR);
            });

            it('returns the updated virtual supply', async () => {
              const { virtualSupply: updatedVirtualSupply } = await pool.callStatic.payProtocolFeesBeforeJoinExit(
                currentBalancesWithBpt,
                AMPLIFICATION_FACTOR,
                preInvariant
              );
              expect(updatedVirtualSupply).to.be.almostEqual(
                preVirtualSupply.add(expectedBptAmount),
                FEE_RELATIVE_ERROR
              );
            });

            it('returns the balances sans BPT', async () => {
              const { balances } = await pool.callStatic.payProtocolFeesBeforeJoinExit(
                currentBalancesWithBpt,
                AMPLIFICATION_FACTOR,
                preInvariant
              );
              expect(balances).to.deep.equal(currentBalances);
            });
          }
        }
      });

      describe('updateInvariantAfterJoinExit', () => {
        sharedBeforeEach(async () => {
          // We update the rate of all rate providers, making the current rates become different from the old rates, so
          // that we can later test if they are made equal.
          const rates = range(numberOfTokens).map(() => fp(1 + random(0.1, 0.5)));
          await Promise.all(rateProviders.map((rateProvider, i) => rateProvider.mockRate(rates[i])));
          await tokens.asyncMap((token) => pool.updateTokenRateCache(token.address));
        });

        context('when the protocol swap fee percentage is zero', () => {
          itPaysProtocolFeesOnJoinExitSwaps(bn(0));
        });

        context('when the protocol swap fee percentage is non-zero', () => {
          itPaysProtocolFeesOnJoinExitSwaps(SWAP_PROTOCOL_FEE_PERCENTAGE);
        });

        function itPaysProtocolFeesOnJoinExitSwaps(swapFee: BigNumber) {
          let currentBalances: BigNumber[];
          let currentVirtualSupply: BigNumber;
          let expectedProtocolOwnershipPercentage: BigNumber;

          enum Operation {
            JOIN,
            EXIT,
          }

          setProtocolFees(swapFee, 0);

          context('on proportional join', () => {
            prepareProportionalJoinOrExit(Operation.JOIN);

            itDoesNotPayAnyProtocolFees();

            itUpdatesThePostJoinExitState();
          });

          context('on proportional exit', () => {
            prepareProportionalJoinOrExit(Operation.EXIT);

            itDoesNotPayAnyProtocolFees();

            itUpdatesThePostJoinExitState();
          });

          context('on multi-token non-proportional join', () => {
            prepareMultiTokenNonProportionalJoinOrExit(Operation.JOIN);

            if (swapFee.eq(0)) {
              itDoesNotPayAnyProtocolFees();
            } else {
              itPaysTheExpectedProtocolFees();
            }

            itUpdatesThePostJoinExitState();
          });

          context('on multi-token non-proportional exit', () => {
            prepareMultiTokenNonProportionalJoinOrExit(Operation.EXIT);

            if (swapFee.eq(0)) {
              itDoesNotPayAnyProtocolFees();
            } else {
              itPaysTheExpectedProtocolFees();
            }

            itUpdatesThePostJoinExitState();
          });

          function prepareProportionalJoinOrExit(op: Operation) {
            sharedBeforeEach(async () => {
              const ratio = fp(random(0.1, 0.9));

              // Generate amounts for a proportional join/exit
              const amounts = preBalances.map((balance) => fpMul(balance, ratio));

              // Compute the balances, and increase/decrease the virtual supply proportionally
              if (op == Operation.JOIN) {
                currentBalances = arrayAdd(preBalances, amounts);
                currentVirtualSupply = fpMul(preVirtualSupply, FP_ONE.add(ratio));
              } else {
                currentBalances = arraySub(preBalances, amounts);
                currentVirtualSupply = fpMul(preVirtualSupply, FP_ONE.sub(ratio));
              }
            });
          }

          function prepareMultiTokenNonProportionalJoinOrExit(op: Operation) {
            sharedBeforeEach(async () => {
              const ratio = fp(random(0.1, 0.9));

              // Generate amounts for a proportional join/exit
              const proportionalAmounts = preBalances.map((balance) => fpMul(balance, ratio));

              // Compute deltas that are going to modify the proportional amounts. These will be swap fees.
              const deltas = proportionalAmounts.map((amount) => fpMul(amount, fp(random(0.05, 0.1))));

              // Compute the balances with the added deltas, and the virtual supply without taking them into account
              // (because they are fees).
              if (op == Operation.JOIN) {
                const proportionalBalances = arrayAdd(preBalances, proportionalAmounts);
                currentVirtualSupply = fpMul(preVirtualSupply, FP_ONE.add(ratio));

                currentBalances = arrayAdd(proportionalBalances, deltas);
              } else {
                const proportionalBalances = arraySub(preBalances, proportionalAmounts);
                currentVirtualSupply = fpMul(preVirtualSupply, FP_ONE.sub(ratio));

                currentBalances = arrayAdd(proportionalBalances, deltas);
              }

              // The deltas are pure swap fees: the protocol ownership percentage is their percentage of the entire
              // Pool, multiplied by the protocol fee percentage. This indirectly assumes that all tokens are worth
              // roughly the same, which should hold since we're not unbalancing the Pool greatly.
              const deltaSum = bnSum(deltas);
              const currSum = bnSum(currentBalances);

              const poolFeePercentage = fpDiv(deltaSum, currSum);
              expectedProtocolOwnershipPercentage = fpMul(poolFeePercentage, swapFee);
            });
          }

          function itDoesNotPayAnyProtocolFees() {
            it('mints no (or negligible) BPT', async () => {
              const tx = await pool.updateInvariantAfterJoinExit(
                AMPLIFICATION_FACTOR,
                currentBalances,
                preInvariant,
                preVirtualSupply,
                currentVirtualSupply
              );

              // If the protocol swap fee percentage is non-zero, we can't quite guarantee that there'll be zero
              // protocol fees since there's some rounding error in the computation of the currentInvariant the Pool
              // will make, which might result in negligible fees.

              // If no tokens were minted, there'll be no transfer event. If some were minted, we check that the
              // transfer event is for a negligible amount.
              const receipt = await tx.wait();
              const minted = receipt.events.length > 0;

              if (!minted) {
                expectEvent.notEmitted(receipt, 'Transfer');
              } else {
                const event = expectEvent.inReceipt(await tx.wait(), 'Transfer', {
                  from: ZERO_ADDRESS,
                  to: feesCollector.address,
                });

                const bptAmount = event.args.value;

                // The BPT amount to mint is computed as a percentage of the current supply. This is done with precision
                // of up to 18 decimal places, so any error below that is always considered negligible. We test for
                // precision of up to 17 decimal places to give some leeway and account for e.g. different rounding
                // directions, etc.
                expect(bptAmount).to.be.lte(currentVirtualSupply.div(bn(1e17)));
              }
            });
          }

          function itPaysTheExpectedProtocolFees() {
            let expectedBptAmount: BigNumber;

            sharedBeforeEach(async () => {
              // protocol ownership = to mint / (supply + to mint)
              // to mint = supply * protocol ownership / (1 - protocol ownership)
              expectedBptAmount = currentVirtualSupply
                .mul(expectedProtocolOwnershipPercentage)
                .div(FP_100_PCT.sub(expectedProtocolOwnershipPercentage));
            });

            it('mints BPT to the protocol fee collector', async () => {
              const tx = await pool.updateInvariantAfterJoinExit(
                AMPLIFICATION_FACTOR,
                currentBalances,
                preInvariant,
                preVirtualSupply,
                currentVirtualSupply
              );

              const event = expectEvent.inReceipt(await tx.wait(), 'Transfer', {
                from: ZERO_ADDRESS,
                to: feesCollector.address,
              });

              expect(event.args.value).to.be.almostEqual(expectedBptAmount, FEE_RELATIVE_ERROR);
            });
          }

          function itUpdatesThePostJoinExitState() {
            it('stores the current invariant and amplification factor', async () => {
              await pool.updateInvariantAfterJoinExit(
                AMPLIFICATION_FACTOR,
                currentBalances,
                preInvariant,
                preVirtualSupply,
                currentVirtualSupply
              );

              const { lastJoinExitAmplification, lastPostJoinExitInvariant } = await pool.getLastJoinExitData();

              expect(lastJoinExitAmplification).to.equal(AMPLIFICATION_FACTOR);
              expect(lastPostJoinExitInvariant).to.almostEqual(
                await math.calculateInvariant(AMPLIFICATION_FACTOR, currentBalances),
                0.000001
              );
            });

            it('updates the old rates', async () => {
              await tokens.asyncEach(async (token) => {
                const { rate, oldRate } = await pool.getTokenRateCache(token.address);
                expect(oldRate).to.not.equal(rate);
              });

              await pool.updateInvariantAfterJoinExit(
                AMPLIFICATION_FACTOR,
                currentBalances,
                preInvariant,
                preVirtualSupply,
                currentVirtualSupply
              );

              await tokens.asyncEach(async (token) => {
                const { rate, oldRate } = await pool.getTokenRateCache(token.address);
                expect(oldRate).to.equal(rate);
              });
            });
          }
        }
      });
    });
  }
});
