import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_INT22, MAX_UINT10, MAX_UINT31, MIN_INT22, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { MINUTE, advanceTime, currentTimestamp, lastBlockNumber } from '@balancer-labs/v2-helpers/src/time';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { Sample } from '@balancer-labs/v2-helpers/src/models/pools/stable/types';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('MetaStablePool', function () {
  let pool: StablePool;
  let tokens: TokenList;
  let admin: SignerWithAddress, other: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;

  const swapFeePercentage = fp(0.01);
  const initialBalances = [fp(0.9), fp(1.8)];

  before('setup signers', async () => {
    [, lp, other, owner, admin] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(['MKR', 'DAI'], { sorted: true });
    await tokens.mint({ to: [lp], amount: fp(100) });
  });

  sharedBeforeEach('deploy pool', async () => {
    pool = await StablePool.create({ meta: true, tokens, swapFeePercentage, owner });
  });

  const initializePool = () => {
    sharedBeforeEach('initialize pool', async () => {
      await pool.init({ initialBalances, recipient: lp });
    });
  };

  describe('misc data', () => {
    initializePool();

    const assertPacking = async (
      oracleEnabled: boolean,
      oracleIndex: BigNumberish,
      oracleSampleCreationTimestamp: BigNumberish,
      logInvariant: BigNumberish,
      logTotalSupply: BigNumberish
    ) => {
      await pool.instance.mockMiscData({
        oracleEnabled,
        oracleIndex,
        oracleSampleCreationTimestamp,
        logInvariant,
        logTotalSupply,
      });

      const miscData = await pool.getOracleMiscData();
      expect(miscData.oracleEnabled).to.be.equal(oracleEnabled);
      expect(miscData.oracleIndex).to.be.equal(oracleIndex);
      expect(miscData.oracleSampleCreationTimestamp).to.be.equal(oracleSampleCreationTimestamp);
      expect(miscData.logInvariant).to.be.equal(logInvariant);
      expect(miscData.logTotalSupply).to.be.equal(logTotalSupply);
    };

    it('packs samples correctly', async () => {
      await assertPacking(true, 5, 50, 2, 3);
      await assertPacking(false, 5, 50, -2, -3);
      await assertPacking(true, 0, 0, 0, 0);
      await assertPacking(false, 0, 0, 0, 0);
      await assertPacking(true, MAX_UINT10, 0, 0, 0);
      await assertPacking(false, 0, MAX_UINT31, 0, 0);
      await assertPacking(true, 0, 0, MAX_INT22, 0);
      await assertPacking(false, 0, 0, MIN_INT22, 0);
      await assertPacking(true, 0, 0, 0, MIN_INT22);
      await assertPacking(false, 0, 0, 0, MAX_INT22);
      await assertPacking(true, MAX_UINT10, MAX_UINT31, MIN_INT22, MIN_INT22);
      await assertPacking(false, MAX_UINT10, MAX_UINT31, MAX_INT22, MAX_INT22);
      await assertPacking(true, MAX_UINT10.div(2), MAX_UINT31.div(2), MIN_INT22.div(2), MIN_INT22.div(2));
      await assertPacking(false, MAX_UINT10.div(2), MAX_UINT31.div(2), MAX_INT22.div(2), MAX_INT22.div(2));
    });
  });

  describe('oracle', () => {
    const MAX_RELATIVE_ERROR = 0.00005;

    type PoolHook = (lastChangeBlock: number) => Promise<unknown>;

    const calcLastChangeBlock = async (offset: number): Promise<number> => {
      const nextBlockNumber = (await lastBlockNumber()) + 1;
      return nextBlockNumber - offset;
    };

    const itUpdatesTheOracleData = (action: PoolHook, lastChangeBlockOffset = 0) => {
      context('without updated oracle', () => {
        it('updates the oracle data', async () => {
          const previousData = await pool.getOracleMiscData();

          await advanceTime(MINUTE * 10); // force index update
          await action(await calcLastChangeBlock(lastChangeBlockOffset));

          const currentMiscData = await pool.getOracleMiscData();
          expect(currentMiscData.oracleIndex).to.equal(previousData.oracleIndex.add(1));
          expect(currentMiscData.oracleSampleCreationTimestamp).to.equal(await currentTimestamp());
        });
      });

      context('with updated oracle', () => {
        let previousBalances: BigNumber[], previousTotalSupply: BigNumber, newSample: Sample;

        sharedBeforeEach(async () => {
          previousBalances = await pool.getBalances();
          previousTotalSupply = await pool.totalSupply();

          await advanceTime(MINUTE * 10); // force index update
          await action(await calcLastChangeBlock(lastChangeBlockOffset));

          newSample = await pool.getOracleSample();
        });

        it('stores the pre-action spot price', async () => {
          const expectedSpotPrice = await pool.estimateSpotPrice(previousBalances);
          const actual = await pool.instance.fromLowResLog(newSample.logPairPrice);

          expect(actual).to.equalWithError(expectedSpotPrice, MAX_RELATIVE_ERROR);
        });

        it('stores the pre-action BPT price', async () => {
          const expectedBPTPrice = await pool.estimateBptPrice(previousBalances, previousTotalSupply);
          const actual = await pool.instance.fromLowResLog(newSample.logBptPrice);

          // The BPT price has twice as much error
          expect(actual).to.equalWithError(expectedBPTPrice, MAX_RELATIVE_ERROR * 2);
        });

        it('stores the pre-action invariant', async () => {
          const expectedInvariant = await pool.estimateInvariant(previousBalances);
          const actual = await pool.instance.fromLowResLog(newSample.logInvariant);

          expect(actual).to.equalWithError(expectedInvariant, MAX_RELATIVE_ERROR);
        });
      });
    };

    const itDoesNotUpdateTheOracleData = (action: PoolHook, lastChangeBlockOffset = 0) => {
      it('does not update the oracle data', async () => {
        const previousMiscData = await pool.getOracleMiscData();

        await action(await calcLastChangeBlock(lastChangeBlockOffset));

        const currentMiscData = await pool.getOracleMiscData();
        expect(currentMiscData.oracleIndex).to.equal(previousMiscData.oracleIndex);
        expect(currentMiscData.oracleSampleCreationTimestamp).to.equal(previousMiscData.oracleSampleCreationTimestamp);
      });
    };

    const itCachesTheLogInvariantAndSupply = (action: PoolHook, lastChangeBlockOffset = 0) => {
      it('caches the log of the last invariant', async () => {
        await action(await calcLastChangeBlock(lastChangeBlockOffset));

        const currentMiscData = await pool.getOracleMiscData();
        const actualInvariant = await pool.instance.fromLowResLog(currentMiscData.logInvariant);
        const { lastInvariant: expectedInvariant } = await pool.getLastInvariant();
        expect(actualInvariant).to.be.equalWithError(expectedInvariant, MAX_RELATIVE_ERROR);
      });

      it('caches the total supply', async () => {
        await action(await calcLastChangeBlock(lastChangeBlockOffset));

        const currentMiscData = await pool.getOracleMiscData();
        const actualTotalSupply = await pool.instance.fromLowResLog(currentMiscData.logTotalSupply);
        const expectedTotalSupply = await pool.totalSupply();
        expect(actualTotalSupply).to.equalWithError(expectedTotalSupply, MAX_RELATIVE_ERROR);
      });
    };

    const itDoesNotCacheTheLogInvariantAndSupply = (action: PoolHook, lastChangeBlockOffset = 0) => {
      it('does not cache the log invariant and supply', async () => {
        const previousMiscData = await pool.getOracleMiscData();

        await action(await calcLastChangeBlock(lastChangeBlockOffset));

        const currentMiscData = await pool.getOracleMiscData();
        expect(currentMiscData.logInvariant).to.equal(previousMiscData.logInvariant);
        expect(currentMiscData.logTotalSupply).to.equal(previousMiscData.logTotalSupply);
      });
    };

    const itDoesNotDoAnythingWhenDisabled = (action: PoolHook, lastChangeBlockOffset = 0) => {
      sharedBeforeEach('mock oracle disabled', async () => {
        await pool.instance.mockOracleDisabled();
      });

      itDoesNotUpdateTheOracleData(action, lastChangeBlockOffset);
      itDoesNotCacheTheLogInvariantAndSupply(action, lastChangeBlockOffset);
    };

    describe('initialize', () => {
      const action = () => pool.init({ initialBalances });

      context('when the oracle is enabled', () => {
        itDoesNotUpdateTheOracleData(action);
        itCachesTheLogInvariantAndSupply(action);
      });

      context('when the oracle is disabled', () => {
        itDoesNotDoAnythingWhenDisabled(action);
      });
    });

    describe('join', () => {
      const action = (lastChangeBlock: number) => pool.joinGivenIn({ amountsIn: fp(1), lastChangeBlock });

      initializePool();

      context('when the latest change block is an old block', () => {
        const lastChangeBlockOffset = 1;

        context('when the oracle is enabled', () => {
          itUpdatesTheOracleData(action, lastChangeBlockOffset);
          itCachesTheLogInvariantAndSupply(action, lastChangeBlockOffset);
        });

        context('when the oracle is disabled', () => {
          itDoesNotDoAnythingWhenDisabled(action, lastChangeBlockOffset);
        });
      });

      context('when the latest change block is the current block', () => {
        const lastChangeBlockOffset = 0;

        context('when the oracle is enabled', () => {
          itDoesNotUpdateTheOracleData(action, lastChangeBlockOffset);
          itCachesTheLogInvariantAndSupply(action, lastChangeBlockOffset);
        });

        context('when the oracle is disabled', () => {
          itDoesNotDoAnythingWhenDisabled(action, lastChangeBlockOffset);
        });
      });
    });

    describe('exit', () => {
      const action = async (lastChangeBlock: number) => {
        const balance = await pool.balanceOf(lp);
        await pool.multiExitGivenIn({ bptIn: balance.div(2), lastChangeBlock, from: lp });
      };

      initializePool();

      context('when the pool is paused', () => {
        sharedBeforeEach('pause pool', async () => {
          await pool.pause();
        });

        context('when the latest change block is an old block', () => {
          const lastChangeBlockOffset = 1;

          context('when the oracle is enabled', () => {
            itDoesNotUpdateTheOracleData(action, lastChangeBlockOffset);
            itDoesNotCacheTheLogInvariantAndSupply(action, lastChangeBlockOffset);
          });

          context('when the oracle is disabled', () => {
            itDoesNotDoAnythingWhenDisabled(action, lastChangeBlockOffset);
          });
        });

        context('when the latest change block is the current block', () => {
          const lastChangeBlockOffset = 0;

          context('when the oracle is enabled', () => {
            itDoesNotUpdateTheOracleData(action, lastChangeBlockOffset);
            itDoesNotCacheTheLogInvariantAndSupply(action, lastChangeBlockOffset);
          });

          context('when the oracle is disabled', () => {
            itDoesNotDoAnythingWhenDisabled(action, lastChangeBlockOffset);
          });
        });
      });

      context('when the pool is not paused', () => {
        context('when the latest change block is an old block', () => {
          const lastChangeBlockOffset = 1;

          context('when the oracle is enabled', () => {
            itUpdatesTheOracleData(action, lastChangeBlockOffset);
            itCachesTheLogInvariantAndSupply(action, lastChangeBlockOffset);
          });

          context('when the oracle is disabled', () => {
            itDoesNotDoAnythingWhenDisabled(action, lastChangeBlockOffset);
          });
        });

        context('when the latest change block is the current block', () => {
          const lastChangeBlockOffset = 0;

          context('when the oracle is enabled', () => {
            itDoesNotUpdateTheOracleData(action, lastChangeBlockOffset);
            itCachesTheLogInvariantAndSupply(action, lastChangeBlockOffset);
          });

          context('when the oracle is disabled', () => {
            itDoesNotDoAnythingWhenDisabled(action, lastChangeBlockOffset);
          });
        });
      });
    });

    describe('swaps', () => {
      const amount = fp(0.01);

      initializePool();

      const itUpdatesOracleOnSwapCorrectly = (action: PoolHook) => {
        context('when the latest change block is an old block', () => {
          const lastChangeBlockOffset = 1;

          context('when the oracle is enabled', () => {
            itUpdatesTheOracleData(action, lastChangeBlockOffset);
            itDoesNotCacheTheLogInvariantAndSupply(action, lastChangeBlockOffset);
          });

          context('when the oracle is disabled', () => {
            itDoesNotDoAnythingWhenDisabled(action, lastChangeBlockOffset);
          });
        });

        context('when the latest change block is the current block', () => {
          const lastChangeBlockOffset = 0;

          context('when the oracle is enabled', () => {
            itDoesNotUpdateTheOracleData(action, lastChangeBlockOffset);
            itDoesNotCacheTheLogInvariantAndSupply(action, lastChangeBlockOffset);
          });

          context('when the oracle is disabled', () => {
            itDoesNotDoAnythingWhenDisabled(action, lastChangeBlockOffset);
          });
        });
      };

      context('given in', () => {
        const action = (lastChangeBlock: number) => pool.swapGivenIn({ in: 0, out: 1, amount, lastChangeBlock });

        itUpdatesOracleOnSwapCorrectly(action);
      });

      context('given out', () => {
        const action = (lastChangeBlock: number) => pool.swapGivenOut({ in: 1, out: 0, amount, lastChangeBlock });

        itUpdatesOracleOnSwapCorrectly(action);
      });
    });

    describe('setting', () => {
      const action = () => pool.enableOracle({ from: admin });

      sharedBeforeEach('grant role to admin', async () => {
        const action = await actionId(pool.instance, 'enableOracle');
        await pool.vault.grantPermissionsGlobally([action], admin);
      });

      context('when it starts enabled', () => {
        it('is enabled', async () => {
          expect(await pool.isOracleEnabled()).to.be.true;
        });

        it('does not fail when trying to enable again', async () => {
          await expect(pool.enableOracle({ from: admin })).not.to.be.reverted;
        });

        itDoesNotCacheTheLogInvariantAndSupply(action);
      });

      context('when it starts disabled', () => {
        sharedBeforeEach('mock pool disable oracle', async () => {
          await pool.instance.mockOracleDisabled();
        });

        context('when the pool was not initialized', async () => {
          itDoesNotCacheTheLogInvariantAndSupply(action);
        });

        context('when the pool was initialized', async () => {
          initializePool();

          it('is disabled and can be enabled', async () => {
            expect(await pool.isOracleEnabled()).to.be.false;

            await action();

            expect(await pool.isOracleEnabled()).to.be.true;
          });

          it('can only be updated by the admin', async () => {
            await expect(pool.enableOracle({ from: other })).to.be.revertedWith('SENDER_NOT_ALLOWED');
            await expect(pool.enableOracle({ from: owner })).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });

          itCachesTheLogInvariantAndSupply(action);
        });
      });
    });
  });

  describe('price rates', () => {
    let rateProviders: Contract[], oldPriceRate0: BigNumber, oldPriceRate1: BigNumber;
    const cacheDurations = [MINUTE, MINUTE * 2];

    const scaleRate = (rate: BigNumber, token: Token) => rate.mul(bn(10).pow(18 - token.decimals));

    sharedBeforeEach('deploy tokens', async () => {
      const dai = await Token.create({ symbol: 'DAI', decimals: 18 });
      const usdc = await Token.create({ symbol: 'USDC', decimals: 6 });
      tokens = new TokenList(dai.compare(usdc) < 0 ? [dai, usdc] : [usdc, dai]);
    });

    context('with rate providers', () => {
      const createPoolWithInitialRates = (delta: number) => {
        sharedBeforeEach('mock price rates and deploy pool', async () => {
          rateProviders = await Promise.all(initialBalances.map(() => deploy('v2-pool-utils/MockRateProvider')));
          await rateProviders[0].mockRate(fp(1).add(fp(delta)));
          await rateProviders[1].mockRate(fp(1).add(fp(delta * 2)));

          pool = await StablePool.create({
            meta: true,
            tokens,
            swapFeePercentage,
            rateProviders,
            priceRateCacheDuration: cacheDurations,
            owner,
          });
        });
      };

      const mockNewRatesAndAdvanceTime = (seconds: number) => {
        sharedBeforeEach('advance time', async () => {
          oldPriceRate0 = (await pool.instance.getPriceRateCache(tokens.first.address)).rate;
          oldPriceRate1 = (await pool.instance.getPriceRateCache(tokens.second.address)).rate;

          await rateProviders[0].mockRate(fp(1.1));
          await rateProviders[1].mockRate(fp(1.2));

          await advanceTime(seconds);
          await pool.instance.mockCachePriceRatesIfNecessary();
        });
      };

      const itAdaptsTheScalingFactorsCorrectly = () => {
        it('adapt the scaling factors with the price rate', async () => {
          const priceRates = await Promise.all(rateProviders.map((provider) => provider.getRate()));
          priceRates[0] = scaleRate(priceRates[0], tokens.first);
          priceRates[1] = scaleRate(priceRates[1], tokens.second);

          const scalingFactors = await pool.instance.getScalingFactors();
          expect(scalingFactors[0]).to.be.equal(priceRates[0]);
          expect(scalingFactors[1]).to.be.equal(priceRates[1]);

          expect(await pool.instance.getScalingFactor(tokens.first.address)).to.be.equal(priceRates[0]);
          expect(await pool.instance.getScalingFactor(tokens.second.address)).to.be.equal(priceRates[1]);
        });
      };

      const forceManualUpdate = () => {
        sharedBeforeEach('force update', async () => {
          const priceRates = await Promise.all(rateProviders.map((provider) => provider.getRate()));

          const firstReceipt = await pool.updatePriceRateCache(tokens.first);
          expectEvent.inIndirectReceipt(await firstReceipt.wait(), pool.instance.interface, 'PriceRateCacheUpdated', {
            token: tokens.first.address,
            rate: priceRates[0],
          });

          const secondReceipt = await pool.updatePriceRateCache(tokens.second);
          expectEvent.inIndirectReceipt(await secondReceipt.wait(), pool.instance.interface, 'PriceRateCacheUpdated', {
            token: tokens.second.address,
            rate: priceRates[1],
          });
        });
      };

      describe('update', () => {
        context('initially', () => {
          context('with a price rate above 1', () => {
            createPoolWithInitialRates(0.1);
            itAdaptsTheScalingFactorsCorrectly();

            it('initializes correctly', async () => {
              const cache0 = await pool.instance.getPriceRateCache(tokens.first.address);
              expect(cache0.duration).to.be.equal(cacheDurations[0]);

              const cache1 = await pool.instance.getPriceRateCache(tokens.second.address);
              expect(cache1.duration).to.be.equal(cacheDurations[1]);

              const providers = await pool.instance.getRateProviders();
              expect(providers[0]).to.be.equal(rateProviders[0].address);
              expect(providers[1]).to.be.equal(rateProviders[1].address);
            });
          });

          context('with a price rate equal to 1', () => {
            createPoolWithInitialRates(0);
            itAdaptsTheScalingFactorsCorrectly();
          });

          context('with a price rate below 1', () => {
            createPoolWithInitialRates(-0.1);
            itAdaptsTheScalingFactorsCorrectly();
          });
        });

        context('after some time', () => {
          createPoolWithInitialRates(0);

          context('before the first cache expires', () => {
            mockNewRatesAndAdvanceTime(cacheDurations[0] / 2);

            context('when not forced', () => {
              it('does not update any cache', async () => {
                const { rate: newPriceRate0 } = await pool.instance.getPriceRateCache(tokens.first.address);
                const { rate: newPriceRate1 } = await pool.instance.getPriceRateCache(tokens.second.address);

                expect(newPriceRate0).to.be.equal(oldPriceRate0);
                expect(newPriceRate1).to.be.equal(oldPriceRate1);

                const scalingFactors = await pool.instance.getScalingFactors();
                expect(scalingFactors[0]).to.be.equal(scaleRate(oldPriceRate0, tokens.first));
                expect(scalingFactors[1]).to.be.equal(scaleRate(oldPriceRate1, tokens.second));
              });
            });

            context('when forced', () => {
              forceManualUpdate();
              itAdaptsTheScalingFactorsCorrectly();
            });
          });

          context('after the first cache expired but before the second does', () => {
            mockNewRatesAndAdvanceTime(cacheDurations[0] + 1);

            context('when not forced', () => {
              it('updates only the first cache', async () => {
                const { rate: newPriceRate0 } = await pool.instance.getPriceRateCache(tokens.first.address);
                const { rate: newPriceRate1 } = await pool.instance.getPriceRateCache(tokens.second.address);

                expect(newPriceRate0).to.be.gt(oldPriceRate0);
                expect(newPriceRate1).to.be.equal(oldPriceRate1);

                const scalingFactors = await pool.instance.getScalingFactors();
                expect(scalingFactors[0]).to.be.equal(scaleRate(newPriceRate0, tokens.first));
                expect(scalingFactors[1]).to.be.equal(scaleRate(oldPriceRate1, tokens.second));
              });
            });

            context('when forced', () => {
              forceManualUpdate();
              itAdaptsTheScalingFactorsCorrectly();
            });
          });

          context('after both caches expired', () => {
            mockNewRatesAndAdvanceTime(cacheDurations[1] + 1);

            context('when not forced', () => {
              it('updates both caches', async () => {
                const { rate: newPriceRate0 } = await pool.instance.getPriceRateCache(tokens.first.address);
                const { rate: newPriceRate1 } = await pool.instance.getPriceRateCache(tokens.second.address);

                expect(newPriceRate0).to.be.gt(oldPriceRate0);
                expect(newPriceRate1).to.be.gt(oldPriceRate1);

                const scalingFactors = await pool.instance.getScalingFactors();
                expect(scalingFactors[0]).to.be.equal(scaleRate(newPriceRate0, tokens.first));
                expect(scalingFactors[1]).to.be.equal(scaleRate(newPriceRate1, tokens.second));
              });
            });

            context('when forced', () => {
              forceManualUpdate();
              itAdaptsTheScalingFactorsCorrectly();
            });
          });
        });
      });

      describe('setting', () => {
        createPoolWithInitialRates(0);

        sharedBeforeEach('grant role to admin', async () => {
          const action = await actionId(pool.instance, 'setPriceRateCacheDuration');
          await pool.vault.grantPermissionsGlobally([action], admin);
        });

        const setNewPriceRateCache = () => {
          let forceUpdateAt: BigNumber;
          const newDuration = MINUTE * 10;

          sharedBeforeEach('update price rate cache', async () => {
            forceUpdateAt = await currentTimestamp();

            const firstReceipt = await pool.setPriceRateCacheDuration(tokens.first, newDuration, { from: admin });
            expectEvent.inReceipt(await firstReceipt.wait(), 'PriceRateProviderSet', {
              token: tokens.first.address,
              provider: rateProviders[0].address,
              cacheDuration: newDuration,
            });

            const secondReceipt = await pool.setPriceRateCacheDuration(tokens.second, newDuration, { from: admin });
            expectEvent.inReceipt(await secondReceipt.wait(), 'PriceRateProviderSet', {
              token: tokens.second.address,
              provider: rateProviders[1].address,
              cacheDuration: newDuration,
            });
          });

          it('updates the cache duration', async () => {
            const cache0 = await pool.instance.getPriceRateCache(tokens.first.address);
            expect(cache0.duration).to.be.equal(newDuration);
            expect(cache0.expires).to.be.at.least(forceUpdateAt.add(newDuration));

            const cache1 = await pool.instance.getPriceRateCache(tokens.second.address);
            expect(cache1.duration).to.be.equal(newDuration);
            expect(cache1.expires).to.be.at.least(forceUpdateAt.add(newDuration));
          });
        };

        context('when it is requested by the admin', () => {
          context('when it did not passed the previous duration', () => {
            mockNewRatesAndAdvanceTime(MINUTE / 2);
            setNewPriceRateCache();
            itAdaptsTheScalingFactorsCorrectly();
          });

          context('when it passed the previous duration', () => {
            mockNewRatesAndAdvanceTime(MINUTE * 2);
            setNewPriceRateCache();
            itAdaptsTheScalingFactorsCorrectly();
          });
        });

        context('when it is not requested by the admin', () => {
          it('reverts', async () => {
            await expect(pool.setPriceRateCacheDuration(tokens.first, MINUTE * 10, { from: other })).to.be.revertedWith(
              'SENDER_NOT_ALLOWED'
            );
          });
        });
      });
    });

    context('with zeroed rate providers', () => {
      sharedBeforeEach('deploy pool', async () => {
        const rateProviders = [ZERO_ADDRESS, ZERO_ADDRESS];
        pool = await StablePool.create({ meta: true, tokens, swapFeePercentage, rateProviders, owner });
      });

      it('does not affect the scaling factors', async () => {
        const expectedFactor0 = scaleRate(fp(1), tokens.first);
        const expectedFactor1 = scaleRate(fp(1), tokens.second);

        const scalingFactors = await pool.instance.getScalingFactors();
        expect(scalingFactors[0]).to.be.equal(expectedFactor0);
        expect(scalingFactors[1]).to.be.equal(expectedFactor1);

        expect(await pool.instance.getScalingFactor(tokens.first.address)).to.be.equal(expectedFactor0);
        expect(await pool.instance.getScalingFactor(tokens.second.address)).to.be.equal(expectedFactor1);
      });

      it('cannot update the price rate cache duration', async () => {
        const action = await actionId(pool.instance, 'setPriceRateCacheDuration');
        await pool.vault.grantPermissionsGlobally([action], admin);

        await expect(pool.setPriceRateCacheDuration(tokens.first, MINUTE * 10, { from: admin })).to.be.revertedWith(
          'INVALID_TOKEN'
        );

        await expect(pool.setPriceRateCacheDuration(tokens.second, MINUTE * 10, { from: admin })).to.be.revertedWith(
          'INVALID_TOKEN'
        );
      });
    });

    context('with no providers', () => {
      it('reverts', async () => {
        await expect(
          StablePool.create({ meta: true, tokens, swapFeePercentage, rateProviders: [] })
        ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
      });
    });
  });
});
