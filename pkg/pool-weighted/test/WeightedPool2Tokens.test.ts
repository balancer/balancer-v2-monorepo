import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_INT22, MAX_UINT10, MAX_UINT31, MAX_UINT64, MIN_INT22 } from '@balancer-labs/v2-helpers/src/constants';
import { MINUTE, advanceTime, currentTimestamp, lastBlockNumber } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

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

  function printGas(gas: number | BigNumber): string {
    if (typeof gas !== 'number') {
      gas = gas.toNumber();
    }

    return `${(gas / 1000).toFixed(1)}k`;
  }

  describe('weights', () => {
    it('sets token weights', async () => {
      const normalizedWeights = await pool.getNormalizedWeights();

      expect(normalizedWeights).to.equalWithError(pool.normalizedWeights, 0.0000001);
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

    describe('oracle configuration', () => {
      const TWO_MINUTES = 120;
      const DEFAULT_BUFFER_SIZE = 1024;
      let sender: SignerWithAddress;

      it('starts with default sample duration', async () => {
        const sampleDuration = await pool.getSampleDuration();

        expect(sampleDuration).to.equal(TWO_MINUTES);
      });

      it('starts with the default buffer size', async () => {
        const bufferSize = await pool.getTotalSamples();

        expect(bufferSize).to.equal(DEFAULT_BUFFER_SIZE);
      });

      it('can be initialized', async () => {
        const tx = await pool.initializeOracle();
        const receipt = await tx.wait();

        console.log(`${printGas(receipt.gasUsed)} (initialize oracle)`);
      });

      context('when sender is owner', () => {
        sharedBeforeEach('set sender to owner', async () => {
          sender = owner;
        });

        context('when parameters are correct', () => {
          it('can grow the buffer', async () => {
            const NEW_BUFFER_SIZE = DEFAULT_BUFFER_SIZE * 3;

            const tx = await pool.extendOracleBuffer(sender, NEW_BUFFER_SIZE);
            const receipt = await tx.wait();

            expectEvent.inReceipt(receipt, 'OracleBufferSizeChanged', {
              bufferSize: NEW_BUFFER_SIZE,
            });

            const bufferSize = await pool.getTotalSamples();
            expect(bufferSize).to.equal(NEW_BUFFER_SIZE);
          });

          it('can shorten the sample duration', async () => {
            const NEW_SAMPLE_DURATION = TWO_MINUTES / 2;

            const tx = await pool.setOracleSampleDuration(sender, NEW_SAMPLE_DURATION);
            const receipt = await tx.wait();

            expectEvent.inReceipt(receipt, 'OracleSampleDurationChanged', {
              sampleDuration: NEW_SAMPLE_DURATION,
            });

            const sampleDuration = await pool.getSampleDuration();
            expect(sampleDuration).to.equal(NEW_SAMPLE_DURATION);
          });
        });

        context('when parameters are incorrect', () => {
          it('does not allow shrinking buffer', async () => {
            await expect(pool.extendOracleBuffer(sender, DEFAULT_BUFFER_SIZE / 2)).to.be.revertedWith(
              'ORACLE_BUFFER_SIZE_TOO_SMALL'
            );
          });

          it('requires buffer to grow', async () => {
            await expect(pool.extendOracleBuffer(sender, DEFAULT_BUFFER_SIZE)).to.be.revertedWith(
              'ORACLE_BUFFER_SIZE_TOO_SMALL'
            );
          });

          it('does not allow increasing sample duration', async () => {
            await expect(pool.setOracleSampleDuration(sender, TWO_MINUTES + 1)).to.be.revertedWith(
              'ORACLE_SAMPLE_DURATION_TOO_LONG'
            );
          });
        });
      });

      context('when sender is not owner', () => {
        sharedBeforeEach('set sender to lp', async () => {
          sender = lp;
        });

        it('does not allow extending buffer', async () => {
          await expect(pool.extendOracleBuffer(sender, DEFAULT_BUFFER_SIZE * 2)).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });

        it('does not allow setting sample duration', async () => {
          await expect(pool.setOracleSampleDuration(sender, TWO_MINUTES / 2)).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
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
