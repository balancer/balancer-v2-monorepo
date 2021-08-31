import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MAX_UINT112 } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { RawLinearPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/linear/types';
import { advanceTime, currentTimestamp, MINUTE } from '@balancer-labs/v2-helpers/src/time';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('LinearPool', function () {
  let pool: LinearPool, tokens: TokenList, mainToken: Token, wrappedToken: Token;
  let trader: SignerWithAddress, lp: SignerWithAddress, admin: SignerWithAddress, owner: SignerWithAddress;

  const TOTAL_TOKENS = 3;
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  before('setup', async () => {
    [, lp, trader, admin, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(['DAI', 'CDAI'], { sorted: true });
    await tokens.mint({ to: [lp, trader], amount: fp(100) });

    mainToken = tokens.DAI;
    wrappedToken = tokens.CDAI;
  });

  async function deployPool(params: RawLinearPoolDeployment, mockedVault = true): Promise<void> {
    params = Object.assign({}, { swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE, owner, admin }, params);
    pool = await LinearPool.create(params, mockedVault);
  }

  describe('creation', () => {
    context('when the creation succeeds', () => {
      let lowerTarget: BigNumber;
      let upperTarget: BigNumber;

      sharedBeforeEach('deploy pool', async () => {
        lowerTarget = fp(1000);
        upperTarget = fp(2000);
        await deployPool({ mainToken, wrappedToken, lowerTarget, upperTarget }, false);
      });

      it('sets the vault', async () => {
        expect(await pool.getVault()).to.equal(pool.vault.address);
      });

      it('uses general specialization', async () => {
        const { address, specialization } = await pool.getRegisteredInfo();
        expect(address).to.equal(pool.address);
        expect(specialization).to.equal(PoolSpecialization.GeneralPool);
      });

      it('registers tokens and bpt in the vault', async () => {
        const { tokens, balances } = await pool.getTokens();

        expect(tokens).to.have.members(pool.tokens.addresses);
        expect(balances).to.be.zeros;
      });

      it('sets the asset managers', async () => {
        await tokens.asyncEach(async (token) => {
          const { assetManager } = await pool.getTokenInfo(token);
          expect(assetManager).to.be.zeroAddress;
        });
      });

      it('sets swap fee', async () => {
        expect(await pool.getSwapFeePercentage()).to.equal(POOL_SWAP_FEE_PERCENTAGE);
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

      it('sets the targets', async () => {
        const targets = await pool.getTargets();
        expect(targets.lowerTarget).to.be.equal(lowerTarget);
        expect(targets.upperTarget).to.be.equal(upperTarget);
      });
    });

    context('when the creation fails', () => {
      it('reverts if there are repeated tokens', async () => {
        await expect(deployPool({ mainToken, wrappedToken: mainToken }, false)).to.be.revertedWith('UNSORTED_ARRAY');
      });

      it('reverts if lowerTarget is greater than upperTarget', async () => {
        await expect(
          deployPool({ mainToken, wrappedToken, lowerTarget: fp(3000), upperTarget: fp(2000) }, false)
        ).to.be.revertedWith('LOWER_GREATER_THAN_UPPER_TARGET');
      });

      it('reverts if upperTarget is greater than max token balance', async () => {
        await expect(
          deployPool({ mainToken, wrappedToken, lowerTarget: fp(3000), upperTarget: MAX_UINT112.add(1) }, false)
        ).to.be.revertedWith('UPPER_TARGET_TOO_HIGH');
      });
    });
  });

  describe('initialization', () => {
    sharedBeforeEach('deploy pool', async () => {
      await deployPool({ mainToken, wrappedToken }, false);
    });

    it('adds bpt to the vault', async () => {
      const previousBalances = await pool.getBalances();
      expect(previousBalances).to.be.zeros;

      await pool.initialize();

      const currentBalances = await pool.getBalances();
      expect(currentBalances[pool.bptIndex]).to.be.equal(MAX_UINT112);
      expect(currentBalances[pool.mainIndex]).to.be.equal(0);
      expect(currentBalances[pool.wrappedIndex]).to.be.equal(0);

      expect(await pool.totalSupply()).to.be.equal(MAX_UINT112);
    });
  });

  describe('set targets', () => {
    sharedBeforeEach('deploy pool', async () => {
      const lowerTarget = fp(1000);
      const upperTarget = fp(2000);
      await deployPool({ mainToken, wrappedToken, lowerTarget, upperTarget, owner }, true);
    });

    const setBalances = async (
      pool: LinearPool,
      balances: { mainBalance?: BigNumber; wrappedBalance?: BigNumber; bptBalance?: BigNumber }
    ) => {
      const poolId = await pool.getPoolId();

      const updateBalances = Array.from({ length: TOTAL_TOKENS }, (_, i) =>
        i == pool.mainIndex
          ? balances.mainBalance ?? bn(0)
          : i == pool.wrappedIndex
          ? balances.wrappedBalance ?? bn(0)
          : i == pool.bptIndex
          ? balances.bptBalance ?? bn(0)
          : bn(0)
      );

      await pool.vault.updateBalances(poolId, updateBalances);
    };

    it('correctly if inside free zone ', async () => {
      const mainBalance = fp(1800);
      const lowerTarget = fp(1500);
      const upperTarget = fp(2500);

      await setBalances(pool, { mainBalance });

      await pool.setTargets(lowerTarget, upperTarget);

      const targets = await pool.getTargets();
      expect(targets.lowerTarget).to.be.equal(lowerTarget);
      expect(targets.upperTarget).to.be.equal(upperTarget);
    });

    it('reverts if under free zone', async () => {
      const mainBalance = fp(100);
      const lowerTarget = fp(1500);
      const upperTarget = fp(2500);

      await setBalances(pool, { mainBalance });

      await expect(pool.setTargets(lowerTarget, upperTarget)).to.be.revertedWith('OUT_OF_TARGET_RANGE');
    });

    it('reverts if over free zone', async () => {
      const mainBalance = fp(3000);
      const lowerTarget = fp(1500);
      const upperTarget = fp(2500);

      await setBalances(pool, { mainBalance });

      await expect(pool.setTargets(lowerTarget, upperTarget)).to.be.revertedWith('OUT_OF_TARGET_RANGE');
    });

    it('reverts not owner', async () => {
      const lowerTarget = fp(1500);
      const upperTarget = fp(2500);

      await expect(pool.setTargets(lowerTarget, upperTarget, { from: lp })).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    it('emits an event', async () => {
      const mainBalance = fp(1800);
      const lowerTarget = fp(1500);
      const upperTarget = fp(2500);

      await setBalances(pool, { mainBalance });
      const receipt = await pool.setTargets(lowerTarget, upperTarget);

      expectEvent.inReceipt(await receipt.wait(), 'TargetsSet', {
        lowerTarget,
        upperTarget,
      });
    });
  });

  describe('get rate', () => {
    let poolId: string;
    let balances: BigNumber[];

    sharedBeforeEach('deploy pool and initialize pool', async () => {
      await deployPool({ mainToken, wrappedToken }, true);

      poolId = await pool.getPoolId();
      balances = Array.from({ length: TOTAL_TOKENS }, (_, i) => (i == pool.bptIndex ? MAX_UINT112 : bn(0)));

      await (await pool.vault).updateBalances(poolId, balances);
    });

    context('before swaps', () => {
      it('rate is zero', async () => {
        await expect(pool.getRate()).to.be.revertedWith('ZERO_DIVISION');
      });
    });

    context('once swapped', () => {
      it('rate lower than one', async () => {
        balances[pool.mainIndex] = fp(50);
        balances[pool.wrappedIndex] = fp(50.50505051);
        balances[pool.bptIndex] = MAX_UINT112.sub(fp(101.010101));

        await (await pool.vault).updateBalances(poolId, balances);

        const result = await pool.getRate();
        expect(result.lte(fp(1))).to.be.true;
      });

      it('rate higher than one', async () => {
        balances[pool.mainIndex] = fp(6342.983516);
        balances[pool.wrappedIndex] = fp(6309.88467);
        balances[pool.bptIndex] = MAX_UINT112.sub(fp(6687.166002));

        await (await pool.vault).updateBalances(poolId, balances);

        const result = await pool.getRate();
        expect(result.gte(fp(1))).to.be.true;
      });
    });
  });

  describe('swaps', () => {
    let currentBalances: BigNumber[];

    sharedBeforeEach('deploy and initialize pool', async () => {
      await deployPool({ mainToken, wrappedToken, lowerTarget: fp(1000), upperTarget: fp(2000) }, true);
      currentBalances = Array.from({ length: TOTAL_TOKENS }, (_, i) => (i == pool.bptIndex ? MAX_UINT112 : bn(0)));
    });

    context('below target 1', () => {
      context('given DAI in', () => {
        it('calculate bpt out', async () => {
          const amount = fp(100);

          const result = await pool.swapGivenIn({
            in: pool.mainIndex,
            out: pool.bptIndex,
            amount: amount,
            balances: currentBalances,
          });

          expect(result).to.be.equal('101010101010101010102');

          currentBalances[pool.mainIndex] = currentBalances[pool.mainIndex].add(amount);
          currentBalances[pool.bptIndex] = currentBalances[pool.bptIndex].sub(result);
        });
      });
      context('given DAI out', () => {
        it('calculate wrapped in', async () => {
          const amount = fp(50);

          const result = await pool.swapGivenOut({
            in: pool.wrappedIndex,
            out: pool.mainIndex,
            amount: amount,
            balances: currentBalances,
          });

          expect(result).to.be.equal('50505050505050505051');

          currentBalances[pool.wrappedIndex] = currentBalances[pool.wrappedIndex].add(amount);
          currentBalances[pool.mainIndex] = currentBalances[pool.mainIndex].sub(result);
        });
      });
    });
  });

  describe('wrapped token rate cache', () => {
    let timestamp: BigNumber;
    let wrappedTokenRateProvider: Contract;
    const wrappedTokenRateCacheDuration = MINUTE * 20;

    const scaleRate = (rate: BigNumber) => rate.mul(bn(10).pow(18 - wrappedToken.decimals));

    sharedBeforeEach('deploy pool', async () => {
      wrappedTokenRateProvider = await deploy('v2-pool-utils/MockRateProvider');
      timestamp = await currentTimestamp();
      await deployPool({ mainToken, wrappedToken, wrappedTokenRateProvider, wrappedTokenRateCacheDuration });
    });

    it('initializes correctly', async () => {
      const provider = await pool.getWrappedTokenRateProvider();
      expect(provider).to.be.equal(wrappedTokenRateProvider.address);

      const { rate, duration, expires } = await pool.getWrappedTokenRateCache();
      expect(rate).to.be.equal(fp(1));
      expect(duration).to.be.equal(wrappedTokenRateCacheDuration);
      expect(expires).to.be.at.least(timestamp.add(wrappedTokenRateCacheDuration));
    });

    describe('scaling factors', () => {
      const itAdaptsTheScalingFactorsCorrectly = () => {
        const expectedBptScalingFactor = fp(1);
        const expectedMainTokenScalingFactor = fp(1);

        it('adapt the scaling factors with the price rate', async () => {
          const scalingFactors = await pool.getScalingFactors();

          const expectedWrappedTokenScalingFactor = scaleRate(await wrappedTokenRateProvider.getRate());
          expect(scalingFactors[pool.wrappedIndex]).to.be.equal(expectedWrappedTokenScalingFactor);
          expect(await pool.getScalingFactor(wrappedToken)).to.be.equal(expectedWrappedTokenScalingFactor);

          expect(scalingFactors[pool.mainIndex]).to.be.equal(expectedMainTokenScalingFactor);
          expect(await pool.getScalingFactor(mainToken)).to.be.equal(expectedMainTokenScalingFactor);

          expect(scalingFactors[pool.bptIndex]).to.be.equal(expectedBptScalingFactor);
          expect(await pool.getScalingFactor(pool.bptToken)).to.be.equal(expectedBptScalingFactor);
        });
      };

      context('with a price rate above 1', () => {
        sharedBeforeEach('mock rate', async () => {
          await wrappedTokenRateProvider.mockRate(fp(1.1));
          await pool.updateWrappedTokenRateCache();
        });

        itAdaptsTheScalingFactorsCorrectly();
      });

      context('with a price rate equal to 1', () => {
        sharedBeforeEach('mock rate', async () => {
          await wrappedTokenRateProvider.mockRate(fp(1));
          await pool.updateWrappedTokenRateCache();
        });

        itAdaptsTheScalingFactorsCorrectly();
      });

      context('with a price rate below 1', () => {
        sharedBeforeEach('mock rate', async () => {
          await wrappedTokenRateProvider.mockRate(fp(0.99));
          await pool.updateWrappedTokenRateCache();
        });

        itAdaptsTheScalingFactorsCorrectly();
      });
    });

    describe('update', () => {
      const itUpdatesTheRateCache = (action: () => Promise<ContractTransaction>) => {
        const newRate = fp(1.5);

        it('updates the cache', async () => {
          const previousCache = await pool.getWrappedTokenRateCache();

          await wrappedTokenRateProvider.mockRate(newRate);
          const updatedAt = await currentTimestamp();
          await action();

          const currentCache = await pool.getWrappedTokenRateCache();
          expect(currentCache.rate).to.be.equal(newRate);
          expect(previousCache.rate).not.to.be.equal(newRate);

          expect(currentCache.duration).to.be.equal(wrappedTokenRateCacheDuration);
          expect(currentCache.expires).to.be.at.least(updatedAt.add(wrappedTokenRateCacheDuration));
        });

        it('emits an event', async () => {
          await wrappedTokenRateProvider.mockRate(newRate);
          const receipt = await action();

          expectEvent.inReceipt(await receipt.wait(), 'WrappedTokenRateUpdated', { rate: newRate });
        });
      };

      context('before the cache expires', () => {
        sharedBeforeEach('advance time', async () => {
          await advanceTime(wrappedTokenRateCacheDuration / 2);
        });

        context('when not forced', () => {
          const action = async () => pool.instance.mockCacheWrappedTokenRateIfNecessary();

          it('does not update the cache', async () => {
            const previousCache = await pool.getWrappedTokenRateCache();

            await action();

            const currentCache = await pool.getWrappedTokenRateCache();
            expect(currentCache.rate).to.be.equal(previousCache.rate);
            expect(currentCache.expires).to.be.equal(previousCache.expires);
            expect(currentCache.duration).to.be.equal(previousCache.duration);
          });
        });

        context('when forced', () => {
          const action = async () => pool.updateWrappedTokenRateCache();

          itUpdatesTheRateCache(action);
        });
      });

      context('after the cache expires', () => {
        sharedBeforeEach('advance time', async () => {
          await advanceTime(wrappedTokenRateCacheDuration + MINUTE);
        });

        context('when not forced', () => {
          const action = async () => pool.instance.mockCacheWrappedTokenRateIfNecessary();

          itUpdatesTheRateCache(action);
        });

        context('when forced', () => {
          const action = async () => pool.updateWrappedTokenRateCache();

          itUpdatesTheRateCache(action);
        });
      });
    });

    describe('set cache duration', () => {
      const newDuration = MINUTE * 10;

      sharedBeforeEach('grant role to admin', async () => {
        const action = await actionId(pool.instance, 'setWrappedTokenRateCacheDuration');
        await pool.vault.grantRole(action, admin);
      });

      const itUpdatesTheCacheDuration = () => {
        it('updates the cache duration', async () => {
          const previousCache = await pool.getWrappedTokenRateCache();

          const newRate = fp(1.5);
          await wrappedTokenRateProvider.mockRate(newRate);
          const forceUpdateAt = await currentTimestamp();
          await pool.setWrappedTokenRateCacheDuration(newDuration, { from: admin });

          const currentCache = await pool.getWrappedTokenRateCache();
          expect(currentCache.rate).to.be.equal(newRate);
          expect(previousCache.rate).not.to.be.equal(newRate);
          expect(currentCache.duration).to.be.equal(newDuration);
          expect(currentCache.expires).to.be.at.least(forceUpdateAt.add(newDuration));
        });

        it('emits an event', async () => {
          const receipt = await pool.setWrappedTokenRateCacheDuration(newDuration, { from: admin });

          expectEvent.inReceipt(await receipt.wait(), 'WrappedTokenRateProviderSet', {
            provider: wrappedTokenRateProvider.address,
            cacheDuration: newDuration,
          });
        });
      };

      context('when it is requested by the admin', () => {
        context('before the cache expires', () => {
          sharedBeforeEach('advance time', async () => {
            await advanceTime(wrappedTokenRateCacheDuration / 2);
          });

          itUpdatesTheCacheDuration();
        });

        context('after the cache has expired', () => {
          sharedBeforeEach('advance time', async () => {
            await advanceTime(wrappedTokenRateCacheDuration + MINUTE);
          });

          itUpdatesTheCacheDuration();
        });
      });

      context('when it is requested by the owner', () => {
        it('reverts', async () => {
          await expect(pool.setWrappedTokenRateCacheDuration(10, { from: owner })).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });
      });

      context('when it is requested by another one', () => {
        it('reverts', async () => {
          await expect(pool.setWrappedTokenRateCacheDuration(10, { from: lp })).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });
      });
    });
  });
});
