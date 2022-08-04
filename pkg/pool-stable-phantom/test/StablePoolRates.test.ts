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
import { advanceTime, currentTimestamp, DAY, HOUR, MINUTE, MONTH } from '@balancer-labs/v2-helpers/src/time';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';

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
      poolOwner: Account,
      tokens: TokenList,
      numRateProviders = tokens.length,
      numTokenCacheDurations = tokens.length,
      numExemptFlags = tokens.length
    ): Promise<void> {
      const newRateProviders = [];
      for (let i = 0; i < numRateProviders; i++) {
        const hasRateProvider = Math.random() < 0.5;
        newRateProviders[i] = hasRateProvider ? (await deploy('v2-pool-utils/MockRateProvider')).address : ZERO_ADDRESS;
      }

      const newExemptFromYieldProtocolFeeFlags = [];
      for (let i = 0; i < numExemptFlags; i++) {
        const isExempt = Math.random() < 0.5;
        newExemptFromYieldProtocolFeeFlags[i] = newRateProviders[i] !== ZERO_ADDRESS && isExempt;
      }

      tokenRateCacheDurations = Array.from({ length: numTokenCacheDurations }, () => INITIAL_CACHE_DURATION);

      pool = await deploy('MockStablePoolRates', {
        args: [
          vault.address,
          tokens.addresses,
          newRateProviders,
          tokenRateCacheDurations,
          newExemptFromYieldProtocolFeeFlags,
          TypesConverter.toAddress(poolOwner),
        ],
      });
      bptIndex = (await pool.getBptIndex()).toNumber();
      rateProviders = newRateProviders;
      exemptFromYieldProtocolFeeFlags = newExemptFromYieldProtocolFeeFlags;
    }

    describe('constructor', () => {
      context('when the constructor succeeds', () => {
        sharedBeforeEach('deploy pool', async () => {
          await deployPool(owner, tokens);
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
          await expect(deployPool(owner, tokens, tokens.length + 1)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if the cache durations do not match the tokens length', async () => {
          await expect(deployPool(owner, tokens, tokens.length, tokens.length + 1)).to.be.revertedWith(
            'INPUT_LENGTH_MISMATCH'
          );
        });
      });
    });

    describe('setTokenRateCacheDuration', () => {
      let caller: SignerWithAddress;

      function itUpdatesTheCacheDuration() {
        const newDuration = bn(MINUTE * 10);

        it('updates the cache duration', async () => {
          await tokens.asyncEach(async (token, i) => {
            if (rateProviders[i] === ZERO_ADDRESS) return;

            const previousCache = await pool.getTokenRateCache(token.address);

            const newRate = fp(4.5);
            const rateProvider = await deployedAt('v2-pool-utils/MockRateProvider', rateProviders[i]);
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
          await tokens.asyncEach(async (token, i) => {
            if (rateProviders[i] === ZERO_ADDRESS) return;
            const tx = await pool.connect(caller).setTokenRateCacheDuration(token.address, newDuration);

            expectEvent.inReceipt(await tx.wait(), 'TokenRateProviderSet', {
              token: token.address,
              provider: rateProviders[i],
              cacheDuration: newDuration,
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
          await deployPool(owner, tokens);
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
          await deployPool(DELEGATE_OWNER, tokens);
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
        await deployPool(owner, tokens);
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
