import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { random, range } from 'lodash';

import { deploy, deployedAt, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PoolSpecialization, SwapKind } from '@balancer-labs/balancer-js';

import {
  BigNumberish,
  bn,
  fp,
  pct,
  arrayAdd,
  arrayFpMul,
  bnSum,
  fpDiv,
  fpMul,
  FP_ONE,
  FP_ZERO,
  FP_100_PCT,
} from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT112, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { RawStablePoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/stable/types';
import { currentTimestamp, advanceTime, MONTH, WEEK, DAY } from '@balancer-labs/v2-helpers/src/time';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';
import { calculateInvariant } from '@balancer-labs/v2-helpers/src/models/pools/stable/math';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('ComposableStablePool', () => {
  let lp: SignerWithAddress,
    owner: SignerWithAddress,
    recipient: SignerWithAddress,
    admin: SignerWithAddress,
    other: SignerWithAddress;

  const AMPLIFICATION_PARAMETER = bn(200);
  const PREMINTED_BPT = MAX_UINT112.div(2);
  const AMP_PRECISION = 1e3;

  sharedBeforeEach('setup signers', async () => {
    [, lp, owner, recipient, admin, other] = await ethers.getSigners();
  });

  context('for a 1 token pool', () => {
    it('reverts', async () => {
      const tokens = await TokenList.create(1);
      await expect(StablePool.create({ tokens })).to.be.revertedWith('MIN_TOKENS');
    });
  });

  context('for a 2 token pool', () => {
    itBehavesAsComposableStablePool(2);
  });

  context('for a 3 token pool', () => {
    itBehavesAsComposableStablePool(3);
  });

  context('for a 4 token pool', () => {
    itBehavesAsComposableStablePool(4);
  });

  context('for a 5 token pool', () => {
    itBehavesAsComposableStablePool(5);
  });

  context('for a 6 token pool', () => {
    it('reverts', async () => {
      const tokens = await TokenList.create(6, { sorted: true });
      await expect(StablePool.create({ tokens })).to.be.revertedWith('MAX_TOKENS');
    });
  });

  function itBehavesAsComposableStablePool(numberOfTokens: number): void {
    let pool: StablePool, tokens: TokenList;
    let deployTimestamp: BigNumber, bptIndex: number, initialBalances: BigNumberish[];

    const rateProviders: Contract[] = [];
    const tokenRateCacheDurations: number[] = [];
    const exemptFromYieldProtocolFeeFlags: boolean[] = [];

    const ZEROS = Array(numberOfTokens + 1).fill(bn(0));

    async function deployPool(
      params: RawStablePoolDeployment = {},
      rates: BigNumberish[] = [],
      durations: number[] = []
    ): Promise<void> {
      tokens = params.tokens || (await TokenList.create(numberOfTokens, { sorted: true }));

      for (let i = 0; i < numberOfTokens; i++) {
        rateProviders[i] = await deploy('v2-pool-utils/MockRateProvider');
        await rateProviders[i].mockRate(rates[i] || FP_ONE);
        tokenRateCacheDurations[i] = MONTH + i;
        exemptFromYieldProtocolFeeFlags[i] = i % 2 == 0; // set true for even tokens
      }

      pool = await StablePool.create({
        tokens,
        rateProviders,
        tokenRateCacheDurations: durations.length > 0 ? durations : tokenRateCacheDurations,
        exemptFromYieldProtocolFeeFlags,
        owner,
        admin,
        ...params,
      });

      bptIndex = await pool.getBptIndex();
      deployTimestamp = await currentTimestamp();
      initialBalances = Array.from({ length: numberOfTokens + 1 }).map((_, i) => (i == bptIndex ? 0 : fp(1 - i / 10)));
    }

    describe('creation', () => {
      context('when the creation succeeds', () => {
        const swapFeePercentage = fp(0.1);
        const tokenRates = Array.from({ length: numberOfTokens }, (_, i) => fp(1 + (i + 1) / 10));

        sharedBeforeEach('deploy pool', async () => {
          await deployPool({ swapFeePercentage, amplificationParameter: AMPLIFICATION_PARAMETER }, tokenRates);
        });

        it('sets the name', async () => {
          expect(await pool.name()).to.equal('Balancer Pool Token');
        });

        it('sets the symbol', async () => {
          expect(await pool.symbol()).to.equal('BPT');
        });

        it('sets the decimals', async () => {
          expect(await pool.decimals()).to.equal(18);
        });

        it('sets the owner ', async () => {
          expect(await pool.getOwner()).to.equal(owner.address);
        });

        it('sets the vault correctly', async () => {
          expect(await pool.getVault()).to.equal(pool.vault.address);
        });

        it('uses general specialization', async () => {
          const { address, specialization } = await pool.getRegisteredInfo();

          expect(address).to.equal(pool.address);
          expect(specialization).to.equal(PoolSpecialization.GeneralPool);
        });

        it('registers tokens in the vault', async () => {
          const { tokens: poolTokens, balances } = await pool.getTokens();

          expect(poolTokens).to.have.lengthOf(numberOfTokens + 1);
          expect(poolTokens).to.include.members(tokens.addresses);
          expect(poolTokens).to.include(pool.address);
          expect(balances).to.be.zeros;
        });

        it('starts with no BPT', async () => {
          expect(await pool.totalSupply()).to.be.equal(0);
        });

        it('sets swap fee', async () => {
          expect(await pool.getSwapFeePercentage()).to.equal(swapFeePercentage);
        });

        it('sets the rate cache durations', async () => {
          await tokens.asyncEach(async (token, i) => {
            const { duration, expires, rate } = await pool.getTokenRateCache(token);
            expect(rate).to.equal(tokenRates[i]);
            expect(duration).to.equal(tokenRateCacheDurations[i]);
            expect(expires).to.be.at.least(deployTimestamp.add(tokenRateCacheDurations[i]));
          });
        });

        it('reverts when querying rate cache for BPT', async () => {
          await expect(pool.getTokenRateCache(pool.address)).to.be.revertedWith('TOKEN_DOES_NOT_HAVE_RATE_PROVIDER');
        });

        it('reverts when updating the cache for BPT', async () => {
          await expect(pool.instance.updateTokenRateCache(pool.address)).to.be.revertedWith(
            'TOKEN_DOES_NOT_HAVE_RATE_PROVIDER'
          );
        });

        it('reverts when setting the cache duration for BPT', async () => {
          await expect(pool.instance.connect(owner).setTokenRateCacheDuration(pool.address, 0)).to.be.revertedWith(
            'TOKEN_DOES_NOT_HAVE_RATE_PROVIDER'
          );
        });
      });

      context('when the creation fails', () => {
        it('reverts if the swap fee is too high', async () => {
          const swapFeePercentage = fp(0.1).add(1);

          await expect(deployPool({ swapFeePercentage })).to.be.revertedWith('MAX_SWAP_FEE_PERCENTAGE');
        });
      });
    });

    describe('initialize', () => {
      sharedBeforeEach('deploy pool', async () => {
        await deployPool();
      });

      context('when not initialized', () => {
        context('when not paused', () => {
          it('transfers the initial balances to the vault', async () => {
            const previousBalances = await tokens.balanceOf(pool.vault);

            await pool.init({ initialBalances });

            const currentBalances = await tokens.balanceOf(pool.vault);
            currentBalances.forEach((currentBalance, i) => {
              const initialBalanceIndex = i < bptIndex ? i : i + 1; // initial balances includes BPT
              const expectedBalance = previousBalances[i].add(initialBalances[initialBalanceIndex]);
              expect(currentBalance).to.be.equal(expectedBalance);
            });
          });

          it('mints half the max amount of BPT minus minimum Bpt', async () => {
            await pool.init({ initialBalances });

            expect(await pool.totalSupply()).to.be.equalWithError(PREMINTED_BPT, 0.000000001);
          });

          it('mints the minimum BPT to the address zero', async () => {
            const minimumBpt = await pool.instance.getMinimumBpt();

            await pool.init({ recipient, initialBalances });

            expect(await pool.balanceOf(ZERO_ADDRESS)).to.be.equal(minimumBpt);
          });

          it('mints the invariant amount of BPT to the recipient', async () => {
            const invariant = await pool.estimateInvariant(initialBalances);
            const minimumBpt = await pool.instance.getMinimumBpt();

            await pool.init({ recipient, initialBalances, from: lp });

            expect(await pool.balanceOf(lp)).to.be.zero;
            expect(await pool.balanceOf(recipient)).to.be.equalWithError(invariant.sub(minimumBpt), 0.00001);
          });

          it('mints the rest of the BPT to the vault', async () => {
            const invariant = await pool.estimateInvariant(initialBalances);

            const { amountsIn, dueProtocolFeeAmounts } = await pool.init({ initialBalances });

            const expectedBPT = PREMINTED_BPT.sub(invariant);
            expect(await pool.balanceOf(pool.vault)).to.be.equalWithError(expectedBPT, 0.00001);

            expect(dueProtocolFeeAmounts).to.be.zeros;
            for (let i = 0; i < amountsIn.length; i++) {
              i === bptIndex
                ? expect(amountsIn[i]).to.be.equalWithError(PREMINTED_BPT.sub(invariant), 0.00001)
                : expect(amountsIn[i]).to.be.equal(initialBalances[i]);
            }
          });

          it('reverts with invalid initial balances', async () => {
            await expect(pool.init({ recipient, initialBalances: [fp(1)] })).to.be.revertedWith(
              'INPUT_LENGTH_MISMATCH'
            );
          });
        });

        context('when paused', () => {
          sharedBeforeEach('pause pool', async () => {
            await pool.pause();
          });

          it('reverts', async () => {
            await expect(pool.init({ initialBalances })).to.be.revertedWith('PAUSED');
          });
        });

        context('in recovery mode', () => {
          sharedBeforeEach('enable recovery mode', async () => {
            await pool.enableRecoveryMode(admin);
          });

          it('does not revert', async () => {
            await expect(pool.init({ initialBalances })).to.not.be.reverted;
          });
        });
      });

      context('when it was already initialized', () => {
        sharedBeforeEach('init pool', async () => {
          await pool.init({ initialBalances });
        });

        it('sets the last invariant', async () => {
          const initialInvariant = await pool.estimateInvariant();
          const result = await pool.getLastJoinExitData();

          expect(result.lastJoinExitAmplification).to.equal(AMPLIFICATION_PARAMETER.mul(AMP_PRECISION));
          expect(result.lastPostJoinExitInvariant).to.equalWithError(initialInvariant, 0.000001);
        });

        it('reverts', async () => {
          await expect(pool.init({ initialBalances })).to.be.revertedWith('UNHANDLED_JOIN_KIND');
        });
      });
    });

    describe('beforeJoinExit', () => {
      let registeredBalances: BigNumber[];

      sharedBeforeEach('deploy and initialize pool', async () => {
        await deployPool({ admin });
        await pool.init({ initialBalances, recipient: lp });
        registeredBalances = await pool.getBalances();
      });

      function itPaysProtocolFeesAndReturnsNecessaryData() {
        context('preJoinExitSupply', () => {
          context('when protocol fees are due', () => {
            // This is tested more comprehensively in ComposableStablePoolProtocolFees.
            // Here we just need to check that _beforeJoinExit calls into _payProtocolFeesBeforeJoinExit.
            let registeredBalancesWithFees: BigNumber[];
            let expectedBptAmount: BigNumber;

            const FEE_RELATIVE_ERROR = 1e-3;
            const PROTOCOL_SWAP_FEE_PERCENTAGE = fp(0.5);

            sharedBeforeEach(async () => {
              await pool.vault.setSwapFeePercentage(PROTOCOL_SWAP_FEE_PERCENTAGE);
              await pool.updateProtocolFeePercentageCache();
            });

            sharedBeforeEach(async () => {
              const deltas = range(numberOfTokens + 1).map((_, i) =>
                i !== bptIndex ? registeredBalances[i].mul(random(1, 10)).div(1000) : 0
              );

              registeredBalancesWithFees = arrayAdd(registeredBalances, deltas);

              // We assume all tokens have similar value, and simply add all of the amounts together to represent how
              // much value is being added to the Pool. This is equivalent to assuming the invariant is the sum of the
              // tokens (which is a close approximation while the Pool is balanced).

              const deltaSum = bnSum(deltas);
              const currSum = bnSum(registeredBalancesWithFees.filter((_, i) => i != bptIndex));
              const poolPercentageDueToDeltas = fpDiv(deltaSum, currSum);

              const expectedProtocolOwnershipPercentage = fpMul(
                poolPercentageDueToDeltas,
                PROTOCOL_SWAP_FEE_PERCENTAGE
              );

              // protocol ownership = to mint / (supply + to mint)
              // to mint = supply * protocol ownership / (1 - protocol ownership)
              const preVirtualSupply = await pool.getVirtualSupply();
              expectedBptAmount = preVirtualSupply
                .mul(expectedProtocolOwnershipPercentage)
                .div(FP_100_PCT.sub(expectedProtocolOwnershipPercentage));
            });

            it('returns the total supply after protocol fees are paid', async () => {
              const virtualSupply = await pool.getVirtualSupply();
              const expectedVirtualSupplyAfterProtocolFees = virtualSupply.add(expectedBptAmount);
              const { preJoinExitSupply } = await pool.instance.callStatic.beforeJoinExit(registeredBalancesWithFees);
              expect(preJoinExitSupply).to.be.almostEqual(expectedVirtualSupplyAfterProtocolFees, FEE_RELATIVE_ERROR);
            });
          });

          context('when no protocol fees are due', () => {
            it('returns the total supply', async () => {
              const virtualSupply = await pool.getVirtualSupply();
              const { preJoinExitSupply } = await pool.instance.callStatic.beforeJoinExit(registeredBalances);
              expect(preJoinExitSupply).to.be.eq(virtualSupply);
            });
          });
        });

        it('returns the balances array having dropped the BPT balance', async () => {
          const expectedBalances = registeredBalances.filter((_, i) => i !== bptIndex);
          const { balances } = await pool.instance.callStatic.beforeJoinExit(registeredBalances);
          expect(balances).to.be.deep.eq(expectedBalances);
        });

        it('returns the current amp factor', async () => {
          const { value: expectedAmp } = await pool.getAmplificationParameter();
          const { currentAmp } = await pool.instance.callStatic.beforeJoinExit(registeredBalances);
          expect(currentAmp).to.be.deep.eq(expectedAmp);
        });

        it('returns the pre-join invariant', async () => {
          const { value, precision } = await pool.getAmplificationParameter();

          // We pass a floating point amplification instead of an integer one, to more closely match the behavior in the
          // Pool.
          const expectedInvariant = calculateInvariant(
            registeredBalances.filter((_, i) => i !== bptIndex),
            value.toNumber() / precision.toNumber()
          );

          const { preJoinExitInvariant } = await pool.instance.callStatic.beforeJoinExit(registeredBalances);

          // We allow the invariant to experience a rounding error during calculation, however we want to make sure that
          // we don't accept the invariant calculated using the old amplification factor so we use this strict check.
          const error = preJoinExitInvariant.sub(expectedInvariant).abs();
          expect(error).to.be.lte(1);
        });
      }

      context('when the amplification factor is unchanged from the last join/exit', () => {
        itPaysProtocolFeesAndReturnsNecessaryData();
      });

      context('when the amplification factor has changed from the last join/exit', () => {
        context('when the amplification factor update is ongoing', () => {
          sharedBeforeEach('perform an amp update', async () => {
            await pool.startAmpChange(AMPLIFICATION_PARAMETER.mul(2), (await currentTimestamp()).add(2 * DAY));
            await advanceTime(DAY);
          });

          itPaysProtocolFeesAndReturnsNecessaryData();
        });

        context('when the amplification factor update has finished', () => {
          sharedBeforeEach('perform an amp update', async () => {
            await pool.startAmpChange(AMPLIFICATION_PARAMETER.mul(2), (await currentTimestamp()).add(2 * DAY));
            await advanceTime(3 * DAY);
          });

          itPaysProtocolFeesAndReturnsNecessaryData();
        });
      });
    });

    describe('vault interactions', () => {
      function itStoresThePostInvariantAndAmp(action: () => Promise<void>) {
        describe('getLastJoinExitData', () => {
          sharedBeforeEach(async () => {
            await action();
          });

          function itReturnsTheLastJoinExitData() {
            it('returns the amplification factor at the last join/exit operation', async () => {
              const { lastJoinExitAmplification } = await pool.getLastJoinExitData();
              expect(lastJoinExitAmplification).to.equal(AMPLIFICATION_PARAMETER.mul(AMP_PRECISION));
            });

            it('returns the invariant after the last join/exit operation', async () => {
              const expectedLastInvariant = await pool.estimateInvariant();

              const { lastPostJoinExitInvariant } = await pool.getLastJoinExitData();
              expect(lastPostJoinExitInvariant).to.almostEqual(expectedLastInvariant, 0.000001);
            });
          }

          context('when the amplification factor remains constant', () => {
            itReturnsTheLastJoinExitData();
          });

          context('when the amplification changes', () => {
            sharedBeforeEach(async () => {
              const endValue = AMPLIFICATION_PARAMETER.mul(2);
              const duration = WEEK;
              await pool.startAmpChange(endValue, (await currentTimestamp()).add(duration));
              await advanceTime(duration * 1.5);

              const { value: ampAfter } = await pool.getAmplificationParameter();
              expect(ampAfter).to.equal(endValue.mul(AMP_PRECISION));
            });

            // Even if the amplification factor changes, the value stored should remain the same
            itReturnsTheLastJoinExitData();
          });
        });
      }

      describe('onSwap', () => {
        sharedBeforeEach('deploy pool', async () => {
          await deployPool();
        });

        context('when the pool was not initialized', () => {
          it('reverts', async () => {
            const tx = pool.swapGivenIn({ in: tokens.first, out: tokens.second, amount: FP_ZERO, recipient });
            await expect(tx).to.be.reverted;
          });
        });

        context('when the pool was initialized', () => {
          sharedBeforeEach('initialize pool', async () => {
            bptIndex = await pool.getBptIndex();
            const sender = (await ethers.getSigners())[0];
            await pool.init({ initialBalances, recipient: sender });
          });

          sharedBeforeEach('allow vault', async () => {
            const sender = (await ethers.getSigners())[0];
            await tokens.mint({ to: sender, amount: fp(100) });
            await tokens.approve({ from: sender, to: pool.vault });
          });

          it('fails on a regular swap if caller is not the vault', async () => {
            const swapRequest = {
              kind: SwapKind.GivenIn,
              tokenIn: tokens.first.address,
              tokenOut: tokens.get(1).address,
              amount: fp(1),
              poolId: pool.poolId,
              lastChangeBlock: 0,
              from: lp.address,
              to: lp.address,
              userData: '0x',
            };

            await expect(pool.instance.connect(lp).onSwap(swapRequest, initialBalances, 0, 1)).to.be.revertedWith(
              'CALLER_NOT_VAULT'
            );
          });

          it('fails on a BPT swap if caller is not the vault', async () => {
            const swapRequest = {
              kind: SwapKind.GivenIn,
              tokenIn: tokens.first.address,
              tokenOut: pool.bpt.address,
              amount: fp(1),
              poolId: pool.poolId,
              lastChangeBlock: 0,
              from: lp.address,
              to: lp.address,
              userData: '0x',
            };

            await expect(pool.instance.connect(lp).onSwap(swapRequest, initialBalances, 0, 1)).to.be.revertedWith(
              'CALLER_NOT_VAULT'
            );
          });

          context('token out given token in', () => {
            const amountIn = fp(0.1);

            async function itSwapsTokensGivenIn(): Promise<void> {
              it('swaps tokens', async () => {
                const tokenIn = tokens.first;
                const tokenOut = tokens.second;

                const previousBalance = await tokenOut.balanceOf(recipient);
                const expectedAmountOut = await pool.estimateTokenOutGivenTokenIn(tokenIn, tokenOut, amountIn);

                const { amountOut } = await pool.swapGivenIn({
                  in: tokenIn,
                  out: tokenOut,
                  amount: amountIn,
                  recipient,
                });
                expect(amountOut).to.be.equalWithError(expectedAmountOut, 0.00001);

                const currentBalance = await tokenOut.balanceOf(recipient);
                expect(currentBalance.sub(previousBalance)).to.be.equalWithError(expectedAmountOut, 0.00001);
              });
            }

            itSwapsTokensGivenIn();

            context('when paused', () => {
              sharedBeforeEach('pause pool', async () => {
                await pool.pause();
              });

              it('reverts', async () => {
                await expect(
                  pool.swapGivenIn({ in: tokens.first, out: tokens.second, amount: amountIn, recipient })
                ).to.be.revertedWith('PAUSED');
              });
            });

            context('when in recovery mode', () => {
              sharedBeforeEach('enable recovery mode', async () => {
                await pool.enableRecoveryMode(admin);
              });

              itSwapsTokensGivenIn();
            });
          });

          context('token in given token out', () => {
            const amountOut = fp(0.1);

            async function itSwapsTokensGivenOut(): Promise<void> {
              it('swaps tokens', async () => {
                const tokenIn = tokens.first;
                const tokenOut = tokens.second;

                const previousBalance = await tokenOut.balanceOf(recipient);
                const expectedAmountIn = await pool.estimateTokenInGivenTokenOut(tokenIn, tokenOut, amountOut);

                const { amountIn } = await pool.swapGivenOut({
                  in: tokenIn,
                  out: tokenOut,
                  amount: amountOut,
                  recipient,
                });
                expect(amountIn).to.be.equalWithError(expectedAmountIn, 0.00001);

                const currentBalance = await tokenOut.balanceOf(recipient);
                expect(currentBalance.sub(previousBalance)).to.be.equal(amountOut);
              });
            }

            itSwapsTokensGivenOut();

            context('when paused', () => {
              sharedBeforeEach('pause pool', async () => {
                await pool.pause();
              });

              it('reverts', async () => {
                await expect(
                  pool.swapGivenOut({ in: tokens.first, out: tokens.second, amount: amountOut, recipient })
                ).to.be.revertedWith('PAUSED');
              });
            });

            context('when in recovery mode', async () => {
              sharedBeforeEach('enable recovery mode', async () => {
                await pool.enableRecoveryMode(admin);
              });

              itSwapsTokensGivenOut();
            });
          });

          context('token out given BPT in', () => {
            const bptIn = fp(1);

            async function itSwapsTokenOutGivenBptIn(): Promise<void> {
              it('swaps exact BPT for token', async () => {
                const tokenOut = tokens.first;

                const previousBalance = await tokenOut.balanceOf(recipient);
                const expectedTokenOut = await pool.estimateTokenOutGivenBptIn(tokenOut, bptIn);

                const { amountOut } = await pool.swapGivenIn({ in: pool.bpt, out: tokenOut, amount: bptIn, recipient });
                expect(amountOut).to.be.equalWithError(expectedTokenOut, 0.00001);

                const currentBalance = await tokenOut.balanceOf(recipient);
                expect(currentBalance.sub(previousBalance)).to.be.equalWithError(expectedTokenOut, 0.00001);
              });

              itStoresThePostInvariantAndAmp(async () => {
                const tokenOut = tokens.first;
                await pool.swapGivenIn({ in: pool.bpt, out: tokenOut, amount: bptIn, recipient });
              });
            }

            itSwapsTokenOutGivenBptIn();

            context('when paused', () => {
              sharedBeforeEach('pause pool', async () => {
                await pool.pause();
              });

              it('reverts', async () => {
                await expect(
                  pool.swapGivenIn({ in: pool.bpt, out: tokens.first, amount: bptIn, recipient })
                ).to.be.revertedWith('PAUSED');
              });
            });

            context('when in recovery mode', async () => {
              sharedBeforeEach('enable recovery mode', async () => {
                await pool.enableRecoveryMode(admin);
              });

              itSwapsTokenOutGivenBptIn();
            });
          });

          context('token in given BPT out', () => {
            const bptOut = fp(1);

            async function itSwapsTokenForExactBpt(): Promise<void> {
              it('swaps token for exact BPT', async () => {
                const tokenIn = tokens.first;

                const previousBalance = await pool.balanceOf(recipient);
                const expectedTokenIn = await pool.estimateTokenInGivenBptOut(tokenIn, bptOut);

                const { amountIn } = await pool.swapGivenOut({ in: tokenIn, out: pool.bpt, amount: bptOut, recipient });
                expect(amountIn).to.be.equalWithError(expectedTokenIn, 0.00001);

                const currentBalance = await pool.balanceOf(recipient);
                expect(currentBalance.sub(previousBalance)).to.be.equal(bptOut);
              });

              itStoresThePostInvariantAndAmp(async () => {
                const tokenIn = tokens.first;
                await pool.swapGivenOut({ in: tokenIn, out: pool.bpt, amount: bptOut, recipient });
              });
            }

            itSwapsTokenForExactBpt();

            context('when paused', () => {
              sharedBeforeEach('pause pool', async () => {
                await pool.pause();
              });

              it('reverts', async () => {
                await expect(
                  pool.swapGivenOut({ in: tokens.first, out: pool.bpt, amount: bptOut, recipient })
                ).to.be.revertedWith('PAUSED');
              });
            });

            context('when in recovery mode', async () => {
              sharedBeforeEach('enable recovery mode', async () => {
                await pool.enableRecoveryMode(admin);
              });

              itSwapsTokenForExactBpt();
            });
          });

          context('BPT out given token in', () => {
            const amountIn = fp(1);

            async function itSwapsExactTokenForBpt(): Promise<void> {
              it('swaps exact token for BPT', async () => {
                const tokenIn = tokens.first;

                const previousBalance = await pool.balanceOf(recipient);
                const expectedBptOut = await pool.estimateBptOutGivenTokenIn(tokenIn, amountIn);

                const { amountOut } = await pool.swapGivenIn({
                  in: tokenIn,
                  out: pool.bpt,
                  amount: amountIn,
                  recipient,
                });
                expect(amountOut).to.be.equalWithError(expectedBptOut, 0.00001);

                const currentBalance = await pool.balanceOf(recipient);
                expect(currentBalance.sub(previousBalance)).to.be.equalWithError(expectedBptOut, 0.00001);
              });

              itStoresThePostInvariantAndAmp(async () => {
                const tokenIn = tokens.first;
                await pool.swapGivenIn({
                  in: tokenIn,
                  out: pool.bpt,
                  amount: amountIn,
                  recipient,
                });
              });
            }

            itSwapsExactTokenForBpt();

            context('when paused', () => {
              sharedBeforeEach('pause pool', async () => {
                await pool.pause();
              });

              it('reverts', async () => {
                await expect(
                  pool.swapGivenIn({ in: tokens.first, out: pool.bpt, amount: amountIn, recipient })
                ).to.be.revertedWith('PAUSED');
              });
            });

            context('when in recovery mode', async () => {
              sharedBeforeEach('enable recovery mode', async () => {
                await pool.enableRecoveryMode(admin);
              });

              itSwapsExactTokenForBpt();
            });
          });

          context('BPT in given token out', () => {
            const amountOut = fp(0.1);

            async function itSwapsBptForExactTokens(): Promise<void> {
              it('swaps BPT for exact tokens', async () => {
                const tokenOut = tokens.first;

                const previousBalance = await tokenOut.balanceOf(recipient);
                const expectedBptIn = await pool.estimateBptInGivenTokenOut(tokenOut, amountOut);

                const { amountIn } = await pool.swapGivenOut({
                  in: pool.bpt,
                  out: tokenOut,
                  amount: amountOut,
                  recipient,
                });
                expect(amountIn).to.be.equalWithError(expectedBptIn, 0.00001);

                const currentBalance = await tokenOut.balanceOf(recipient);
                expect(currentBalance.sub(previousBalance)).to.be.equal(amountOut);
              });

              itStoresThePostInvariantAndAmp(async () => {
                const tokenOut = tokens.first;
                await pool.swapGivenOut({
                  in: pool.bpt,
                  out: tokenOut,
                  amount: amountOut,
                  recipient,
                });
              });
            }

            itSwapsBptForExactTokens();

            context('when paused', () => {
              sharedBeforeEach('pause pool', async () => {
                await pool.pause();
              });

              it('reverts', async () => {
                await expect(
                  pool.swapGivenOut({ in: pool.bpt, out: tokens.first, amount: amountOut, recipient })
                ).to.be.revertedWith('PAUSED');
              });
            });

            context('when in recovery mode', async () => {
              sharedBeforeEach('enable recovery mode', async () => {
                await pool.enableRecoveryMode(admin);
              });

              itSwapsBptForExactTokens();
            });
          });
        });
      });

      describe('onJoinPool', () => {
        let tokenIndexWithBpt: number;
        let tokenIndexWithoutBpt: number;
        let token: Token;

        sharedBeforeEach('deploy pool', async () => {
          await deployPool({ admin });
        });

        sharedBeforeEach('allow vault', async () => {
          await tokens.mint({ to: recipient, amount: fp(100) });
          await tokens.approve({ from: recipient, to: pool.vault });
        });

        sharedBeforeEach('get token to join with', async () => {
          // tokens are sorted, and do not include BPT, so get the last one
          tokenIndexWithoutBpt = Math.floor(Math.random() * numberOfTokens);
          token = tokens.get(tokenIndexWithoutBpt);
          tokenIndexWithBpt = tokenIndexWithoutBpt < pool.bptIndex ? tokenIndexWithoutBpt : tokenIndexWithoutBpt + 1;
        });

        it('fails if caller is not the vault', async () => {
          await expect(
            pool.instance.connect(lp).onJoinPool(pool.poolId, lp.address, other.address, [0], 0, 0, '0x')
          ).to.be.revertedWith('CALLER_NOT_VAULT');
        });

        it('fails if no user data', async () => {
          await expect(pool.join({ data: '0x' })).to.be.revertedWith('Transaction reverted without a reason');
        });

        it('fails if wrong user data', async () => {
          const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

          await expect(pool.join({ data: wrongUserData })).to.be.revertedWith('Transaction reverted without a reason');
        });

        describe('join exact tokens in for BPT out', () => {
          context('not in recovery mode', () => {
            itJoinsGivenExactTokensInCorrectly();
          });

          context('in recovery mode', () => {
            sharedBeforeEach('enable recovery mode', async () => {
              await pool.enableRecoveryMode(admin);
            });

            itJoinsGivenExactTokensInCorrectly();
          });

          function itJoinsGivenExactTokensInCorrectly() {
            it('fails if not initialized', async () => {
              await expect(pool.joinGivenIn({ recipient, amountsIn: initialBalances })).to.be.revertedWith(
                'UNINITIALIZED'
              );
            });

            context('once initialized', () => {
              let expectedBptOut: BigNumberish;
              let amountsIn: BigNumberish[];

              sharedBeforeEach('initialize pool', async () => {
                await pool.init({ recipient, initialBalances });
                bptIndex = await pool.getBptIndex();
                amountsIn = ZEROS.map((n, i) => (i != bptIndex ? fp(0.1) : n));

                expectedBptOut = await pool.estimateBptOut(
                  await pool.upscale(amountsIn),
                  await pool.upscale(initialBalances)
                );
              });

              it('grants BPT for exact tokens', async () => {
                const previousBptBalance = await pool.balanceOf(recipient);
                const minimumBptOut = pct(expectedBptOut, 0.99);

                const result = await pool.joinGivenIn({ amountsIn, minimumBptOut, recipient, from: recipient });

                // Amounts in should be the same as initial ones
                expect(result.amountsIn).to.deep.equal(amountsIn);

                // Make sure received BPT is close to what we expect
                const currentBptBalance = await pool.balanceOf(recipient);
                expect(currentBptBalance.sub(previousBptBalance)).to.be.equalWithError(expectedBptOut, 0.0001);
              });

              it('can tell how much BPT it will give in return', async () => {
                const minimumBptOut = pct(expectedBptOut, 0.99);

                const queryResult = await pool.queryJoinGivenIn({ amountsIn, minimumBptOut });

                expect(queryResult.amountsIn).to.deep.equal(amountsIn);
                expect(queryResult.bptOut).to.be.equalWithError(expectedBptOut, 0.0001);

                // Query and join should match exactly
                const result = await pool.joinGivenIn({ amountsIn, minimumBptOut, recipient, from: recipient });
                expect(result.amountsIn).to.deep.equal(queryResult.amountsIn);
              });

              it('join and joinSwap give the same result', async () => {
                // To test the swap, need to have only a single non-zero amountIn
                const swapAmountsIn = Array(initialBalances.length).fill(0);
                swapAmountsIn[tokenIndexWithBpt] = amountsIn[tokenIndexWithBpt];

                const queryResult = await pool.queryJoinGivenIn({ amountsIn: swapAmountsIn, recipient });

                const amountOut = await pool.querySwapGivenIn({
                  from: recipient,
                  in: token,
                  out: pool.bpt,
                  amount: swapAmountsIn[tokenIndexWithBpt],
                  recipient: recipient,
                });

                expect(amountOut).to.be.equal(queryResult.bptOut);
              });

              itStoresThePostInvariantAndAmp(async () => {
                const minimumBptOut = pct(expectedBptOut, 0.99);
                await pool.joinGivenIn({ amountsIn, minimumBptOut, recipient, from: recipient });
              });

              it('fails if not enough BPT', async () => {
                // This call should fail because we are requesting minimum 1% more
                const minimumBptOut = pct(expectedBptOut, 1.01);

                await expect(pool.joinGivenIn({ amountsIn, minimumBptOut })).to.be.revertedWith('BPT_OUT_MIN_AMOUNT');
              });

              it('reverts if amountsIn is the wrong length', async () => {
                await expect(pool.joinGivenIn({ amountsIn: [fp(1)] })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
              });

              it('reverts if paused', async () => {
                await pool.pause();

                await expect(pool.joinGivenIn({ amountsIn })).to.be.revertedWith('PAUSED');
              });
            });
          }
        });

        describe('join token in for exact BPT out', () => {
          context('not in recovery mode', () => {
            itJoinsExactBPTOutCorrectly();
          });

          context('in recovery mode', () => {
            sharedBeforeEach('enable recovery mode', async () => {
              await pool.enableRecoveryMode(admin);
            });

            itJoinsExactBPTOutCorrectly();
          });

          function itJoinsExactBPTOutCorrectly() {
            it('fails if not initialized', async () => {
              await expect(pool.singleJoinGivenOut({ bptOut: fp(2), token })).to.be.revertedWith('UNINITIALIZED');
            });

            context('once initialized', () => {
              sharedBeforeEach('initialize pool', async () => {
                await pool.init({ recipient, initialBalances });
              });

              it('reverts if the tokenIndex passed in is invalid', async () => {
                const previousBptBalance = await pool.balanceOf(recipient);
                const bptOut = pct(previousBptBalance, 0.2);

                await expect(
                  pool.singleJoinGivenOut({ from: recipient, recipient, bptOut, token: 100 })
                ).to.be.revertedWith('OUT_OF_BOUNDS');
              });

              it('grants exact BPT for token in', async () => {
                const previousBptBalance = await pool.balanceOf(recipient);
                // 20% of previous balance
                const bptOut = pct(previousBptBalance, 0.2);
                const expectedAmountIn = await pool.estimateTokenInGivenBptOut(token, bptOut);

                const result = await pool.singleJoinGivenOut({ from: recipient, recipient, bptOut, token });

                // Only token in should be the one transferred
                expect(result.amountsIn[tokenIndexWithBpt]).to.be.equalWithError(expectedAmountIn, 0.001);
                expect(result.amountsIn.filter((_, i) => i != tokenIndexWithBpt)).to.be.zeros;

                // Make sure received BPT is close to what we expect
                const currentBptBalance = await pool.balanceOf(recipient);
                expect(currentBptBalance.sub(previousBptBalance)).to.be.equal(bptOut);
              });

              it('can tell how many tokens it will receive', async () => {
                const previousBptBalance = await pool.balanceOf(recipient);
                // 20% of previous balance
                const bptOut = pct(previousBptBalance, 0.2);

                const queryResult = await pool.querySingleJoinGivenOut({ recipient, bptOut, token });

                expect(queryResult.bptOut).to.be.equal(bptOut);
                expect(queryResult.amountsIn.filter((_, i) => i != tokenIndexWithBpt)).to.be.zeros;

                const result = await pool.singleJoinGivenOut({ from: recipient, bptOut, token });
                // Query and join should match exactly
                expect(result.amountsIn[tokenIndexWithBpt]).to.equal(queryResult.amountsIn[tokenIndexWithBpt]);
              });

              it('join and joinSwap give the same result', async () => {
                const previousBptBalance = await pool.balanceOf(recipient);
                // 32.5% of previous balance
                const bptOut = pct(previousBptBalance, 0.325);

                const queryResult = await pool.querySingleJoinGivenOut({ recipient, bptOut, token });

                const amountIn = await pool.querySwapGivenOut({
                  from: recipient,
                  in: token,
                  out: pool.bpt,
                  amount: bptOut,
                  recipient: lp,
                });

                expect(amountIn).to.be.equal(queryResult.amountsIn[tokenIndexWithBpt]);
              });

              itStoresThePostInvariantAndAmp(async () => {
                const previousBptBalance = await pool.balanceOf(recipient);
                const bptOut = pct(previousBptBalance, 0.2);
                await pool.singleJoinGivenOut({ from: recipient, recipient, bptOut, token });
              });

              it('reverts if paused', async () => {
                await pool.pause();

                await expect(pool.singleJoinGivenOut({ bptOut: fp(2), token })).to.be.revertedWith('PAUSED');
              });
            });
          }
        });

        describe('join all tokens in for exact BPT out', () => {
          context('not in recovery mode', () => {
            itJoinsGivenExactBPTOutCorrectly();
          });

          context('in recovery mode', () => {
            sharedBeforeEach('enable recovery mode', async () => {
              await pool.enableRecoveryMode(admin);
            });

            itJoinsGivenExactBPTOutCorrectly();
          });

          function itJoinsGivenExactBPTOutCorrectly() {
            it('fails if not initialized', async () => {
              await expect(pool.joinGivenOut({ recipient, bptOut: fp(1) })).to.be.revertedWith('UNINITIALIZED');
            });

            context('once initialized', () => {
              let bptOut: BigNumberish;
              let expectedAmountsIn: BigNumberish[];
              let previousBptBalance: BigNumberish;

              sharedBeforeEach('initialize pool', async () => {
                await pool.init({ recipient, initialBalances });
                bptIndex = await pool.getBptIndex();
                expectedAmountsIn = initialBalances.map((n, i) => (i != bptIndex ? bn(n).div(3) : 0));
                previousBptBalance = await pool.balanceOf(recipient);

                bptOut = previousBptBalance.div(3);
              });

              it('grants tokens for exact BPT', async () => {
                const result = await pool.joinGivenOut({ bptOut, recipient, from: recipient });

                // Amounts out should be 1/3 the initial balances
                expect(result.amountsIn).to.equalWithError(expectedAmountsIn, 0.0000001);

                // Make sure received BPT is close to what we expect
                const currentBptBalance = await pool.balanceOf(recipient);
                expect(currentBptBalance).to.be.equalWithError(bn(previousBptBalance).add(bptOut), 0.001);
              });

              it('reverts if paused', async () => {
                await pool.pause();

                await expect(pool.joinGivenOut({ bptOut })).to.be.revertedWith('PAUSED');
              });
            });
          }
        });
      });

      describe('onExitPool', () => {
        let previousBptBalance: BigNumber;
        let tokenIndexWithoutBpt: number;
        let tokenIndexWithBpt: number;
        let token: Token;

        sharedBeforeEach('deploy and initialize pool', async () => {
          await deployPool({ admin });
          await pool.init({ initialBalances, recipient: lp });
          previousBptBalance = await pool.balanceOf(lp);
        });

        sharedBeforeEach('allow vault', async () => {
          await tokens.mint({ to: lp, amount: fp(100) });
          await tokens.approve({ from: lp, to: pool.vault });
        });

        sharedBeforeEach('get token to exit with', async () => {
          // tokens are sorted, and do not include BPT, so get the last one
          tokenIndexWithoutBpt = Math.floor(Math.random() * numberOfTokens);
          token = tokens.get(tokenIndexWithoutBpt);
          tokenIndexWithBpt = tokenIndexWithoutBpt < pool.bptIndex ? tokenIndexWithoutBpt : tokenIndexWithoutBpt + 1;
        });

        it('fails if caller is not the vault', async () => {
          await expect(
            pool.instance.connect(lp).onExitPool(pool.poolId, recipient.address, other.address, [0], 0, 0, '0x')
          ).to.be.revertedWith('CALLER_NOT_VAULT');
        });

        it('fails if no user data', async () => {
          await expect(pool.exit({ data: '0x' })).to.be.revertedWith('Transaction reverted without a reason');
        });

        it('fails if wrong user data', async () => {
          const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

          await expect(pool.exit({ data: wrongUserData })).to.be.revertedWith('Transaction reverted without a reason');
        });

        describe('exit BPT in for one token out', () => {
          context('not in recovery mode', () => {
            itExitsExactBptInForOneTokenOutProperly();
          });

          context('in recovery mode', () => {
            sharedBeforeEach('enable recovery mode', async () => {
              await pool.enableRecoveryMode(admin);
            });

            itExitsExactBptInForOneTokenOutProperly();
          });

          function itExitsExactBptInForOneTokenOutProperly() {
            it('reverts if the tokenIndex passed in is invalid', async () => {
              const previousBptBalance = await pool.balanceOf(lp);
              const bptIn = pct(previousBptBalance, 0.2);

              await expect(pool.singleExitGivenIn({ from: lp, bptIn, token: 100 })).to.be.revertedWith('OUT_OF_BOUNDS');
            });

            it('grants one token for exact bpt', async () => {
              // 20% of previous balance
              const previousBptBalance = await pool.balanceOf(lp);
              const bptIn = pct(previousBptBalance, 0.2);
              const expectedTokenOut = await pool.estimateTokenOutGivenBptIn(token, bptIn);

              const result = await pool.singleExitGivenIn({ from: lp, bptIn, token });

              // Only token out should be the one transferred
              expect(result.amountsOut[tokenIndexWithBpt]).to.be.equalWithError(expectedTokenOut, 0.0001);
              expect(result.amountsOut.filter((_, i) => i != tokenIndexWithBpt)).to.be.zeros;

              const bptAfter = await pool.balanceOf(lp);

              // Current BPT balance should decrease
              expect(previousBptBalance.sub(bptIn)).to.equal(bptAfter);
            });

            it('can tell how many tokens it will give in return', async () => {
              const bptIn = pct(await pool.balanceOf(lp), 0.2);
              const queryResult = await pool.querySingleExitGivenIn({ bptIn, token });

              expect(queryResult.bptIn).to.equal(bptIn);
              expect(queryResult.amountsOut.filter((_, i) => i != tokenIndexWithBpt)).to.be.zeros;

              const result = await pool.singleExitGivenIn({ from: lp, bptIn, token });
              expect(result.amountsOut.filter((_, i) => i != tokenIndexWithBpt)).to.be.zeros;

              // Query and exit should match exactly
              expect(result.amountsOut[tokenIndexWithBpt]).to.equal(queryResult.amountsOut[tokenIndexWithBpt]);
            });

            it('exit and exitSwap give the same result', async () => {
              const bptIn = pct(await pool.balanceOf(lp), 0.2);
              const queryResult = await pool.querySingleExitGivenIn({ bptIn, token });

              const amountOut = await pool.querySwapGivenIn({
                from: lp,
                in: pool.bpt,
                out: token,
                amount: bptIn,
                recipient: lp,
              });
              expect(queryResult.amountsOut[tokenIndexWithBpt]).to.equal(amountOut);
            });

            itStoresThePostInvariantAndAmp(async () => {
              const previousBptBalance = await pool.balanceOf(lp);
              const bptIn = pct(previousBptBalance, 0.2);

              await pool.singleExitGivenIn({ from: lp, bptIn, token });
            });

            it('reverts if paused', async () => {
              await pool.pause();

              await expect(pool.singleExitGivenIn({ from: lp, bptIn: fp(1), token })).to.be.revertedWith('PAUSED');
            });
          }
        });

        describe('exit BPT in for exact tokens out', () => {
          context('not in recovery mode', () => {
            itExitsBptInForExactTokensOutProperly();
          });

          context('in recovery mode', () => {
            sharedBeforeEach('enable recovery mode', async () => {
              await pool.enableRecoveryMode(admin);
            });

            itExitsBptInForExactTokensOutProperly();
          });

          function itExitsBptInForExactTokensOutProperly() {
            it('grants exact tokens for bpt', async () => {
              // Request a third of the token balances
              const amountsOut = initialBalances.map((balance) => bn(balance).div(3));

              // Exit with a third of the BPT balance
              const expectedBptIn = previousBptBalance.div(3);
              const maximumBptIn = pct(expectedBptIn, 1.01);

              const result = await pool.exitGivenOut({ from: lp, amountsOut, maximumBptIn });

              // Token balances should been reduced as requested
              expect(result.amountsOut).to.deep.equal(amountsOut);

              // BPT balance should have been reduced to 2/3 because we are returning 1/3 of the tokens
              expect(await pool.balanceOf(lp)).to.be.equalWithError(previousBptBalance.sub(expectedBptIn), 0.001);
            });

            it('fails if more BPT needed', async () => {
              // Call should fail because we are requesting a max amount lower than the actual needed
              const amountsOut = initialBalances;
              const maximumBptIn = previousBptBalance.div(2);

              await expect(pool.exitGivenOut({ from: lp, amountsOut, maximumBptIn })).to.be.revertedWith(
                'BPT_IN_MAX_AMOUNT'
              );
            });

            it('can tell how much BPT it will have to receive', async () => {
              const amountsOut = initialBalances.map((balance) => bn(balance).div(2));
              const expectedBptIn = previousBptBalance.div(2);
              const maximumBptIn = pct(expectedBptIn, 1.01);

              const queryResult = await pool.queryExitGivenOut({ amountsOut, maximumBptIn });

              expect(queryResult.amountsOut).to.deep.equal(amountsOut);
              expect(queryResult.bptIn).to.be.equalWithError(previousBptBalance.div(2), 0.001);

              // Query and exit should match exactly
              const result = await pool.exitGivenOut({ from: lp, amountsOut, maximumBptIn });
              expect(result.amountsOut).to.deep.equal(queryResult.amountsOut);
            });

            it('exit and exitSwap give the same result', async () => {
              // To test the swap, need to have only a single non-zero amountIn
              const amountsOut = initialBalances.map((balance, i) => (i == tokenIndexWithBpt ? bn(balance).div(2) : 0));
              const queryResult = await pool.queryExitGivenOut({ amountsOut, maximumBptIn: previousBptBalance });

              const bptIn = await pool.querySwapGivenOut({
                from: lp,
                in: pool.bpt,
                out: token,
                amount: amountsOut[tokenIndexWithBpt],
                recipient: lp,
              });

              expect(bptIn).to.be.equal(queryResult.bptIn);
            });

            it('reverts if amountsOut is the wrong length', async () => {
              await expect(pool.exitGivenOut({ amountsOut: [fp(1)] })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
            });

            itStoresThePostInvariantAndAmp(async () => {
              const amountsOut = initialBalances.map((balance) => bn(balance).div(3));
              const expectedBptIn = previousBptBalance.div(3);
              const maximumBptIn = pct(expectedBptIn, 1.01);

              await pool.exitGivenOut({ from: lp, amountsOut, maximumBptIn });
            });

            it('reverts if paused', async () => {
              await pool.pause();

              const amountsOut = initialBalances;
              await expect(pool.exitGivenOut({ from: lp, amountsOut })).to.be.revertedWith('PAUSED');
            });
          }
        });

        describe('exit exact BPT in for all tokens out', () => {
          context('not in recovery mode', () => {
            itExitsExactBptInForTokensOutProperly();
          });

          context('in recovery mode', () => {
            sharedBeforeEach('enable recovery mode', async () => {
              await pool.enableRecoveryMode(admin);
            });

            itExitsExactBptInForTokensOutProperly();
          });

          function itExitsExactBptInForTokensOutProperly() {
            it('grants tokens for exact bpt', async () => {
              // Request a third of the token balances
              const expectedAmountsOut = initialBalances.map((balance) => bn(balance).div(3));
              // Exit with a third of the BPT balance
              const expectedBptIn = previousBptBalance.div(3);

              const result = await pool.exitGivenIn({ from: lp, bptIn: expectedBptIn });

              // Token balances should been reduced as requested
              expect(result.amountsOut).to.be.equalWithError(expectedAmountsOut, 0.00001);

              // BPT balance should have been reduced to 2/3 because we are returning 1/3 of the tokens
              expect(await pool.balanceOf(lp)).to.be.equalWithError(previousBptBalance.sub(expectedBptIn), 0.001);
            });

            it('reverts if paused', async () => {
              await pool.pause();

              await expect(pool.exitGivenIn({ from: lp, bptIn: previousBptBalance })).to.be.revertedWith('PAUSED');
            });
          }
        });
      });
    });

    describe('rates cache', () => {
      context('with no rate provider', () => {
        sharedBeforeEach('deploy pool', async () => {
          const tokenParams = Array.from({ length: numberOfTokens }, (_, i) => ({ decimals: 18 - i }));
          tokens = await TokenList.create(tokenParams, { sorted: true, varyDecimals: true });

          pool = await StablePool.create({
            tokens,
            rateProviders: new Array(tokens.length).fill(ZERO_ADDRESS),
            tokenRateCacheDurations: new Array(tokens.length).fill(0),
            owner,
          });
        });

        it('has no rate providers', async () => {
          // length + 1 as there is also a rate provider for the BPT itself
          expect(await pool.getRateProviders()).to.deep.equal(new Array(tokens.length + 1).fill(ZERO_ADDRESS));
        });

        it('scaling factors equal the decimals difference', async () => {
          const { tokens } = await pool.vault.getPoolTokens(pool.poolId);
          const factors = await pool.instance.getScalingFactors();

          await Promise.all(
            tokens.map(async (token, i) => {
              const decimals = await (await deployedAt('v2-solidity-utils/ERC20', token)).decimals();
              expect(factors[i]).to.equal(fp(bn(10).pow(18 - decimals)));
            })
          );
        });

        it('updating the cache reverts', async () => {
          await tokens.asyncEach(async (token) => {
            await expect(pool.updateTokenRateCache(token)).to.be.revertedWith('TOKEN_DOES_NOT_HAVE_RATE_PROVIDER');
          });
        });

        it('querying the cache reverts', async () => {
          await tokens.asyncEach(async (token) => {
            await expect(pool.getTokenRateCache(token)).to.be.revertedWith('TOKEN_DOES_NOT_HAVE_RATE_PROVIDER');
          });
        });
      });

      const getExpectedScalingFactor = async (token: Token): Promise<BigNumber> => {
        const index = tokens.indexOf(token);
        const rateProvider = rateProviders[index];
        const rate = await rateProvider.getRate();
        return rate.mul(bn(10).pow(18 - token.decimals));
      };

      context('with a rate provider', () => {
        sharedBeforeEach('deploy pool', async () => {
          const tokenParams = Array.from({ length: numberOfTokens }, (_, i) => ({ decimals: 18 - i }));
          tokens = await TokenList.create(tokenParams, { sorted: true });

          const tokenRates = Array.from({ length: numberOfTokens }, (_, i) => fp(1 + (i + 1) / 10));
          await deployPool({ tokens }, tokenRates);
        });

        describe('with upstream getRate failures', () => {
          const newRate = fp(4.5);

          sharedBeforeEach('set rate failure mode', async () => {
            await pool.setRateFailure(true);
          });

          it('reverts', async () => {
            await tokens.asyncEach(async (token, i) => {
              await rateProviders[i].mockRate(newRate);

              await expect(pool.updateTokenRateCache(token)).to.be.revertedWith('INDUCED_FAILURE');
            });
          });
        });
      });

      context('with a rate provider and zero durations', () => {
        sharedBeforeEach('deploy pool', async () => {
          const tokenParams = Array.from({ length: numberOfTokens }, (_, i) => ({ decimals: 18 - i }));
          tokens = await TokenList.create(tokenParams, { sorted: true });

          const tokenRates = Array.from({ length: numberOfTokens }, (_, i) => fp(1 + (i + 1) / 10));
          const durations = Array(tokens.length).fill(0);
          await deployPool({ tokens }, tokenRates, durations);
        });

        describe('when rates are updated between operations', () => {
          let previousScalingFactors: BigNumber[];
          let token: Token;
          let tokenIndexWithBpt: number;

          async function updateExternalRates(): Promise<void> {
            await tokens.asyncEach(async (token, i) => {
              const previousCache = await pool.getTokenRateCache(token);
              const value = Math.random() / 5;

              await rateProviders[i].mockRate(
                fpMul(previousCache.rate, Math.random() > 0.5 ? fp(1 + value) : fp(1 - value))
              );
            });
          }

          async function verifyScalingFactors(newScalingFactors: BigNumber[]): Promise<void> {
            await tokens.asyncEach(async (token) => {
              const expectedScalingFactor = await getExpectedScalingFactor(token);
              const tokenIndex = await pool.getTokenIndex(token);
              expect(newScalingFactors[tokenIndex]).to.be.equal(expectedScalingFactor);

              const actualFactors = await pool.getScalingFactors();
              expect(actualFactors[tokenIndex]).to.be.equal(expectedScalingFactor);
            });

            expect(newScalingFactors[pool.bptIndex]).to.be.equal(FP_ONE);
          }

          sharedBeforeEach('fund lp and pool', async () => {
            await tokens.mint({ to: lp, amount: fp(10000) });
            await tokens.approve({ from: lp, to: pool.vault });

            await pool.init({ initialBalances, recipient: lp });
          });

          sharedBeforeEach('save starting values and compute tokenIndex', async () => {
            previousScalingFactors = await pool.getScalingFactors();

            const tokenIndexWithoutBpt = numberOfTokens - 1;
            token = tokens.get(tokenIndexWithoutBpt);
            tokenIndexWithBpt = tokenIndexWithoutBpt < pool.bptIndex ? tokenIndexWithoutBpt : tokenIndexWithoutBpt + 1;
          });

          async function expectScalingFactorsToBeUpdated(
            query: () => Promise<BigNumberish>,
            actual: () => Promise<BigNumberish>
          ) {
            // Perform a query with the current rate values
            const firstQueryAmount = await query();

            // The cache should be updated on the next action
            await updateExternalRates();

            // Verify the new rates are not yet loaded
            const preOpScalingFactors = await pool.getScalingFactors();
            for (let i = 0; i < preOpScalingFactors.length; i++) {
              if (i != pool.bptIndex) {
                expect(preOpScalingFactors[i]).to.equal(previousScalingFactors[i]);
              }
            }

            // Query again, after the rates have been updated (should use the new values in the cache)
            const secondQueryAmount = await query();

            // Now we perform the actual operation - the result should be different from the first query,
            // but equal to the second. This will also cause the scaling factors to be updated.
            // This must not be a query as we want to check the updated state after the transaction.
            const actualAmount = await actual();

            // Verify the new rates are reflected in the scaling factors
            await verifyScalingFactors(await pool.getScalingFactors());

            // The query first and second query results should be different, since the cache was updated in between
            expect(secondQueryAmount).to.not.equal(firstQueryAmount);
            // The actual results should match the second query (after the rate update)
            expect(secondQueryAmount).to.equal(actualAmount);
          }

          it('swaps use the new rates', async () => {
            const { balances, tokens: allTokens } = await pool.getTokens();
            const tokenIndex = allTokens.indexOf(tokens.first.address);

            const amountIn = balances[tokenIndex].div(5);

            const swapArgs = {
              in: tokens.first,
              out: tokens.second,
              amount: amountIn,
              from: lp,
              recipient: lp,
            };
            const query = () => pool.querySwapGivenIn(swapArgs);
            const actual = async () => (await pool.swapGivenIn(swapArgs)).amountOut;
            await expectScalingFactorsToBeUpdated(query, actual);
          });

          it('joins use the new rates', async () => {
            const previousBptBalance = await pool.balanceOf(lp);
            const bptOut = pct(previousBptBalance, 0.18);

            const query = async () =>
              (await pool.querySingleJoinGivenOut({ recipient: lp, bptOut, token })).amountsIn[tokenIndexWithBpt];
            const actual = async () =>
              (await pool.singleJoinGivenOut({ from: lp, recipient: lp, bptOut, token })).amountsIn[tokenIndexWithBpt];

            await expectScalingFactorsToBeUpdated(query, actual);
          });

          it('exits use the new rates', async () => {
            const previousBptBalance = await pool.balanceOf(lp);
            const bptIn = pct(previousBptBalance, 0.082);

            const query = async () =>
              (await pool.querySingleExitGivenIn({ from: lp, bptIn, token })).amountsOut[tokenIndexWithBpt];
            const actual = async () =>
              (await pool.singleExitGivenIn({ from: lp, bptIn, token })).amountsOut[tokenIndexWithBpt];

            await expectScalingFactorsToBeUpdated(query, actual);
          });

          it('recovery mode exits do not update the cache', async () => {
            // Enter recovery mode
            await pool.enableRecoveryMode(admin);

            await updateExternalRates();

            // Verify the new rates are not yet loaded
            expect(await pool.getScalingFactors()).to.deep.equal(previousScalingFactors);

            // Do a recovery mode exit
            const { balances, tokens: allTokens } = await pool.getTokens();
            const bptIn = await pool.balanceOf(lp);

            await pool.recoveryModeExit({
              from: lp,
              tokens: allTokens,
              currentBalances: balances,
              bptIn,
            });

            // Verify the operation did NOT update the cache
            expect(await pool.getScalingFactors()).to.deep.equal(previousScalingFactors);
          });
        });
      });
    });

    describe('virtual supply', () => {
      let equalBalances: BigNumber[];
      const swapFeePercentage = fp(0.1); // 10 %
      const protocolFeePercentage = fp(0.5); // 50 %

      sharedBeforeEach('deploy pool', async () => {
        await deployPool({ swapFeePercentage });
        await pool.vault.setSwapFeePercentage(protocolFeePercentage);

        // Init pool with equal balances so that each BPT accounts for approximately one underlying token.
        equalBalances = Array.from({ length: numberOfTokens + 1 }).map((_, i) => (i == bptIndex ? bn(0) : fp(100)));
        await pool.init({ recipient: lp.address, initialBalances: equalBalances });

        await pool.updateProtocolFeePercentageCache();
      });

      context('without protocol fees', () => {
        it('reports correctly', async () => {
          const senderBptBalance = await pool.balanceOf(lp);

          const virtualSupply = await pool.getVirtualSupply();

          expect(virtualSupply).to.be.equalWithError(senderBptBalance, 0.0001);
        });
      });
    });

    describe('getRate and protocol fees', () => {
      const swapFeePercentage = fp(0.1); // 10 %
      const protocolFeePercentage = fp(0.5); // 50 %

      sharedBeforeEach('deploy  pool', async () => {
        await deployPool({ swapFeePercentage });
      });

      context('before initialized', () => {
        it('rate is undefined', async () => {
          await expect(pool.getRate()).to.be.revertedWith('ZERO_DIVISION');
        });
      });

      context('once initialized', () => {
        const initialBalance = fp(100);

        sharedBeforeEach('initialize pool', async () => {
          // Init pool with equal balances so that each BPT accounts for approximately one underlying token.
          const equalBalances = Array.from({ length: numberOfTokens + 1 }).map((_, i) =>
            i == bptIndex ? bn(0) : initialBalance
          );
          await pool.init({ recipient: lp.address, initialBalances: equalBalances });

          await tokens.mint({ to: lp, amount: initialBalance.mul(100) });
          await tokens.approve({ from: lp, to: pool.vault });
        });

        sharedBeforeEach('set fees', async () => {
          await pool.vault.setFeeTypePercentage(ProtocolFee.SWAP, protocolFeePercentage);
          await pool.vault.setFeeTypePercentage(ProtocolFee.YIELD, protocolFeePercentage);

          await pool.updateProtocolFeePercentageCache();
        });

        context('without protocol fees', () => {
          it('reports correctly', async () => {
            const virtualSupply = await pool.getVirtualSupply();
            const invariant = await pool.estimateInvariant();

            const expectedRate = fpDiv(invariant, virtualSupply);

            const rate = await pool.getRate();

            expect(rate).to.be.almostEqual(expectedRate, 0.0001);
          });
        });

        context('with protocol fees', () => {
          let feeAmount: BigNumber; // The number of tokens in the Pool that are fees

          function itReportsRateCorrectly() {
            let unmintedBPT: BigNumber;

            sharedBeforeEach('compute protocol ownership', async () => {
              const balanceSum = initialBalance.mul(numberOfTokens).add(feeAmount);
              const feePercentage = fpDiv(feeAmount, balanceSum);
              const protocolOwnership = fpMul(feePercentage, protocolFeePercentage);

              // The virtual supply does not include the unminted protocol fees. We need to adjust it by computing those.
              // Since all balances are relatively close and the pool is balanced, we can simply add the fee amount
              // to the current balances to obtain the final sum.
              const virtualSupply = await pool.getVirtualSupply();

              // The unminted BPT is supply * protocolOwnership / (1 - protocolOwnership)
              unmintedBPT = virtualSupply.mul(protocolOwnership).div(fp(1).sub(protocolOwnership));
            });

            it('the actual supply takes into account unminted protocol fees', async () => {
              const virtualSupply = await pool.getVirtualSupply();
              const expectedActualSupply = virtualSupply.add(unmintedBPT);

              expect(await pool.getActualSupply()).to.almostEqual(expectedActualSupply, 1e-6);
            });

            it('rate takes into account unminted protocol fees', async () => {
              const scaledBalances = arrayFpMul(await pool.getBalances(), await pool.getScalingFactors()).filter(
                (_, i) => i != bptIndex
              );
              const invariant = calculateInvariant(
                scaledBalances,
                (await pool.getAmplificationParameter()).value.div(1000)
              );

              // The virtual supply does not include the unminted protocol fees. We need to adjust it by computing those.
              // Since all balances are relatively close and the pool is balanced, we can simply add the fee amount
              // to the current balances to obtain the final sum.
              const virtualSupply = await pool.getVirtualSupply();

              const actualSupply = virtualSupply.add(unmintedBPT);

              const rateAssumingNoProtocolFees = fpDiv(invariant, virtualSupply);
              const rateConsideringProtocolFees = fpDiv(invariant, actualSupply);

              // The rate considering fees should be lower. Check that we have a difference of at least 0.01% to discard
              // rounding error.
              expect(rateConsideringProtocolFees).to.be.lt(rateAssumingNoProtocolFees.mul(9999).div(10000));

              expect(await pool.getRate()).to.be.almostEqual(rateConsideringProtocolFees, 1e-6);
            });

            async function expectNoRateChange(action: () => Promise<void>): Promise<void> {
              const rateBeforeAction = await pool.getRate();

              await action();

              const rateAfterAction = await pool.getRate();

              // There's some minute diference due to rounding error
              const rateDelta = rateAfterAction.sub(rateBeforeAction);
              expect(rateDelta.abs()).to.be.lte(2);
            }

            it('rate does not change due to proportional joins', async () => {
              await expectNoRateChange(async () => {
                // Perform a proportional join. These have no swap fees, which means that the rate should remain the same
                // (even though this triggers a due protocol fee payout).

                // Note that we join with proportional *unscaled* balances - otherwise we'd need to take their different
                // scaling factors into account.
                const { balances: unscaledBalances } = await pool.getTokens();
                const amountsIn = unscaledBalances.map((balance, i) => (i == bptIndex ? bn(0) : balance.div(100)));
                await pool.joinGivenIn({ from: lp, amountsIn });
              });
            });

            it('rate does not change due to proportional exits', async () => {
              await expectNoRateChange(async () => {
                // Perform a proportional exit. These have no swap fees, which means that the rate should remain the same
                // (even though this triggers a due protocol fee payout).

                // Note that we exit with proportional *unscaled* balances - otherwise we'd need to take their different
                // scaling factors into account.
                const { balances: unscaledBalances } = await pool.getTokens();
                const amountsOut = unscaledBalances.map((balance, i) => (i == bptIndex ? bn(0) : balance.div(100)));
                await pool.exitGivenOut({ from: lp, amountsOut });
              });
            });

            it('rate increases when enabling recovery mode', async () => {
              const initialRate = await pool.getRate();

              // When enabling recovery mode, protocol fees are forfeit and the percentages drop to zero. This causes
              // an increase in the rate, since the BPT's value increases (as it no longer carries any protocol debt).
              await pool.enableRecoveryMode(admin);
              const newRate = await pool.getRate();

              expect(newRate).to.be.gt(initialRate);

              // We can compute the new rate by computing the ratio of invariant and total supply, not considering any
              // due protocol fees (because there should be none).
              const scaledBalances = arrayFpMul(await pool.getBalances(), await pool.getScalingFactors()).filter(
                (_, i) => i != bptIndex
              );
              const invariant = calculateInvariant(
                scaledBalances,
                (await pool.getAmplificationParameter()).value.div(AMP_PRECISION)
              );

              const virtualSupply = await pool.getVirtualSupply();

              const rateAssumingNoProtocolFees = fpDiv(invariant, virtualSupply);

              expect(newRate).to.be.almostEqual(rateAssumingNoProtocolFees, 1e-6);
            });

            it('rate does not change when disabling recovery mode', async () => {
              await pool.enableRecoveryMode(admin);

              await expectNoRateChange(async () => {
                // Disabling recovery mode should cause no rate changes - fees have already been forfeit when recovery
                // mode was enabled.
                await pool.disableRecoveryMode(admin);
              });
            });

            function itReactsToProtocolFeePercentageChangesCorrectly(feeType: number) {
              it('rate does not change on protocol fee update', async () => {
                await expectNoRateChange(async () => {
                  // Changing the fee on the providere should cause no changes as the Pool ignores the provider outside
                  // of cache updates.
                  await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(2));
                });
              });

              it('rate does not change on protocol fee cache update', async () => {
                await expectNoRateChange(async () => {
                  // Even though there's due protocol fees, which are a function of the protocol fee percentage, changing
                  // this value should not change the Pool's rate (to avoid manipulation).
                  await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(2));
                  await pool.updateProtocolFeePercentageCache();
                });
              });

              it('due protocol fees are minted on protocol fee cache update', async () => {
                await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(2));
                const receipt = await (await pool.updateProtocolFeePercentageCache()).wait();

                const event = expectEvent.inReceipt(receipt, 'Transfer', {
                  from: ZERO_ADDRESS,
                  to: (await pool.vault.getFeesCollector()).address,
                });

                expect(event.args.value).to.be.almostEqual(unmintedBPT, 1e-3);
              });

              it('repeated protocol fee cache updates do not mint any more fees', async () => {
                await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(2));
                await pool.updateProtocolFeePercentageCache();

                await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(4));
                const receipt = await (await pool.updateProtocolFeePercentageCache()).wait();

                expectEvent.notEmitted(receipt, 'Transfer');
              });

              context('when paused', () => {
                sharedBeforeEach('pause pool', async () => {
                  await pool.pause();
                });

                it('reverts on protocol fee cache updated', async () => {
                  await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(2));
                  await expect(pool.updateProtocolFeePercentageCache()).to.be.revertedWith('PAUSED');
                });
              });
            }

            context('on swap protocol fee change', () => {
              itReactsToProtocolFeePercentageChangesCorrectly(ProtocolFee.SWAP);
            });

            context('on yield protocol fee change', () => {
              itReactsToProtocolFeePercentageChangesCorrectly(ProtocolFee.YIELD);
            });

            context('on aum protocol fee change', () => {
              itReactsToProtocolFeePercentageChangesCorrectly(ProtocolFee.AUM);
            });
          }

          context('with swap protocol fees', () => {
            sharedBeforeEach('accrue fees due to a swap', async () => {
              const amount = initialBalance.div(20);
              feeAmount = fpMul(amount, swapFeePercentage);

              const tokenIn = tokens.first;
              const tokenOut = tokens.second;
              await pool.swapGivenIn({ in: tokenIn, out: tokenOut, amount, from: lp, recipient: lp });
            });

            itReportsRateCorrectly();
          });

          context('with yield protocol fees', () => {
            sharedBeforeEach('accrue fees due to yield', async () => {
              // Even tokens are exempt from yield fee, so we cause some on an odd one.
              const rateProvider = rateProviders[1];
              const currentRate = await rateProvider.getRate();

              // Cause a 0.5% (1/200) rate increase
              const newRate = fpMul(currentRate, fp(1.005));
              await rateProvider.mockRate(newRate);
              await pool.updateTokenRateCache(tokens.second);

              feeAmount = fpMul(initialBalance, newRate.sub(currentRate));
            });

            itReportsRateCorrectly();
          });
        });
      });
    });

    describe('recovery mode', () => {
      let sender: SignerWithAddress;
      let allTokens: string[];

      sharedBeforeEach('deploy pool', async () => {
        await deployPool();
        sender = (await ethers.getSigners())[0];

        const equalBalances = Array.from({ length: numberOfTokens + 1 }).map((_, i) =>
          i == bptIndex ? bn(0) : fp(100)
        );
        await pool.init({ recipient: sender, initialBalances: equalBalances });

        const result = await pool.getTokens();
        allTokens = result.tokens;
      });

      context('when not in recovery mode', () => {
        it('reverts', async () => {
          const totalBptBalance = await pool.balanceOf(lp);

          await expect(
            pool.recoveryModeExit({
              from: lp,
              tokens: allTokens,
              currentBalances: initialBalances,
              bptIn: totalBptBalance,
            })
          ).to.be.revertedWith('NOT_IN_RECOVERY_MODE');
        });
      });

      context('when in recovery mode', () => {
        sharedBeforeEach('enable recovery mode', async () => {
          await pool.enableRecoveryMode(admin);
        });

        context('one lp', () => {
          it('can partially exit', async () => {
            const previousVirtualSupply = await pool.getVirtualSupply();
            const previousSenderBptBalance = await pool.balanceOf(sender);

            //Exit with 1/4 of BPT balance
            const bptIn = (await pool.balanceOf(sender)).div(4);

            const currentBalances = await pool.getBalances();
            const expectedAmountsOut = currentBalances.map((balance, i) =>
              i == pool.bptIndex ? bn(0) : bn(balance).mul(previousSenderBptBalance).div(previousVirtualSupply).div(4)
            );

            const result = await pool.recoveryModeExit({
              from: sender,
              tokens: allTokens,
              currentBalances: initialBalances,
              bptIn,
            });

            expect(result.amountsOut).to.be.equalWithError(expectedAmountsOut, 0.00001);

            const currentSenderBptBalance = await pool.balanceOf(sender);
            expect(previousSenderBptBalance.sub(currentSenderBptBalance)).to.be.equalWithError(bptIn, 0.00001);

            // Current virtual supply
            const currentVirtualSupply = await pool.getVirtualSupply();
            expect(currentVirtualSupply).to.be.equalWithError(previousVirtualSupply.sub(bptIn), 0.00001);
          });
        });

        context('two lps', () => {
          const amount = fp(100);

          sharedBeforeEach('second lp swaps', async () => {
            await tokens.mint({ to: lp, amount });
            await tokens.approve({ from: lp, to: pool.vault });
            await pool.swapGivenIn({
              in: tokens.first,
              out: pool.bpt,
              amount: amount,
              from: lp,
              recipient: lp,
            });
          });

          async function itAllowsBothLpsToExit(): Promise<void> {
            sharedBeforeEach('first lp exits', async () => {
              const bptIn = await pool.balanceOf(sender);

              await pool.recoveryModeExit({
                from: sender,
                tokens: allTokens,
                currentBalances: initialBalances,
                bptIn,
              });
            });

            it('can fully exit proportionally', async () => {
              const previousVirtualSupply = await pool.getVirtualSupply();
              const previousLpBptBalance = await pool.balanceOf(lp);

              const currentBalances = await pool.getBalances();
              const expectedAmountsOut = currentBalances.map((balance, i) =>
                i == pool.bptIndex ? bn(0) : bn(balance).mul(previousLpBptBalance).div(previousVirtualSupply)
              );

              //Exit with all BPT balance
              const result = await pool.recoveryModeExit({
                from: lp,
                tokens: allTokens,
                currentBalances,
                bptIn: previousLpBptBalance,
              });

              expect(result.amountsOut).to.be.equalWithError(expectedAmountsOut, 0.00001);

              const currentLpBptBalance = await pool.balanceOf(lp);
              expect(currentLpBptBalance).to.be.equal(0);

              // Current virtual supply after full exit is the minted minimumBpt to 0x0
              const minimumBpt = await pool.instance.getMinimumBpt();
              const currentVirtualSupply = await pool.getVirtualSupply();
              expect(currentVirtualSupply).to.be.equalWithError(minimumBpt, 0.00001);
            });
          }

          context('with functioning pool', () => {
            itAllowsBothLpsToExit();
          });

          context('with broken pool', () => {
            sharedBeforeEach('blow up pool', async () => {
              await pool.setInvariantFailure(true);
              await pool.setRateFailure(true);
            });

            it('verify external rate calls fail', async () => {
              await expect(pool.updateTokenRateCache(tokens.first)).to.be.revertedWith('INDUCED_FAILURE');
            });

            itAllowsBothLpsToExit();
          });
        });
      });
    });

    describe('permissioned actions', () => {
      sharedBeforeEach('deploy pool', async () => {
        await deployPool();
      });

      function itIsOwnerOnly(method: string) {
        it(`${method} can only be called by non-delegated owners`, async () => {
          expect(await pool.instance.isOwnerOnlyAction(await actionId(pool.instance, method))).to.be.true;
        });
      }

      function itIsNotOwnerOnly(method: string) {
        it(`${method} can never be called by the owner`, async () => {
          expect(await pool.instance.isOwnerOnlyAction(await actionId(pool.instance, method))).to.be.false;
        });
      }

      const poolArtifact = getArtifact('v2-pool-stable/MockComposableStablePool');
      const nonViewFunctions = poolArtifact.abi
        .filter(
          (elem) =>
            elem.type === 'function' && (elem.stateMutability === 'payable' || elem.stateMutability === 'nonpayable')
        )
        .map((fn) => fn.name);

      const expectedOwnerOnlyFunctions = [
        'setSwapFeePercentage',
        'startAmplificationParameterUpdate',
        'stopAmplificationParameterUpdate',
        'setTokenRateCacheDuration',
      ];

      const expectedNotOwnerOnlyFunctions = nonViewFunctions.filter((fn) => !expectedOwnerOnlyFunctions.includes(fn));

      describe('owner only actions', () => {
        for (const expectedOwnerOnlyFunction of expectedOwnerOnlyFunctions) {
          itIsOwnerOnly(expectedOwnerOnlyFunction);
        }
      });

      describe('non owner only actions', () => {
        for (const expectedNotOwnerOnlyFunction of expectedNotOwnerOnlyFunctions) {
          itIsNotOwnerOnly(expectedNotOwnerOnlyFunction);
        }
      });
    });
  }
});
