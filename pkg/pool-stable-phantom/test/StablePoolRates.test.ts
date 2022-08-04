import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';

import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import {
  advanceTime,
  currentTimestamp,
  DAY,
  HOUR,
  MINUTE,
  MONTH,
  receiptTimestamp,
} from '@balancer-labs/v2-helpers/src/time';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';

describe.only('StablePoolRates', () => {
  let admin: SignerWithAddress, owner: SignerWithAddress, other: SignerWithAddress;
  let vault: Vault;
  const DELEGATE_OWNER = '0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B';

  const INITIAL_CACHE_DURATION = bn(HOUR);

  sharedBeforeEach('setup signers', async () => {
    [, admin, owner, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault', async () => {
    vault = await Vault.create({ admin });
  });

  context('for a 1 token pool', () => {
    it('reverts', async () => {
      const tokens = await TokenList.create(1);
      await expect(
        deploy('MockStablePoolRates', {
          args: [
            vault.address,
            tokens.addresses,
            tokens.map(() => ZERO_ADDRESS),
            tokens.map(() => 0),
            tokens.map(() => false),
            owner.address,
          ],
        })
      ).to.be.revertedWith('MIN_TOKENS');
    });
  });

  context('for a 2 token pool', () => {
    itBehavesAsStablePoolRates(2);
  });

  context('for a 3 token pool', () => {
    itBehavesAsStablePoolRates(3);
  });

  context('for a 4 token pool', () => {
    itBehavesAsStablePoolRates(4);
  });

  context('for a 5 token pool', () => {
    itBehavesAsStablePoolRates(5);
  });

  context('for a 6 token pool', () => {
    it('reverts', async () => {
      const tokens = await TokenList.create(6, { sorted: true });
      await expect(
        deploy('MockStablePoolRates', {
          args: [
            vault.address,
            tokens.addresses,
            tokens.map(() => ZERO_ADDRESS),
            tokens.map(() => 0),
            tokens.map(() => false),
            owner.address,
          ],
        })
      ).to.be.revertedWith('MAX_TOKENS');
    });
  });

  function itBehavesAsStablePoolRates(numberOfTokens: number): void {
    let pool: Contract, tokens: TokenList;
    let bptIndex: number;

    sharedBeforeEach('deploy tokens', async () => {
      tokens = await TokenList.create(numberOfTokens, { sorted: true, varyDecimals: true });
    });

    let rateProviders: string[] = [];
    let tokenRateCacheDurations: BigNumber[] = [];
    let exemptFromYieldProtocolFeeFlags: boolean[] = [];

    async function deployPool(
      tokenList: TokenList,
      newRateProviders: string[],
      newTokenRateCacheDurations: BigNumber[],
      newExemptFromYieldProtocolFeeFlags: boolean[],
      poolOwner: Account
    ): Promise<void> {
      pool = await deploy('MockStablePoolRates', {
        args: [
          vault.address,
          tokenList.addresses,
          newRateProviders,
          newTokenRateCacheDurations,
          newExemptFromYieldProtocolFeeFlags,
          TypesConverter.toAddress(poolOwner),
        ],
      });
      bptIndex = (await pool.getBptIndex()).toNumber();
      rateProviders = newRateProviders;
      tokenRateCacheDurations = newTokenRateCacheDurations;
      exemptFromYieldProtocolFeeFlags = newExemptFromYieldProtocolFeeFlags;
    }

    async function deployPoolSimple(
      poolOwner: Account,
      tokenList: TokenList,
      numRateProviders = tokenList.length,
      numTokenCacheDurations = tokenList.length,
      numExemptFlags = tokenList.length
    ): Promise<void> {
      const newRateProviders = await Promise.all(
        Array.from({ length: numRateProviders }, async () => {
          const hasRateProvider = Math.random() < 0.5;
          return hasRateProvider ? (await deploy('v2-pool-utils/MockRateProvider')).address : ZERO_ADDRESS;
        })
      );

      const newExemptFromYieldProtocolFeeFlags = Array.from({ length: numExemptFlags }, (_, i) => {
        const isExempt = Math.random() < 0.5;
        return newRateProviders[i] !== ZERO_ADDRESS && isExempt;
      });

      const newTokenRateCacheDurations = Array.from({ length: numTokenCacheDurations }, () => INITIAL_CACHE_DURATION);

      await deployPool(
        tokenList,
        newRateProviders,
        newTokenRateCacheDurations,
        newExemptFromYieldProtocolFeeFlags,
        poolOwner
      );
    }

    async function tokensWithBpt(): Promise<TokenList> {
      const bpt = await Token.deployedAt(pool);
      return new TokenList([...tokens.tokens, bpt]).sort();
    }

    async function rateProvidersWithBpt(): Promise<string[]> {
      const allRateProviders = rateProviders.slice();
      allRateProviders.splice(bptIndex, 0, ZERO_ADDRESS);
      return allRateProviders;
    }

    describe('constructor', () => {
      context('when the constructor succeeds', () => {
        sharedBeforeEach('deploy pool', async () => {
          await deployPoolSimple(owner, tokens);
        });

        it('emits TokenRateCacheUpdated events for each token with a rate provider', async () => {
          const deploymentTx = await pool.deployTransaction.wait();
          for (const [index, token] of tokens.tokens.entries()) {
            if (rateProviders[index] !== ZERO_ADDRESS) {
              expectEvent.inIndirectReceipt(deploymentTx, pool.interface, 'TokenRateCacheUpdated', {
                token: token.address,
                rate: fp(1),
              });
            }
          }
        });

        it('emits TokenRateProviderSet events for each token with a rate provider', async () => {
          const deploymentTx = await pool.deployTransaction.wait();
          for (const [index, token] of tokens.tokens.entries()) {
            if (rateProviders[index] !== ZERO_ADDRESS) {
              expectEvent.inIndirectReceipt(deploymentTx, pool.interface, 'TokenRateProviderSet', {
                token: token.address,
                provider: rateProviders[index],
                cacheDuration: tokenRateCacheDurations[index],
              });
            }
          }
        });
      });

      context('when the constructor fails', () => {
        it('reverts if the rate providers do not match the tokens length', async () => {
          await expect(deployPoolSimple(owner, tokens, tokens.length + 1)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if the cache durations do not match the tokens length', async () => {
          await expect(deployPoolSimple(owner, tokens, tokens.length, tokens.length + 1)).to.be.revertedWith(
            'INPUT_LENGTH_MISMATCH'
          );
        });
      });
    });

    describe('getTokenRate', () => {
      sharedBeforeEach('deploy pool', async () => {
        await deployPoolSimple(owner, tokens);
      });

      context("when the token doesn't have a rate provider", () => {
        it('returns ONE', async () => {
          const allTokens = await tokensWithBpt();
          const allRateProviders = await rateProvidersWithBpt();
          await allTokens.asyncEach(async (token, i) => {
            // Ignore tokens with rate providers
            if (allRateProviders[i] !== ZERO_ADDRESS) return;

            expect(await pool.getTokenRate(token.address)).to.be.eq(fp(1));
          });
        });
      });

      context('when the token has a rate provider', () => {
        it('returns the cached value of the current rate', async () => {
          const allTokens = await tokensWithBpt();
          const allRateProviders = await rateProvidersWithBpt();
          await allTokens.asyncEach(async (token, i) => {
            // Ignore tokens without rate providers
            if (allRateProviders[i] === ZERO_ADDRESS) return;

            const initialRate = fp(1);
            expect(await pool.getTokenRate(token.address)).to.be.eq(initialRate);

            // We update the rate reported by the rate provider but do not trigger a cache update.
            // We should see the same rate reported by the pool.
            const newRate = fp(4.5);
            const rateProvider = await deployedAt('v2-pool-utils/MockRateProvider', allRateProviders[i]);
            await rateProvider.mockRate(newRate);

            expect(await pool.getTokenRate(token.address)).to.be.eq(initialRate);

            // We now force an update so that we expect the pool to report the new rate.
            await pool.updateTokenRateCache(token.address);

            expect(await pool.getTokenRate(token.address)).to.be.eq(newRate);
          });
        });
      });
    });

    describe('getTokenRateCache', () => {
      sharedBeforeEach('deploy pool', async () => {
        await deployPoolSimple(owner, tokens);
      });

      context("when the token doesn't have a rate provider", () => {
        it('reverts', async () => {
          const allTokens = await tokensWithBpt();
          const allRateProviders = await rateProvidersWithBpt();
          await allTokens.asyncEach(async (token, i) => {
            // Ignore tokens with rate providers
            if (allRateProviders[i] !== ZERO_ADDRESS) return;

            await expect(pool.getTokenRateCache(token.address)).to.be.revertedWith('TOKEN_DOES_NOT_HAVE_RATE_PROVIDER');
          });
        });
      });

      context('when the token has a rate provider', () => {
        it('returns the contents of the rate cache', async () => {
          const allTokens = await tokensWithBpt();
          const allRateProviders = await rateProvidersWithBpt();
          await allTokens.asyncEach(async (token, i) => {
            // Ignore tokens without rate providers
            if (allRateProviders[i] === ZERO_ADDRESS) return;

            const previousCache = await pool.getTokenRateCache(token.address);

            // We update the rate reported by the rate provider but do not trigger a cache update.
            const newRate = fp(4.5);
            const rateProvider = await deployedAt('v2-pool-utils/MockRateProvider', allRateProviders[i]);
            await rateProvider.mockRate(newRate);

            // We don't expect the cache to be updated yet.
            expect(await pool.getTokenRateCache(token.address)).to.be.deep.eq(previousCache);

            // We now force an update so that we expect the pool to be updated.
            const tx = await pool.updateTokenRateCache(token.address);
            const txTimestamp = await receiptTimestamp(tx.wait());

            const newCache = await pool.getTokenRateCache(token.address);
            expect(newCache.rate).to.be.eq(newRate);
            expect(newCache.duration).to.be.eq(previousCache.duration);
            expect(newCache.expires).to.be.eq(bn(txTimestamp).add(previousCache.duration));
          });
        });
      });
    });

    describe('setTokenRateCacheDuration', () => {
      let caller: SignerWithAddress;

      function itUpdatesTheCacheDuration() {
        const newDuration = bn(MINUTE * 10);

        context("when the token doesn't have a rate provider", () => {
          it('reverts', async () => {
            const allTokens = await tokensWithBpt();
            const allRateProviders = await rateProvidersWithBpt();
            await allTokens.asyncEach(async (token, i) => {
              // Ignore tokens with rate providers
              if (allRateProviders[i] !== ZERO_ADDRESS) return;

              await expect(
                pool.connect(caller).setTokenRateCacheDuration(token.address, newDuration)
              ).to.be.revertedWith('TOKEN_DOES_NOT_HAVE_RATE_PROVIDER');
            });
          });
        });

        context('when the token has a rate provider', () => {
          it('updates the cache duration', async () => {
            const allTokens = await tokensWithBpt();
            const allRateProviders = await rateProvidersWithBpt();
            await allTokens.asyncEach(async (token, i) => {
              // Ignore tokens without rate providers
              if (allRateProviders[i] === ZERO_ADDRESS) return;

              const previousCache = await pool.getTokenRateCache(token.address);

              const newRate = fp(4.5);
              const rateProvider = await deployedAt('v2-pool-utils/MockRateProvider', allRateProviders[i]);
              await rateProvider.mockRate(newRate);
              const forceUpdateAt = await currentTimestamp();
              await pool.connect(caller).setTokenRateCacheDuration(token.address, newDuration);

              const currentCache = await pool.getTokenRateCache(token.address);
              expect(currentCache.rate).to.be.equal(newRate);
              expect(previousCache.rate).not.to.be.equal(newRate);
              expect(currentCache.duration).to.be.equal(newDuration);
              expect(currentCache.expires).to.be.at.least(forceUpdateAt.add(newDuration));
            });
          });

          it('emits an event', async () => {
            const allTokens = await tokensWithBpt();
            const allRateProviders = await rateProvidersWithBpt();
            await allTokens.asyncEach(async (token, i) => {
              // Ignore tokens without rate providers
              if (allRateProviders[i] === ZERO_ADDRESS) return;

              const tx = await pool.connect(caller).setTokenRateCacheDuration(token.address, newDuration);

              expectEvent.inReceipt(await tx.wait(), 'TokenRateProviderSet', {
                token: token.address,
                provider: allRateProviders[i],
                cacheDuration: newDuration,
              });
            });
          });
        });
      }

      function itReverts() {
        it('reverts', async () => {
          await expect(pool.connect(caller).setTokenRateCacheDuration(tokens.first.address, DAY)).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });
      }

      context('with an owner', () => {
        sharedBeforeEach('deploy pool', async () => {
          await deployPoolSimple(owner, tokens);
        });

        context('when the sender is allowed', () => {
          sharedBeforeEach('set caller to owner', async () => {
            caller = owner;
          });

          context('before the cache expires', () => {
            sharedBeforeEach('advance time', async () => {
              await advanceTime(INITIAL_CACHE_DURATION.div(2));
            });

            itUpdatesTheCacheDuration();
          });

          context('after the cache has expired', () => {
            sharedBeforeEach('advance time', async () => {
              await advanceTime(INITIAL_CACHE_DURATION.mul(2));
            });

            itUpdatesTheCacheDuration();
          });
        });

        context('when the sender is not allowed', () => {
          sharedBeforeEach('set caller to other', async () => {
            caller = other;
          });

          itReverts();
        });
      });

      context('with a delegated owner', () => {
        sharedBeforeEach('deploy pool', async () => {
          await deployPoolSimple(DELEGATE_OWNER, tokens);
          caller = other;
        });

        context('when the sender is allowed', () => {
          sharedBeforeEach('grant role to caller', async () => {
            const action = await actionId(pool, 'setTokenRateCacheDuration');
            await vault.grantPermissionsGlobally([action], other);
          });

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

        context('when the sender is not allowed', () => {
          itReverts();
        });
      });
    });

    describe('scaling factors', () => {
      sharedBeforeEach('deploy pool', async () => {
        await deployPoolSimple(owner, tokens);
      });

      describe('getScalingFactors', () => {
        it('returns the correct scaling factors', async () => {
          const expectedScalingFactors = tokens.map((token) => fp(1).mul(bn(10).pow(18 - token.decimals)));
          expectedScalingFactors.splice(bptIndex, 0, fp(1));

          const scalingFactors: BigNumber[] = await pool.getScalingFactors();

          // It also includes the BPT scaling factor
          expect(scalingFactors).to.have.lengthOf(numberOfTokens + 1);
          expect(scalingFactors).to.be.deep.equal(expectedScalingFactors);
        });
      });
    });
  }
});
