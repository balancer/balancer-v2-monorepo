import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { fp, pct } from '@balancer-labs/v2-helpers/src/numbers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { range } from 'lodash';

describe('InvestmentPool', function () {
  let allTokens: TokenList;
  let poolTokens: TokenList;
  let tooManyWeights: BigNumber[];
  let owner: SignerWithAddress, other: SignerWithAddress;
  let assetManager: SignerWithAddress;
  let pool: WeightedPool;

  before('setup signers', async () => {
    [, owner, other, assetManager] = await ethers.getSigners();
  });

  const MAX_TOKENS = 100;
  const TOKEN_COUNT = 20;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = range(10000, 10000 + MAX_TOKENS); // These will be normalized to weights that are close to each other, but different

  const poolWeights: BigNumber[] = Array(TOKEN_COUNT).fill(fp(1 / TOKEN_COUNT)); //WEIGHTS.slice(0, TOKEN_COUNT).map(fp);
  const initialBalances = Array(TOKEN_COUNT).fill(fp(1));
  let sender: SignerWithAddress;

  sharedBeforeEach('deploy tokens', async () => {
    allTokens = await TokenList.create(MAX_TOKENS + 1, { sorted: true, varyDecimals: true });
    tooManyWeights = Array(allTokens.length).fill(fp(0.01));
    poolTokens = allTokens.subset(20);
    await poolTokens.mint({ to: [other], amount: fp(200) });
  });

  describe('weights and scaling factors', () => {
    for (const numTokens of range(2, MAX_TOKENS + 1)) {
      context(`with ${numTokens} tokens`, () => {
        let tokens: TokenList;

        sharedBeforeEach('deploy pool', async () => {
          tokens = allTokens.subset(numTokens);

          pool = await WeightedPool.create({
            poolType: WeightedPoolType.INVESTMENT_POOL,
            tokens,
            weights: WEIGHTS.slice(0, numTokens),
            swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          });
        });

        it('sets token weights', async () => {
          const normalizedWeights = await pool.getNormalizedWeights();

          for (let i = 0; i < numTokens; i++) {
            expectEqualWithError(normalizedWeights[i], pool.normalizedWeights[i], 0.0000001);
          }
        });

        it('sets scaling factors', async () => {
          const poolScalingFactors = await pool.getScalingFactors();
          const tokenScalingFactors = tokens.map((token) => fp(10 ** (18 - token.decimals)));

          expect(poolScalingFactors).to.deep.equal(tokenScalingFactors);
        });
      });
    }
  });

  context('with invalid creation parameters', () => {
    it('fails with < 2 tokens', async () => {
      const params = {
        tokens: allTokens.subset(1),
        weights: [fp(0.3)],
        owner,
        poolType: WeightedPoolType.INVESTMENT_POOL,
      };
      await expect(WeightedPool.create(params)).to.be.revertedWith('MIN_TOKENS');
    });

    it('fails with > 100 tokens', async () => {
      const params = {
        tokens: allTokens,
        weights: tooManyWeights,
        owner,
        poolType: WeightedPoolType.INVESTMENT_POOL,
      };
      await expect(WeightedPool.create(params)).to.be.revertedWith('MAX_TOKENS');
    });

    it('fails with mismatched tokens/weights', async () => {
      const params = {
        tokens: allTokens.subset(20),
        weights: tooManyWeights,
        owner,
        poolType: WeightedPoolType.INVESTMENT_POOL,
      };
      await expect(WeightedPool.create(params)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });
  });

  context('when deployed from factory', () => {
    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        assetManagers: Array(poolTokens.length).fill(assetManager.address),
        owner,
        poolType: WeightedPoolType.INVESTMENT_POOL,
        fromFactory: true,
      };
      pool = await WeightedPool.create(params);
    });

    it('has asset managers', async () => {
      await poolTokens.asyncEach(async (token) => {
        const info = await pool.getTokenInfo(token);
        expect(info.assetManager).to.eq(assetManager.address);
      });
    });
  });

  describe('with valid creation parameters', () => {
    context('when initialized with swaps disabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          owner,
          poolType: WeightedPoolType.INVESTMENT_POOL,
          swapEnabledOnStart: false,
        };
        pool = await WeightedPool.create(params);
      });

      it('swaps show disabled on start', async () => {
        expect(await pool.instance.getSwapEnabled()).to.be.false;
      });

      it('swaps are blocked', async () => {
        await expect(pool.swapGivenIn({ in: 1, out: 0, amount: fp(0.1) })).to.be.revertedWith('SWAPS_DISABLED');
      });
    });

    context('when initialized with swaps enabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          owner,
          poolType: WeightedPoolType.INVESTMENT_POOL,
          swapEnabledOnStart: true,
        };
        pool = await WeightedPool.create(params);
      });

      it('swaps show enabled on start', async () => {
        expect(await pool.instance.getSwapEnabled()).to.be.true;
      });

      it('swaps are not blocked', async () => {
        await pool.init({ from: owner, initialBalances });

        await expect(pool.swapGivenIn({ in: 1, out: 0, amount: fp(0.1) })).to.not.be.reverted;
      });

      it('sets token weights', async () => {
        const normalizedWeights = await pool.getNormalizedWeights();

        // Not exactly equal due to weight compression
        expect(normalizedWeights).to.equalWithError(pool.normalizedWeights, 0.0001);
      });

      describe('permissioned actions', () => {
        context('when the sender is not the owner', () => {
          it('non-owners cannot disable swaps', async () => {
            await expect(pool.setSwapEnabled(other, false)).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });

        context('when the sender is the owner', () => {
          sharedBeforeEach('set sender to owner', async () => {
            sender = owner;
            await pool.init({ from: sender, initialBalances });
          });

          it('swaps can be enabled and disabled', async () => {
            await pool.setSwapEnabled(sender, false);
            expect(await pool.instance.getSwapEnabled()).to.be.false;

            await pool.setSwapEnabled(sender, true);
            expect(await pool.instance.getSwapEnabled()).to.be.true;
          });

          it('disabling swaps emits an event', async () => {
            const receipt = await pool.setSwapEnabled(sender, false);

            expectEvent.inReceipt(await receipt.wait(), 'SwapEnabledSet', {
              swapEnabled: false,
            });
          });

          it('enabling swaps emits an event', async () => {
            const receipt = await pool.setSwapEnabled(sender, true);

            expectEvent.inReceipt(await receipt.wait(), 'SwapEnabledSet', {
              swapEnabled: true,
            });
          });

          it('owner can join and receive BPT, then exit', async () => {
            const bptBeforeJoin = await pool.balanceOf(owner.address);
            await expect(pool.joinGivenIn({ from: owner, amountsIn: initialBalances })).to.not.be.reverted;

            const bptAfterJoin = await pool.balanceOf(owner.address);
            expect(bptAfterJoin).to.gt(bptBeforeJoin);

            await expect(pool.exitGivenOut({ from: owner, amountsOut: initialBalances })).to.not.be.reverted;
            const bptAfterExit = await pool.balanceOf(owner.address);
            expect(bptAfterExit).to.lt(bptAfterJoin);
          });

          context('when swaps disabled', () => {
            sharedBeforeEach(async () => {
              await pool.setSwapEnabled(sender, false);
            });

            context('proportional joins/exits', () => {
              it('allows proportionate joins', async () => {
                const startingBpt = await pool.balanceOf(sender);
  
                const { amountsIn } = await pool.joinAllGivenOut({ from: sender, bptOut: startingBpt });
  
                const endingBpt = await pool.balanceOf(sender);
                expect(endingBpt).to.be.gt(startingBpt);
                expect(amountsIn).to.deep.equal(initialBalances);
              });
  
              it('allows proportional exits', async () => {
                const previousBptBalance = await pool.balanceOf(sender);
                const bptIn = pct(previousBptBalance, 0.8);
  
                await expect(pool.multiExitGivenIn({ from: sender, bptIn })).to.not.be.reverted;
  
                const newBptBalance = await pool.balanceOf(sender);
                expect(newBptBalance).to.equalWithError(pct(previousBptBalance, 0.2), 0.001);
              });
            });

            context('disproportionate joins/exits', () => {
              it('prevents disproportionate joins (single token)', async () => {
                const bptOut = await pool.balanceOf(sender);
  
                await expect(pool.joinGivenOut({ from: sender, bptOut, token: poolTokens.get(0) })).to.be.revertedWith(
                  'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
                );
              });
  
              it('prevents disproportionate exits (single token)', async () => {
                const previousBptBalance = await pool.balanceOf(sender);
                const bptIn = pct(previousBptBalance, 0.5);
  
                await expect(
                  pool.singleExitGivenIn({ from: sender, bptIn, token: poolTokens.get(0) })
                ).to.be.revertedWith('INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED');
              });

              it('prevents disproportionate joins (multi token)', async () => {
                const bptOut = await pool.balanceOf(sender);
                const amountsIn = [...initialBalances];
                amountsIn[0] = 0;

                await expect(pool.joinGivenIn({ from: sender, amountsIn })).to.be.revertedWith(
                  'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
                );
              });  

              it('prevents disproportionate exits (multi token)', async () => {
                const amountsOut = [...initialBalances];
                // Make it disproportionate (though it will fail with this exit type even if it's technically proportionate)
                amountsOut[0] = 0;
  
                await expect(pool.exitGivenOut({ from: sender, amountsOut })).to.be.revertedWith(
                  'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
                );
              });  
            });
          });
        });
      });
    });
  });
});
