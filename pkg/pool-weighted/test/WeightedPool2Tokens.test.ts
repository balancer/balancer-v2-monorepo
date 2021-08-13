import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_INT22, MAX_UINT10, MAX_UINT31, MAX_UINT64, MIN_INT22 } from '@balancer-labs/v2-helpers/src/constants';
import { MINUTE, advanceTime, currentTimestamp, lastBlockNumber } from '@balancer-labs/v2-helpers/src/time';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { Sample, WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';

import { itBehavesAsWeightedPool } from './BaseWeightedPool.behavior';

describe('WeightedPool2Tokens', function () {
  describe('as a 2 token weighted pool', () => {
    itBehavesAsWeightedPool(2, WeightedPoolType.WEIGHTED_POOL_2TOKENS);
  });

  let trader: SignerWithAddress,
    admin: SignerWithAddress,
    other: SignerWithAddress,
    lp: SignerWithAddress,
    owner: SignerWithAddress;

  before('setup signers', async () => {
    [, lp, trader, other, owner, admin] = await ethers.getSigners();
  });

  let tokens: TokenList;

  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(['MKR', 'DAI'], { sorted: true });
    await tokens.mint({ to: [lp, trader], amount: fp(100) });
  });

  let pool: WeightedPool;
  const weights = [fp(30), fp(70)];
  const initialBalances = [fp(0.9), fp(1.8)];

  sharedBeforeEach('deploy pool', async () => {
    const params = { poolType: WeightedPoolType.WEIGHTED_POOL_2TOKENS, tokens, weights, owner };
    pool = await WeightedPool.create(params);
  });

  const initializePool = () => {
    sharedBeforeEach('initialize pool', async () => {
      await pool.init({ initialBalances, recipient: lp });
    });
  };

  describe('weights', () => {
    it('sets token weights', async () => {
      const normalizedWeights = await pool.getNormalizedWeights();

      expect(normalizedWeights).to.equalWithError(pool.normalizedWeights, 0.0000001);
    });
  });

  describe('oracle', () => {
    const MAX_RELATIVE_ERROR = 0.00005;

    type PoolHook = (lastChangeBlock: number) => Promise<{ receipt: ContractReceipt }>;

    const calcLastChangeBlock = async (offset: number): Promise<number> => {
      const nextBlockNumber = (await lastBlockNumber()) + 1;
      return nextBlockNumber - offset;
    };

    context('initialize with invalid arguments', () => {
      it('does not allow end <= start', async () => {
        expect(pool.initializeOracleStorage(200, 100)).to.be.revertedWith('OUT_OF_BOUNDS');
        expect(pool.initializeOracleStorage(100, 100)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      it('does not allow end > buffer size', async () => {
        expect(pool.initializeOracleStorage(100, 10000)).to.be.revertedWith('OUT_OF_BOUNDS');
      });
    });

    const itUpdatesTheOracleData = (action: PoolHook, lastChangeBlockOffset = 0) => {
      context('without updated oracle', () => {
        it('updates the oracle data', async () => {
          const previousData = await pool.getMiscData();

          await advanceTime(MINUTE * 10); // force index update
          await action(await calcLastChangeBlock(lastChangeBlockOffset));

          const currentMiscData = await pool.getMiscData();
          expect(currentMiscData.oracleIndex).to.equal(previousData.oracleIndex.add(1));
          expect(currentMiscData.oracleSampleCreationTimestamp).to.equal(await currentTimestamp());
        });
      });

      context('with updated oracle', () => {
        let previousBalances: BigNumber[], previousTotalSupply: BigNumber, newSample: Sample;
        let sampleIndex: number;
        const SLOTS_INITIALIZED = 10;
        const ZERO_SAMPLE = [fp(0), fp(0), fp(0), fp(0), fp(0), fp(0), fp(0)];

        sharedBeforeEach(async () => {
          previousBalances = await pool.getBalances();
          previousTotalSupply = await pool.totalSupply();

          await advanceTime(MINUTE * 10); // force index update
          await action(await calcLastChangeBlock(lastChangeBlockOffset));

          newSample = await pool.getOracleSample();
          sampleIndex = (await pool.getMiscData()).oracleIndex.toNumber();
        });

        it('stores the pre-action spot price', async () => {
          const expectedSpotPrice = await pool.estimateSpotPrice(previousBalances);
          const actual = await pool.instance.fromLowResLog(newSample.logPairPrice);

          expect(actual).to.equalWithError(expectedSpotPrice, MAX_RELATIVE_ERROR);
        });

        it('stores the pre-action BPT price', async () => {
          const expectedBPTPrice = await pool.estimateBptPrice(0, previousBalances[0], previousTotalSupply);
          const actual = await pool.instance.fromLowResLog(newSample.logBptPrice);

          // The BPT price has twice as much error
          expect(actual).to.equalWithError(expectedBPTPrice, MAX_RELATIVE_ERROR * 2);
        });

        it('stores the pre-action invariant', async () => {
          const expectedInvariant = await pool.estimateInvariant(previousBalances);
          const actual = await pool.instance.fromLowResLog(newSample.logInvariant);

          expect(actual).to.equalWithError(expectedInvariant, MAX_RELATIVE_ERROR);
        });

        it('cannot be overwritten by storage initialization', async () => {
          await pool.initializeOracleStorage(sampleIndex, sampleIndex + SLOTS_INITIALIZED);

          const afterSample = await pool.getOracleSample(sampleIndex);
          expect(afterSample).to.deep.equal(newSample);

          // One in the middle should be initialized to non-zero (but timestamp is 0)
          const initializedSample = await pool.getOracleSample(sampleIndex + SLOTS_INITIALIZED / 2);
          expect(initializedSample.timestamp).to.equal(0);
          expect(initializedSample).to.not.deep.equal(ZERO_SAMPLE);

          // One near the end should be uninitialized
          const uninitializedSample = await pool.getOracleSample(1000);
          expect(uninitializedSample).to.deep.equal(ZERO_SAMPLE);
        });
      });
    };

    const itDoesNotUpdateTheOracleData = (action: PoolHook, lastChangeBlockOffset = 0) => {
      it('does not update the oracle data', async () => {
        const previousMiscData = await pool.getMiscData();

        await action(await calcLastChangeBlock(lastChangeBlockOffset));

        const currentMiscData = await pool.getMiscData();
        expect(currentMiscData.oracleIndex).to.equal(previousMiscData.oracleIndex);
        expect(currentMiscData.oracleSampleCreationTimestamp).to.equal(previousMiscData.oracleSampleCreationTimestamp);
      });
    };

    const itCachesTheLogInvariantAndSupply = (action: PoolHook, lastChangeBlockOffset = 0) => {
      it('caches the log of the last invariant', async () => {
        await action(await calcLastChangeBlock(lastChangeBlockOffset));

        const currentMiscData = await pool.getMiscData();
        const actualInvariant = await pool.instance.fromLowResLog(currentMiscData.logInvariant);
        const expectedInvariant = await pool.getLastInvariant();
        expect(actualInvariant).to.be.equalWithError(expectedInvariant, MAX_RELATIVE_ERROR);
      });

      it('caches the total supply', async () => {
        await action(await calcLastChangeBlock(lastChangeBlockOffset));

        const currentMiscData = await pool.getMiscData();
        const actualTotalSupply = await pool.instance.fromLowResLog(currentMiscData.logTotalSupply);
        const expectedTotalSupply = await pool.totalSupply();
        expect(actualTotalSupply).to.equalWithError(expectedTotalSupply, MAX_RELATIVE_ERROR);
      });
    };

    const itDoesNotCacheTheLogInvariantAndSupply = (action: PoolHook, lastChangeBlockOffset = 0) => {
      it('does not cache the log invariant and supply', async () => {
        const previousMiscData = await pool.getMiscData();

        await action(await calcLastChangeBlock(lastChangeBlockOffset));

        const currentMiscData = await pool.getMiscData();
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
        return await pool.multiExitGivenIn({ bptIn: balance.div(2), lastChangeBlock, from: lp });
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
        const lastChangeBlockOffset = 1;
        const action = (lastChangeBlock: number) => pool.swapGivenIn({ in: 0, out: 1, amount, lastChangeBlock });

        itUpdatesOracleOnSwapCorrectly(action);
      });

      context('given out', () => {
        const lastChangeBlockOffset = 1;
        const action = (lastChangeBlock: number) => pool.swapGivenOut({ in: 1, out: 0, amount, lastChangeBlock });

        itUpdatesOracleOnSwapCorrectly(action);
      });
    });

    describe('setting', () => {
      const action = () => pool.enableOracle({ from: admin });

      sharedBeforeEach('grant role to admin', async () => {
        const action = await actionId(pool.instance, 'enableOracle');
        await pool.vault.grantRole(action, admin);
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

  describe('misc data', () => {
    initializePool();

    const assertPacking = async (
      swapFeePercentage: BigNumberish,
      oracleEnabled: boolean,
      oracleIndex: BigNumberish,
      oracleSampleCreationTimestamp: BigNumberish,
      logInvariant: BigNumberish,
      logTotalSupply: BigNumberish
    ) => {
      await pool.instance.mockMiscData({
        swapFeePercentage,
        oracleEnabled,
        oracleIndex,
        oracleSampleCreationTimestamp,
        logInvariant,
        logTotalSupply,
      });

      const miscData = await pool.getMiscData();
      expect(miscData.swapFeePercentage).to.be.equal(swapFeePercentage);
      expect(miscData.oracleEnabled).to.be.equal(oracleEnabled);
      expect(miscData.oracleIndex).to.be.equal(oracleIndex);
      expect(miscData.oracleSampleCreationTimestamp).to.be.equal(oracleSampleCreationTimestamp);
      expect(miscData.logInvariant).to.be.equal(logInvariant);
      expect(miscData.logTotalSupply).to.be.equal(logTotalSupply);
    };

    it('packs samples correctly', async () => {
      await assertPacking(100, true, 5, 50, 2, 3);
      await assertPacking(100, false, 5, 50, -2, -3);
      await assertPacking(MAX_UINT64, true, 0, 0, 0, 0);
      await assertPacking(0, false, 0, 0, 0, 0);
      await assertPacking(0, true, MAX_UINT10, 0, 0, 0);
      await assertPacking(0, false, 0, MAX_UINT31, 0, 0);
      await assertPacking(0, true, 0, 0, MAX_INT22, 0);
      await assertPacking(0, false, 0, 0, MIN_INT22, 0);
      await assertPacking(0, true, 0, 0, 0, MIN_INT22);
      await assertPacking(0, false, 0, 0, 0, MAX_INT22);
      await assertPacking(MAX_UINT64, true, MAX_UINT10, MAX_UINT31, MIN_INT22, MIN_INT22);
      await assertPacking(MAX_UINT64, false, MAX_UINT10, MAX_UINT31, MAX_INT22, MAX_INT22);
      await assertPacking(
        MAX_UINT64.div(2),
        true,
        MAX_UINT10.div(2),
        MAX_UINT31.div(2),
        MIN_INT22.div(2),
        MIN_INT22.div(2)
      );
      await assertPacking(
        MAX_UINT64.div(2),
        false,
        MAX_UINT10.div(2),
        MAX_UINT31.div(2),
        MAX_INT22.div(2),
        MAX_INT22.div(2)
      );
    });
  });
});
