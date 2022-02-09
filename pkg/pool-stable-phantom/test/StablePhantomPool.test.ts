import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractTransaction } from 'ethers';

import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { BigNumberish, bn, fp, FP_SCALING_FACTOR } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT112, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { RawStablePhantomPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/stable-phantom/types';
import { advanceTime, currentTimestamp, MINUTE, MONTH } from '@balancer-labs/v2-helpers/src/time';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePhantomPool from '@balancer-labs/v2-helpers/src/models/pools/stable-phantom/StablePhantomPool';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('StablePhantomPool', () => {
  let lp: SignerWithAddress,
    owner: SignerWithAddress,
    recipient: SignerWithAddress,
    admin: SignerWithAddress,
    other: SignerWithAddress;

  sharedBeforeEach('setup signers', async () => {
    [, lp, owner, recipient, admin, other] = await ethers.getSigners();
  });

  context('for 2 tokens pool', () => {
    itBehavesAsStablePhantomPool(2);
  });

  context('for 4 tokens pool', () => {
    itBehavesAsStablePhantomPool(4);
  });

  context('for 1 token pool', () => {
    it('reverts', async () => {
      const tokens = await TokenList.create(1);
      await expect(StablePhantomPool.create({ tokens })).to.be.revertedWith('MIN_TOKENS');
    });
  });

  context('for 5 tokens pool', () => {
    it('reverts', async () => {
      const tokens = await TokenList.create(5, { sorted: true });
      await expect(StablePhantomPool.create({ tokens })).to.be.revertedWith('MAX_TOKENS');
    });
  });

  function itBehavesAsStablePhantomPool(numberOfTokens: number): void {
    let pool: StablePhantomPool, tokens: TokenList;
    let deployTimestamp: BigNumber, bptIndex: number, initialBalances: BigNumberish[];

    const rateProviders: Contract[] = [];
    const tokenRateCacheDurations: number[] = [];

    async function deployPool(params: RawStablePhantomPoolDeployment = {}, rates: BigNumberish[] = []): Promise<void> {
      tokens = params.tokens || (await TokenList.create(numberOfTokens, { sorted: true }));

      for (let i = 0; i < numberOfTokens; i++) {
        rateProviders[i] = await deploy('v2-pool-utils/MockRateProvider');
        await rateProviders[i].mockRate(rates[i] || fp(1));
        tokenRateCacheDurations[i] = MONTH + i;
      }

      pool = await StablePhantomPool.create({
        tokens,
        rateProviders,
        tokenRateCacheDurations,
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
        const amplificationParameter = bn(200);
        const tokenRates = Array.from({ length: numberOfTokens }, (_, i) => fp(1 + (i + 1) / 10));

        sharedBeforeEach('deploy pool', async () => {
          await deployPool({ swapFeePercentage, amplificationParameter }, tokenRates);
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

        it('sets amplification', async () => {
          const { value, isUpdating, precision } = await pool.getAmplificationParameter();

          expect(value).to.be.equal(amplificationParameter.mul(precision));
          expect(isUpdating).to.be.false;
        });

        it('sets swap fee', async () => {
          expect(await pool.getSwapFeePercentage()).to.equal(swapFeePercentage);
        });

        it('sets the rate providers', async () => {
          const providers = await pool.getRateProviders();

          // BPT does not have a rate provider
          expect(providers).to.have.lengthOf(numberOfTokens + 1);
          expect(providers).to.include.members(rateProviders.map((r) => r.address));
          expect(providers).to.include(ZERO_ADDRESS);
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

        it('sets the scaling factors', async () => {
          const scalingFactors = (await pool.getScalingFactors()).map((sf) => sf.toString());

          // It also includes the BPT scaling factor
          expect(scalingFactors).to.have.lengthOf(numberOfTokens + 1);
          expect(scalingFactors).to.include(fp(1).toString());
          for (const rate of tokenRates) expect(scalingFactors).to.include(rate.toString());
        });

        it('sets BPT index correctly', async () => {
          const bpt = new Token('BPT', 'BPT', 18, pool.instance);
          const allTokens = new TokenList([...tokens.tokens, bpt]).sort();
          const expectedIndex = allTokens.indexOf(bpt);
          expect(await pool.getBptIndex()).to.be.equal(expectedIndex);
        });
      });

      context('when the creation fails', () => {
        it('reverts if there are repeated tokens', async () => {
          const badTokens = new TokenList(Array(numberOfTokens).fill(tokens.first));

          await expect(deployPool({ tokens: badTokens })).to.be.revertedWith('UNSORTED_ARRAY');
        });

        it('reverts if the cache durations do not match the tokens length', async () => {
          const tokenRateCacheDurations = [1];

          await expect(deployPool({ tokenRateCacheDurations })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if the rate providers do not match the tokens length', async () => {
          const rateProviders = [ZERO_ADDRESS];

          await expect(deployPool({ rateProviders })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if the swap fee is too high', async () => {
          const swapFeePercentage = fp(0.1).add(1);

          await expect(deployPool({ swapFeePercentage })).to.be.revertedWith('MAX_SWAP_FEE_PERCENTAGE');
        });

        it('reverts if amplification coefficient is too high', async () => {
          const amplificationParameter = bn(5001);

          await expect(deployPool({ amplificationParameter })).to.be.revertedWith('MAX_AMP');
        });

        it('reverts if amplification coefficient is too low', async () => {
          const amplificationParameter = bn(0);

          await expect(deployPool({ amplificationParameter })).to.be.revertedWith('MIN_AMP');
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

          it('mints the max amount of BPT minus minimum Bpt', async () => {
            await pool.init({ initialBalances });

            expect(await pool.totalSupply()).to.be.equal(MAX_UINT112);
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

            const expectedBPT = MAX_UINT112.sub(invariant);
            expect(await pool.balanceOf(pool.vault)).to.be.equalWithError(expectedBPT, 0.00001);

            expect(dueProtocolFeeAmounts).to.be.zeros;
            for (let i = 0; i < amountsIn.length; i++) {
              i === bptIndex
                ? expect(amountsIn[i]).to.be.equalWithError(MAX_UINT112.sub(invariant), 0.00001)
                : expect(amountsIn[i]).to.be.equal(initialBalances[i]);
            }
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
      });

      context('when it was already initialized', () => {
        sharedBeforeEach('init pool', async () => {
          await pool.init({ initialBalances });
        });

        it('reverts', async () => {
          await expect(pool.init({ initialBalances })).to.be.revertedWith('UNHANDLED_BY_PHANTOM_POOL');
        });
      });
    });

    describe('swap', () => {
      sharedBeforeEach('deploy pool', async () => {
        await deployPool();
      });

      context('when the pool was not initialized', () => {
        it('reverts', async () => {
          const tx = pool.swapGivenIn({ in: tokens.first, out: tokens.second, amount: fp(0), recipient });
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

        context('token out given token in', () => {
          const amountIn = fp(0.1);

          it('swaps tokens', async () => {
            const tokenIn = tokens.first;
            const tokenOut = tokens.second;

            const previousBalance = await tokenOut.balanceOf(recipient);
            const expectedAmountOut = await pool.estimateTokenOutGivenTokenIn(tokenIn, tokenOut, amountIn);

            const { amountOut } = await pool.swapGivenIn({ in: tokenIn, out: tokenOut, amount: amountIn, recipient });
            expect(amountOut).to.be.equalWithError(expectedAmountOut, 0.00001);

            const currentBalance = await tokenOut.balanceOf(recipient);
            expect(currentBalance.sub(previousBalance)).to.be.equalWithError(expectedAmountOut, 0.00001);
          });

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
        });

        context('token in given token out', () => {
          const amountOut = fp(0.1);

          it('swaps tokens', async () => {
            const tokenIn = tokens.first;
            const tokenOut = tokens.second;

            const previousBalance = await tokenOut.balanceOf(recipient);
            const expectedAmountIn = await pool.estimateTokenInGivenTokenOut(tokenIn, tokenOut, amountOut);

            const { amountIn } = await pool.swapGivenOut({ in: tokenIn, out: tokenOut, amount: amountOut, recipient });
            expect(amountIn).to.be.equalWithError(expectedAmountIn, 0.00001);

            const currentBalance = await tokenOut.balanceOf(recipient);
            expect(currentBalance.sub(previousBalance)).to.be.equal(amountOut);
          });

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
        });

        context('token out given BPT in', () => {
          const bptIn = fp(1);

          it('swaps exact BPT for token', async () => {
            const tokenOut = tokens.first;

            const previousBalance = await tokenOut.balanceOf(recipient);
            const expectedTokenOut = await pool.estimateTokenOutGivenBptIn(tokenOut, bptIn);

            const { amountOut } = await pool.swapGivenIn({ in: pool.bpt, out: tokenOut, amount: bptIn, recipient });
            expect(amountOut).to.be.equalWithError(expectedTokenOut, 0.00001);

            const currentBalance = await tokenOut.balanceOf(recipient);
            expect(currentBalance.sub(previousBalance)).to.be.equalWithError(expectedTokenOut, 0.00001);
          });

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
        });

        context('token in given BPT out', () => {
          const bptOut = fp(1);

          it('swaps token for exact BPT', async () => {
            const tokenIn = tokens.first;

            const previousBalance = await pool.balanceOf(recipient);
            const expectedTokenIn = await pool.estimateTokenInGivenBptOut(tokenIn, bptOut);

            const { amountIn } = await pool.swapGivenOut({ in: tokenIn, out: pool.bpt, amount: bptOut, recipient });
            expect(amountIn).to.be.equalWithError(expectedTokenIn, 0.00001);

            const currentBalance = await pool.balanceOf(recipient);
            expect(currentBalance.sub(previousBalance)).to.be.equal(bptOut);
          });

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
        });

        context('BPT out given token in', () => {
          const amountIn = fp(1);

          it('swaps exact token for BPT', async () => {
            const tokenIn = tokens.first;

            const previousBalance = await pool.balanceOf(recipient);
            const expectedBptOut = await pool.estimateBptOutGivenTokenIn(tokenIn, amountIn);

            const { amountOut } = await pool.swapGivenIn({ in: tokenIn, out: pool.bpt, amount: amountIn, recipient });
            expect(amountOut).to.be.equalWithError(expectedBptOut, 0.00001);

            const currentBalance = await pool.balanceOf(recipient);
            expect(currentBalance.sub(previousBalance)).to.be.equalWithError(expectedBptOut, 0.00001);
          });

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
        });

        context('BPT in given token out', () => {
          const amountOut = fp(0.1);

          it('swaps BPT for exact tokens', async () => {
            const tokenOut = tokens.first;

            const previousBalance = await tokenOut.balanceOf(recipient);
            const expectedBptIn = await pool.estimateBptInGivenTokenOut(tokenOut, amountOut);

            const { amountIn } = await pool.swapGivenOut({ in: pool.bpt, out: tokenOut, amount: amountOut, recipient });
            expect(amountIn).to.be.equalWithError(expectedBptIn, 0.00001);

            const currentBalance = await tokenOut.balanceOf(recipient);
            expect(currentBalance.sub(previousBalance)).to.be.equal(amountOut);
          });

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
        });
      });
    });

    describe('join', () => {
      sharedBeforeEach('deploy pool', async () => {
        await deployPool();
        await pool.init({ recipient, initialBalances });
      });

      context('when the sender is not the vault', () => {
        it('reverts', async () => {
          const tx = pool.instance.onJoinPool(pool.poolId, ZERO_ADDRESS, ZERO_ADDRESS, [0], 0, 0, '0x');
          await expect(tx).to.be.revertedWith('CALLER_NOT_VAULT');
        });
      });
    });

    describe('exit', () => {
      sharedBeforeEach('deploy pool', async () => {
        await deployPool();
        await pool.init({ recipient, initialBalances });
      });

      context('when the sender is not the vault', () => {
        it('reverts', async () => {
          const tx = pool.instance.onExitPool(pool.poolId, ZERO_ADDRESS, ZERO_ADDRESS, [0], 0, 0, '0x');
          await expect(tx).to.be.revertedWith('CALLER_NOT_VAULT');
        });
      });
    });

    describe('rates cache', () => {
      context('with no rate provider', () => {
        sharedBeforeEach('deploy pool', async () => {
          const tokenParams = Array.from({ length: numberOfTokens }, (_, i) => ({ decimals: 18 - i }));
          tokens = await TokenList.create(tokenParams, { sorted: true, varyDecimals: true });

          pool = await StablePhantomPool.create({
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

          await Promise.all(
            tokens.map(async (token) => {
              const decimals = await (await deployedAt('v2-solidity-utils/ERC20', token)).decimals();
              expect(await pool.instance.getScalingFactor(token)).to.equal(fp(bn(10).pow(18 - decimals)));
            })
          );
        });

        it('updating the cache reverts', async () => {
          await tokens.asyncEach(async (token) => {
            await expect(pool.updateTokenRateCache(token)).to.be.revertedWith('TOKEN_DOES_NOT_HAVE_RATE_PROVIDER');
          });
        });

        it('updating the cache duration reverts', async () => {
          await tokens.asyncEach(async (token) => {
            await expect(pool.setTokenRateCacheDuration(token, bn(0), { from: owner })).to.be.revertedWith(
              'TOKEN_DOES_NOT_HAVE_RATE_PROVIDER'
            );
          });
        });

        it('querying the cache reverts', async () => {
          await tokens.asyncEach(async (token) => {
            await expect(pool.getTokenRateCache(token)).to.be.revertedWith('TOKEN_DOES_NOT_HAVE_RATE_PROVIDER');
          });
        });
      });

      context('with a rate provider', () => {
        sharedBeforeEach('deploy pool', async () => {
          const tokenParams = Array.from({ length: numberOfTokens }, (_, i) => ({ decimals: 18 - i }));
          tokens = await TokenList.create(tokenParams, { sorted: true });

          const tokenRates = Array.from({ length: numberOfTokens }, (_, i) => fp(1 + (i + 1) / 10));
          await deployPool({ tokens }, tokenRates);
        });

        describe('scaling factors', () => {
          const scaleRate = async (token: Token): Promise<BigNumber> => {
            const index = tokens.indexOf(token);
            const rateProvider = rateProviders[index];
            const rate = await rateProvider.getRate();
            return rate.mul(bn(10).pow(18 - token.decimals));
          };

          const itAdaptsTheScalingFactorsCorrectly = () => {
            it('adapt the scaling factors with the price rate', async () => {
              const scalingFactors = await pool.getScalingFactors();

              await tokens.asyncEach(async (token) => {
                const expectedRate = await scaleRate(token);
                const tokenIndex = await pool.getTokenIndex(token);
                expect(scalingFactors[tokenIndex]).to.be.equal(expectedRate);
                expect(await pool.getScalingFactor(token)).to.be.equal(expectedRate);
              });

              expect(scalingFactors[pool.bptIndex]).to.be.equal(fp(1));
              expect(await pool.getScalingFactor(pool.bpt)).to.be.equal(fp(1));
            });
          };

          context('with a price rate above 1', () => {
            sharedBeforeEach('mock rates', async () => {
              await tokens.asyncEach(async (token, i) => {
                await rateProviders[i].mockRate(fp(1 + i / 10));
                await pool.updateTokenRateCache(token);
              });
            });

            itAdaptsTheScalingFactorsCorrectly();
          });

          context('with a price rate equal to 1', () => {
            sharedBeforeEach('mock rates', async () => {
              await tokens.asyncEach(async (token, i) => {
                await rateProviders[i].mockRate(fp(1));
                await pool.updateTokenRateCache(token);
              });
            });

            itAdaptsTheScalingFactorsCorrectly();
          });

          context('with a price rate below 1', () => {
            sharedBeforeEach('mock rate', async () => {
              await tokens.asyncEach(async (token, i) => {
                await rateProviders[i].mockRate(fp(1 - i / 10));
                await pool.updateTokenRateCache(token);
              });
            });

            itAdaptsTheScalingFactorsCorrectly();
          });
        });

        describe('update', () => {
          const itUpdatesTheRateCache = (action: (token: Token) => Promise<ContractTransaction>) => {
            const newRate = fp(1.5);

            it('updates the cache', async () => {
              await tokens.asyncEach(async (token, i) => {
                const previousCache = await pool.getTokenRateCache(token);

                await rateProviders[i].mockRate(newRate);
                const updatedAt = await currentTimestamp();

                await action(token);

                const currentCache = await pool.getTokenRateCache(token);
                expect(currentCache.rate).to.be.equal(newRate);
                expect(previousCache.rate).not.to.be.equal(newRate);

                expect(currentCache.duration).to.be.equal(tokenRateCacheDurations[i]);
                expect(currentCache.expires).to.be.at.least(updatedAt.add(tokenRateCacheDurations[i]));
              });
            });

            it('emits an event', async () => {
              await tokens.asyncEach(async (token, i) => {
                await rateProviders[i].mockRate(newRate);
                const receipt = await action(token);

                expectEvent.inReceipt(await receipt.wait(), 'TokenRateCacheUpdated', {
                  rate: newRate,
                  token: token.address,
                });
              });
            });
          };

          context('before the cache expires', () => {
            sharedBeforeEach('advance time', async () => {
              await advanceTime(MINUTE);
            });

            context('when not forced', () => {
              const action = async (token: Token) => pool.instance.mockCacheTokenRateIfNecessary(token.address);

              it('does not update the cache', async () => {
                await tokens.asyncEach(async (token) => {
                  const previousCache = await pool.getTokenRateCache(token);

                  await action(token);

                  const currentCache = await pool.getTokenRateCache(token);
                  expect(currentCache.rate).to.be.equal(previousCache.rate);
                  expect(currentCache.expires).to.be.equal(previousCache.expires);
                  expect(currentCache.duration).to.be.equal(previousCache.duration);
                });
              });
            });

            context('when forced', () => {
              const action = async (token: Token) => pool.updateTokenRateCache(token);

              itUpdatesTheRateCache(action);
            });
          });

          context('after the cache expires', () => {
            sharedBeforeEach('advance time', async () => {
              await advanceTime(MONTH * 2);
            });

            context('when not forced', () => {
              const action = async (token: Token) => pool.instance.mockCacheTokenRateIfNecessary(token.address);

              itUpdatesTheRateCache(action);
            });

            context('when forced', () => {
              const action = async (token: Token) => pool.updateTokenRateCache(token);

              itUpdatesTheRateCache(action);
            });
          });
        });

        describe('set cache duration', () => {
          const newDuration = bn(MINUTE * 10);

          sharedBeforeEach('grant role to admin', async () => {
            const action = await actionId(pool.instance, 'setTokenRateCacheDuration');
            await pool.vault.grantPermissionsGlobally([action], admin);
          });

          const itUpdatesTheCacheDuration = () => {
            it('updates the cache duration', async () => {
              await tokens.asyncEach(async (token, i) => {
                const previousCache = await pool.getTokenRateCache(token);

                const newRate = fp(1.5);
                await rateProviders[i].mockRate(newRate);
                const forceUpdateAt = await currentTimestamp();
                await pool.setTokenRateCacheDuration(token, newDuration, { from: owner });

                const currentCache = await pool.getTokenRateCache(token);
                expect(currentCache.rate).to.be.equal(newRate);
                expect(previousCache.rate).not.to.be.equal(newRate);
                expect(currentCache.duration).to.be.equal(newDuration);
                expect(currentCache.expires).to.be.at.least(forceUpdateAt.add(newDuration));
              });
            });

            it('emits an event', async () => {
              await tokens.asyncEach(async (token, i) => {
                const tx = await pool.setTokenRateCacheDuration(token, newDuration, { from: owner });

                expectEvent.inReceipt(await tx.wait(), 'TokenRateProviderSet', {
                  token: token.address,
                  provider: rateProviders[i].address,
                  cacheDuration: newDuration,
                });
              });
            });
          };

          context('when it is requested by the owner', () => {
            context('before the cache expires', () => {
              sharedBeforeEach('advance time', async () => {
                await advanceTime(MINUTE);
              });

              itUpdatesTheCacheDuration();
            });

            context('after the cache has expired', () => {
              sharedBeforeEach('advance time', async () => {
                await advanceTime(MONTH * 2);
              });

              itUpdatesTheCacheDuration();
            });
          });

          context('when it is requested by the admin', () => {
            it('reverts', async () => {
              await expect(pool.setTokenRateCacheDuration(tokens.first, bn(10), { from: admin })).to.be.revertedWith(
                'SENDER_NOT_ALLOWED'
              );
            });
          });

          context('when it is requested by another one', () => {
            it('reverts', async () => {
              await expect(pool.setTokenRateCacheDuration(tokens.first, bn(10), { from: lp })).to.be.revertedWith(
                'SENDER_NOT_ALLOWED'
              );
            });
          });
        });
      });
    });

    describe('protocol swap fees', () => {
      const swapFeePercentage = fp(0.1); // 10 %
      const protocolFeePercentage = fp(0.5); // 50 %

      sharedBeforeEach('deploy pool', async () => {
        await deployPool({ swapFeePercentage });
        await pool.vault.setSwapFeePercentage(protocolFeePercentage);

        await pool.updateCachedProtocolSwapFeePercentage();

        // Init pool with equal balances so that each BPT accounts for approximately one underlying token.
        const equalBalances = Array.from({ length: numberOfTokens + 1 }).map((_, i) => (i == bptIndex ? 0 : fp(100)));
        await pool.init({ recipient: lp.address, initialBalances: equalBalances });
      });

      sharedBeforeEach('allow vault', async () => {
        await tokens.mint({ to: lp, amount: fp(100) });
        await tokens.approve({ from: lp, to: pool.vault });
      });

      describe('cache', () => {
        const newProtocolFeePercentage = fp(0.3);

        it('returns outdated value if the cache is not updated', async () => {
          await pool.vault.setSwapFeePercentage(newProtocolFeePercentage);
          expect(await pool.getCachedProtocolSwapFeePercentage()).to.equal(protocolFeePercentage);
        });

        it('returns updated value if the cache is updated', async () => {
          await pool.vault.setSwapFeePercentage(newProtocolFeePercentage);
          await pool.updateCachedProtocolSwapFeePercentage();

          expect(await pool.getCachedProtocolSwapFeePercentage()).to.equal(newProtocolFeePercentage);
        });

        it('emits an event', async () => {
          await pool.vault.setSwapFeePercentage(newProtocolFeePercentage);
          const receipt = await (await pool.updateCachedProtocolSwapFeePercentage()).wait();

          expectEvent.inReceipt(receipt, 'CachedProtocolSwapFeePercentageUpdated', {
            protocolSwapFeePercentage: newProtocolFeePercentage,
          });
        });
      });

      describe('accounting', () => {
        const amount = fp(1);

        sharedBeforeEach('update cache', async () => {
          await pool.updateCachedProtocolSwapFeePercentage();
        });

        enum AmountKind {
          WITH_FEE,
          WITHOUT_FEE,
        }

        function getAproxDueFee(amount: BigNumber, kind: AmountKind): BigNumber {
          // In StablePools, BPT and underlying tokens are almost equivalent. This means that the token fee amount is a
          // good estimate of the equivalent BPT fee amount.

          if (kind == AmountKind.WITHOUT_FEE) {
            amount = amount.mul(fp(1)).div(fp(1).sub(swapFeePercentage));
          }

          const fee = amount.mul(swapFeePercentage).div(fp(1));
          const protocolFee = fee.mul(protocolFeePercentage).div(fp(1));
          return protocolFee;
        }

        context('on swaps given in', () => {
          it('tracks fees when swapping tokens', async () => {
            const previousDueFee = await pool.getDueProtocolFeeBptAmount();

            const tokenIn = tokens.first;
            const tokenOut = tokens.second;
            const { receipt } = await pool.swapGivenIn({ in: tokenIn, out: tokenOut, amount, from: lp, recipient });

            const currentDueFee = await pool.getDueProtocolFeeBptAmount();
            const aproxFee = getAproxDueFee(amount, AmountKind.WITH_FEE);

            expect(currentDueFee).to.be.equalWithError(aproxFee, 0.01);

            expectEvent.inIndirectReceipt(receipt, pool.instance.interface, 'DueProtocolFeeIncreased', {
              bptAmount: currentDueFee.sub(previousDueFee),
            });
          });

          it('tracks fees when swapping for BPT (join)', async () => {
            const previousDueFee = await pool.getDueProtocolFeeBptAmount();

            const token = tokens.first;
            const { amountOut: bptAmount, receipt } = await pool.swapGivenIn({
              in: token,
              out: pool.bpt,
              amount,
              from: lp,
              recipient,
            });

            const currentDueFee = await pool.getDueProtocolFeeBptAmount();
            const aproxFee = getAproxDueFee(bptAmount, AmountKind.WITHOUT_FEE);

            expect(currentDueFee).to.be.equalWithError(aproxFee, 0.01);

            expectEvent.inIndirectReceipt(receipt, pool.instance.interface, 'DueProtocolFeeIncreased', {
              bptAmount: currentDueFee.sub(previousDueFee),
            });
          });

          it('tracks fees when swapping BPT (exit)', async () => {
            const previousDueFee = await pool.getDueProtocolFeeBptAmount();

            const token = tokens.first;
            const { receipt } = await pool.swapGivenIn({ in: pool.bpt, out: token, amount, from: lp, recipient });

            const currentDueFee = await pool.getDueProtocolFeeBptAmount();
            const aproxFee = getAproxDueFee(amount, AmountKind.WITH_FEE);

            expect(currentDueFee).to.be.equalWithError(aproxFee, 0.01);

            expectEvent.inIndirectReceipt(receipt, pool.instance.interface, 'DueProtocolFeeIncreased', {
              bptAmount: currentDueFee.sub(previousDueFee),
            });
          });
        });

        context('on swaps given out', () => {
          it('tracks fees when swapping tokens', async () => {
            const previousDueFee = await pool.getDueProtocolFeeBptAmount();

            const tokenIn = tokens.first;
            const tokenOut = tokens.second;
            const { amountIn, receipt } = await pool.swapGivenOut({
              in: tokenIn,
              out: tokenOut,
              amount,
              from: lp,
              recipient,
            });

            const currentDueFee = await pool.getDueProtocolFeeBptAmount();
            const aproxFee = getAproxDueFee(amountIn, AmountKind.WITH_FEE);

            expect(currentDueFee).to.be.equalWithError(aproxFee, 0.01);

            expectEvent.inIndirectReceipt(receipt, pool.instance.interface, 'DueProtocolFeeIncreased', {
              bptAmount: currentDueFee.sub(previousDueFee),
            });
          });

          it('tracks fees when swapping for BPT (join)', async () => {
            const previousDueFee = await pool.getDueProtocolFeeBptAmount();

            const token = tokens.first;
            const { receipt } = await pool.swapGivenOut({ in: token, out: pool.bpt, amount, from: lp, recipient });

            const currentDueFee = await pool.getDueProtocolFeeBptAmount();
            const aproxFee = getAproxDueFee(amount, AmountKind.WITHOUT_FEE);

            expect(currentDueFee).to.be.equalWithError(aproxFee, 0.01);

            expectEvent.inIndirectReceipt(receipt, pool.instance.interface, 'DueProtocolFeeIncreased', {
              bptAmount: currentDueFee.sub(previousDueFee),
            });
          });

          it('tracks fees when swapping BPT (exit)', async () => {
            const previousDueFee = await pool.getDueProtocolFeeBptAmount();

            const token = tokens.first;
            const { amountIn: bptAmount, receipt } = await pool.swapGivenOut({
              in: pool.bpt,
              out: token,
              amount,
              from: lp,
              recipient,
            });

            const currentDueFee = await pool.getDueProtocolFeeBptAmount();
            const aproxFee = getAproxDueFee(bptAmount, AmountKind.WITH_FEE);

            expect(currentDueFee).to.be.equalWithError(aproxFee, 0.01);

            expectEvent.inIndirectReceipt(receipt, pool.instance.interface, 'DueProtocolFeeIncreased', {
              bptAmount: currentDueFee.sub(previousDueFee),
            });
          });
        });
      });

      describe('collection', () => {
        const amount = fp(10);

        sharedBeforeEach('update cache', async () => {
          await pool.updateCachedProtocolSwapFeePercentage();
        });

        sharedBeforeEach('accrue fees', async () => {
          const token = tokens.first;

          const { amountOut: bptAmount } = await pool.swapGivenIn({
            in: token,
            out: pool.bpt,
            amount,
            from: lp,
            recipient: lp,
          });
          await pool.swapGivenIn({ in: pool.bpt, out: token, amount: bptAmount, from: lp, recipient: lp });
        });

        it('transfers tokens to the fee collector', async () => {
          const dueFeeBefore = await pool.getDueProtocolFeeBptAmount();
          expect(dueFeeBefore).to.be.gt(fp(0));

          await pool.collectProtocolFees(other);

          const dueFeeAfter = await pool.getDueProtocolFeeBptAmount();

          expect(dueFeeAfter).to.be.equal(fp(0));

          const feeCollector = await pool.vault.getFeesCollector();
          const feeCollectorBalance = await pool.bpt.balanceOf(feeCollector.address);

          expect(feeCollectorBalance).to.be.equal(dueFeeBefore);
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

        await pool.updateCachedProtocolSwapFeePercentage();

        // Init pool with equal balances so that each BPT accounts for approximately one underlying token.
        equalBalances = Array.from({ length: numberOfTokens + 1 }).map((_, i) => (i == bptIndex ? bn(0) : fp(100)));
        await pool.init({ recipient: lp.address, initialBalances: equalBalances });
      });

      context('without protocol fees', () => {
        it('reports correctly', async () => {
          const senderBptBalance = await pool.balanceOf(lp);

          const virtualSupply = await pool.getVirtualSupply();

          expect(virtualSupply).to.be.equalWithError(senderBptBalance, 0.0001);
        });
      });

      context('with protocol fees', () => {
        sharedBeforeEach('swap bpt in', async () => {
          const amount = fp(50);
          const tokenIn = pool.bpt;
          const tokenOut = tokens.second;

          await tokens.mint({ to: lp, amount });
          await tokens.approve({ from: lp, to: pool.vault });

          await pool.swapGivenIn({ in: tokenIn, out: tokenOut, amount, from: lp, recipient });
        });

        it('reports correctly', async () => {
          const dueFee = await pool.getDueProtocolFeeBptAmount();
          const senderBptBalance = await pool.balanceOf(lp);

          const virtualSupply = await pool.getVirtualSupply();

          expect(virtualSupply).to.be.equalWithError(senderBptBalance.add(dueFee), 0.0001);
        });
      });
    });

    describe('getRate', () => {
      const swapFeePercentage = fp(0.1); // 10 %
      const protocolFeePercentage = fp(0.5); // 50 %

      sharedBeforeEach('deploy pool', async () => {
        await deployPool({ swapFeePercentage });
        await pool.vault.setSwapFeePercentage(protocolFeePercentage);

        await pool.updateCachedProtocolSwapFeePercentage();

        // Init pool with equal balances so that each BPT accounts for approximately one underlying token.
        const equalBalances = Array.from({ length: numberOfTokens + 1 }).map((_, i) =>
          i == bptIndex ? bn(0) : fp(100)
        );
        await pool.init({ recipient: lp.address, initialBalances: equalBalances });
      });

      context('without protocol fees', () => {
        it('reports correctly', async () => {
          const virtualSupply = await pool.getVirtualSupply();
          const invariant = await pool.estimateInvariant();

          const expectedRate = invariant.mul(FP_SCALING_FACTOR).div(virtualSupply);

          const rate = await pool.getRate();

          expect(rate).to.be.equalWithError(expectedRate, 0.0001);
        });
      });

      context('with protocol fees', () => {
        sharedBeforeEach('swap bpt in', async () => {
          const amount = fp(50);
          const tokenIn = pool.bpt;
          const tokenOut = tokens.second;

          await tokens.mint({ to: lp, amount });
          await tokens.approve({ from: lp, to: pool.vault });

          await pool.swapGivenIn({ in: tokenIn, out: tokenOut, amount, from: lp, recipient });
        });

        it('reports correctly', async () => {
          const virtualSupply = await pool.getVirtualSupply();
          const invariant = await pool.estimateInvariant();

          const expectedRate = invariant.mul(FP_SCALING_FACTOR).div(virtualSupply);

          const rate = await pool.getRate();

          expect(rate).to.be.equalWithError(expectedRate, 0.0001);
        });
      });
    });

    describe('proportional exit', () => {
      let sender: SignerWithAddress;

      sharedBeforeEach('deploy pool', async () => {
        await deployPool();
        sender = (await ethers.getSigners())[0];

        const equalBalances = Array.from({ length: numberOfTokens + 1 }).map((_, i) =>
          i == bptIndex ? bn(0) : fp(100)
        );
        await pool.init({ recipient: sender, initialBalances: equalBalances });
      });

      context('when not paused', () => {
        it('cannot exit proportionally', async () => {
          const bptIn = fp(10);
          await expect(pool.proportionalExit({ from: lp, bptIn })).to.be.revertedWith('NOT_PAUSED');
        });
      });

      context('when paused', () => {
        context('one lp', () => {
          sharedBeforeEach('pause pool', async () => {
            await pool.pause();
          });

          it('can partially exit proportionally', async () => {
            const previousVirtualSupply = await pool.getVirtualSupply();
            const previousSenderBptBalance = await pool.balanceOf(sender);

            //Exit with 1/4 of BPT balance
            const bptIn = (await pool.balanceOf(sender)).div(4);

            const currentBalances = await pool.getBalances();
            const expectedAmountsOut = currentBalances.map((balance, i) =>
              i == pool.bptIndex ? bn(0) : bn(balance).mul(previousSenderBptBalance).div(previousVirtualSupply).div(4)
            );

            const result = await pool.proportionalExit({ from: sender, bptIn });

            // Protocol fees should be zero
            expect(result.dueProtocolFeeAmounts).to.be.zeros;
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

          sharedBeforeEach('pause pool', async () => {
            await pool.pause();
          });

          sharedBeforeEach('first lp exits', async () => {
            const bptIn = await pool.balanceOf(sender);
            await pool.proportionalExit({ from: sender, bptIn });
          });

          it('can fully exit proportionally', async () => {
            const previousVirtualSupply = await pool.getVirtualSupply();
            const previousLpBptBalance = await pool.balanceOf(lp);

            const currentBalances = await pool.getBalances();
            const expectedAmountsOut = currentBalances.map((balance, i) =>
              i == pool.bptIndex ? bn(0) : bn(balance).mul(previousLpBptBalance).div(previousVirtualSupply)
            );

            //Exit with all BPT balance
            const result = await pool.proportionalExit({ from: lp, bptIn: previousLpBptBalance });

            // Protocol fees should be zero
            expect(result.dueProtocolFeeAmounts).to.be.zeros;
            expect(result.amountsOut).to.be.equalWithError(expectedAmountsOut, 0.00001);

            const currentLpBptBalance = await pool.balanceOf(lp);
            expect(currentLpBptBalance).to.be.equal(0);

            // Current virtual supply after full exit is the minted minimumBpt to 0x0
            const minimumBpt = await pool.instance.getMinimumBpt();
            const currentVirtualSupply = await pool.getVirtualSupply();
            expect(currentVirtualSupply).to.be.equalWithError(minimumBpt, 0.00001);
          });
        });
      });
    });
  }
});
