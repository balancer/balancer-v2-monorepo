import { toNormalizedWeights } from '@balancer-labs/balancer-js';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import ManagedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/ManagedPool';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { bn, fp, fpDiv } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceToTimestamp, currentTimestamp, DAY, MONTH } from '@balancer-labs/v2-helpers/src/time';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { ethers } from 'hardhat';
import { random, range } from 'lodash';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { ManagedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';

describe('ManagedPoolSettings - add/remove token', () => {
  let vault: Vault;
  let assetManager: Contract;
  let allTokens: TokenList;
  let admin: SignerWithAddress, owner: SignerWithAddress, lp: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, owner, lp, other] = await ethers.getSigners();
  });

  const MIN_TOKENS = 2;
  const MAX_TOKENS = 50;

  sharedBeforeEach('deploy vault', async () => {
    vault = await Vault.create({ admin });
    await vault.setFeeTypePercentage(ProtocolFee.AUM, fp(0.2)); // Non-zero so that some protocol AUM fees are charged
  });

  sharedBeforeEach('deploy tokens', async () => {
    allTokens = await TokenList.create(MAX_TOKENS, { varyDecimals: true, sorted: true });

    await allTokens.mint({ to: [lp, owner], amount: fp(100) });
    await allTokens.approve({ from: lp, to: vault });
  });

  sharedBeforeEach('deploy asset manager', async () => {
    assetManager = await deploy('MockWithdrawDepositAssetManager', { args: [vault.address] });
  });

  async function createPool(
    numberOfTokens: number,
    weights?: Array<BigNumber>
  ): Promise<{ pool: ManagedPool; poolTokens: TokenList }> {
    const poolTokens = allTokens.subset(numberOfTokens);
    if (weights == undefined) {
      // We pick random weights, but ones that are not so far apart as to cause issues due to minimum weights. The
      // deployer will normalize them.
      // The largest Pool will have 50 tokens, and we'll add tokens with a weight of ~10%, decreasing all other weights
      // by ~90%. By having the denormalized weights vary between 100 and 150, in the worst case all weights will be
      // 150 except for a single 100 one, which is roughly equivalent to a Pool with 58 tokens and equal 1% weights,
      // making the smallest weight be ~1.3%. That provides enough space to add a new ~10% weight token without causing
      // for the smallest weight to drop below the minimum.
      weights = range(numberOfTokens).map(() => fp(100 + random(50)));
    }

    const pool = await ManagedPool.create({
      tokens: poolTokens,
      weights,
      owner: owner.address,
      assetManagers: Array(numberOfTokens).fill(assetManager.address),
      swapEnabledOnStart: true,
      vault,
      managementAumFeePercentage: fp(0.1), // Non-zero so that some protocol AUM fees are charged
      poolType: ManagedPoolType.MOCK_MANAGED_POOL,
    });

    return { pool, poolTokens };
  }

  describe('add token', () => {
    let newWeight: BigNumber;

    beforeEach(() => {
      newWeight = fp(random(0.08, 0.12));
    });

    it('reverts if the pool is at the maximum number of tokens', async () => {
      const { pool, poolTokens } = await createPool(MAX_TOKENS);
      const newToken = await Token.create({ decimals: random(0, 18) });

      await pool.init({ from: lp, initialBalances: poolTokens.scaledBalances(() => 10 + random(10)) });

      await expect(pool.addToken(owner, newToken, ZERO_ADDRESS, newWeight)).to.be.revertedWith('MAX_TOKENS');
    });

    it('add token (example from comments)', async () => {
      // Pool with 25/75% weights.
      const { pool, poolTokens } = await createPool(2, [fp(0.25), fp(0.75)]);
      const newToken = await Token.create({ decimals: random(0, 18) });

      await pool.init({ from: lp, initialBalances: poolTokens.scaledBalances(() => 10) });

      // Add a token at 80%
      await pool.addToken(owner, newToken, ZERO_ADDRESS, fp(0.8));

      const afterWeights = await pool.getNormalizedWeights();
      // The final weights should be 5/15/80%.
      expect(afterWeights[0]).to.equal(fp(0.05));
      expect(afterWeights[1]).to.equal(fp(0.15));
      expect(afterWeights[2]).to.equal(fp(0.8));
    });

    itAddsATokenAtTokenCount(MIN_TOKENS);
    itAddsATokenAtTokenCount(10);
    itAddsATokenAtTokenCount(30);
    itAddsATokenAtTokenCount(40);
    itAddsATokenAtTokenCount(MAX_TOKENS - 1);

    function itAddsATokenAtTokenCount(poolTokenCount: number) {
      let pool: ManagedPool;
      let poolTokens: TokenList;

      context(`when the pool has ${poolTokenCount} tokens`, () => {
        sharedBeforeEach('deploy pool', async () => {
          ({ pool, poolTokens } = await createPool(poolTokenCount));
        });

        let newToken: Token;
        sharedBeforeEach('deploy new token and asset manager', async () => {
          newToken = await Token.create({ decimals: random(0, 18) });

          await newToken.mint(owner, fp(100));
          await newToken.approve(assetManager, MAX_UINT256, { from: owner });
        });

        it('reverts if the pool is uninitialized', async () => {
          await expect(pool.addToken(owner, newToken, assetManager, newWeight)).to.be.revertedWith('UNINITIALIZED');
        });

        context('once initialized', () => {
          sharedBeforeEach('initialize pool', async () => {
            // Random non-zero balances
            await pool.init({ from: lp, initialBalances: poolTokens.scaledBalances(() => 10 + random(10)) });
          });

          describe('failure modes', () => {
            it('reverts when not called by the owner', async () => {
              await expect(pool.addToken(other, newToken, assetManager, newWeight)).to.be.revertedWith(
                'SENDER_NOT_ALLOWED'
              );
            });

            it('reverts if the token is already in the pool', async () => {
              await expect(pool.addToken(owner, poolTokens.first, assetManager, newWeight)).to.be.revertedWith(
                'TOKEN_ALREADY_REGISTERED'
              );
            });

            it('reverts if the token to add is the BPT itself', async () => {
              await expect(pool.addToken(owner, pool.address, assetManager, newWeight)).to.be.revertedWith(
                'ADD_OR_REMOVE_BPT'
              );
            });

            it("reverts if the new token's weight is too high", async () => {
              const weightTooHigh = fp(0.99);
              // We get a MIN_WEIGHT error because the large weight causes for one of the other tokens to end up below
              // the minimum weight. The maximum valid weight depends on the current weights.
              await expect(pool.addToken(owner, newToken, assetManager, weightTooHigh)).to.be.revertedWith(
                'MIN_WEIGHT'
              );
            });

            it("reverts if the new token's weight is the maximum weight", async () => {
              const invalidWeight = fp(1);
              // We get a MIN_WEIGHT error because the large weight causes for one of the other tokens to end up below
              // the minimum weight - there's no room for any other weight.
              await expect(pool.addToken(owner, newToken, assetManager, invalidWeight)).to.be.revertedWith(
                'MIN_WEIGHT'
              );
            });

            it("reverts if the new token's weight is above the maximum weight", async () => {
              const invalidWeight = fp(1).add(1);
              await expect(pool.addToken(owner, newToken, assetManager, invalidWeight)).to.be.revertedWith(
                'SUB_OVERFLOW'
              );
            });

            it("reverts if the new token's weight is below the minimum weight", async () => {
              // It'd typically be sufficient to pass the minimum weight minus one, that won't always cause a revert.
              // The Pool manually increases the weight of the last token (which will be the newly added one) so that
              // the weight sum equals 100%. Without this adjustment, it might be off due to rounding error, with each
              // token in the Pool introducing a potential error of 1e-18 (i.e. they're off-by-one). We therefore
              // account for that and pass the largest weight that always reverts due to being too low.
              const weightTooLow = fp(0.01).sub(poolTokenCount + 1);
              await expect(pool.addToken(owner, newToken, assetManager, weightTooLow)).to.be.revertedWith('MIN_WEIGHT');
            });

            it('reverts if the pool is paused', async () => {
              await pool.pause();
              await expect(pool.addToken(owner, newToken, assetManager, newWeight)).to.be.revertedWith('PAUSED');
            });

            it('reverts with a scheduled weight change', async () => {
              const startTime = (await currentTimestamp()).add(DAY);
              const endTime = startTime.add(MONTH);

              // We need to renormalize the weights as the pool returns weights that are not exactly normalized
              await pool.updateWeightsGradually(
                owner,
                startTime,
                endTime,
                toNormalizedWeights(await pool.getNormalizedWeights())
              );

              await expect(pool.addToken(owner, newToken, assetManager, newWeight)).to.be.revertedWith(
                'CHANGE_TOKENS_PENDING_WEIGHT_CHANGE'
              );
            });

            it('reverts with an ongoing weight change', async () => {
              const startTime = (await currentTimestamp()).add(DAY);
              const endTime = startTime.add(MONTH);

              // We need to renormalize the weights as the pool returns weights that are not exactly normalized
              await pool.updateWeightsGradually(
                owner,
                startTime,
                endTime,
                toNormalizedWeights(await pool.getNormalizedWeights())
              );

              await advanceToTimestamp(startTime.add(DAY));

              await expect(pool.addToken(owner, newToken, assetManager, newWeight)).to.be.revertedWith(
                'CHANGE_TOKENS_DURING_WEIGHT_CHANGE'
              );
            });
          });

          context('with swaps enabled', () => {
            sharedBeforeEach('enable swaps', async () => {
              await pool.setSwapEnabled(owner, true);
            });

            itAddsATokenWithNoErrors();
          });

          context('with swaps disabled', () => {
            sharedBeforeEach('disable swaps', async () => {
              await pool.setSwapEnabled(owner, false);
            });

            itAddsATokenWithNoErrors();
          });

          context('with join / exits enabled', () => {
            sharedBeforeEach(async () => {
              await pool.setJoinExitEnabled(owner, true);
            });

            itAddsATokenWithNoErrors();
          });

          context('with join / exits disabled', () => {
            sharedBeforeEach(async () => {
              await pool.setJoinExitEnabled(owner, false);
            });

            itAddsATokenWithNoErrors();
          });

          function itAddsATokenWithNoErrors() {
            it('adds a new token to the end of the array of tokens in the pool', async () => {
              const { tokens: beforeAddTokens } = await pool.getTokens();

              await pool.addToken(owner, newToken, assetManager, newWeight);

              const { tokens: afterAddTokens } = await pool.getTokens();
              expect(afterAddTokens.length).to.equal(beforeAddTokens.length + 1);

              expect(afterAddTokens.slice(0, -1)).to.deep.equal(beforeAddTokens);
              expect(afterAddTokens[afterAddTokens.length - 1]).to.be.eq(newToken.address);
            });

            it('the new token starts with no balance', async () => {
              await pool.addToken(owner, newToken, assetManager, newWeight);

              const { balances } = await pool.getTokens();
              expect(balances[balances.length - 1]).to.be.eq(0);
            });

            it('leaves all other balances unchanged', async () => {
              const { tokens: beforeAddTokens, balances: beforeAddBalances } = await pool.getTokens();

              await pool.addToken(owner, newToken, assetManager, newWeight);

              const { tokens: afterAddTokens, balances: afterAddBalances } = await pool.getTokens();

              beforeAddTokens.forEach((token, index) => {
                const newIndex = afterAddTokens.indexOf(token);
                expect(afterAddBalances[newIndex]).to.equal(beforeAddBalances[index]);
              });
            });

            it(`sets the token's asset manager`, async () => {
              await pool.addToken(owner, newToken, assetManager, newWeight);

              const { assetManager: actualAssetManager } = await pool.getTokenInfo(newToken);
              expect(actualAssetManager).to.equal(assetManager.address);
            });

            it(`sets the token's weight`, async () => {
              await pool.addToken(owner, newToken, assetManager, newWeight);

              const { tokens: afterAddTokens } = await pool.getTokens();
              const afterAddWeights = await pool.getNormalizedWeights();

              // We subtract 1 from this as the weights array doesn't include BPT.
              const newTokenWeightIndex = afterAddTokens.indexOf(newToken.address) - 1;
              expect(afterAddWeights[newTokenWeightIndex]).to.equalWithError(newWeight, 1e-14);
            });

            it('scales weights of all other tokens', async () => {
              const { tokens: beforeTokensWithBpt } = await pool.getTokens();
              const beforeWeights = await pool.getNormalizedWeights();

              // The first token is BPT which doesn't have a weight so we drop it.
              const beforeTokens = beforeTokensWithBpt.slice(1);
              const beforeTokenWeights = range(beforeTokens.length).map((i) => ({
                token: beforeTokens[i],
                weight: beforeWeights[i],
              }));

              await pool.addToken(owner, newToken, assetManager, newWeight);

              const { tokens: afterTokensWithBpt } = await pool.getTokens();
              const afterWeights = await pool.getNormalizedWeights();

              // The first token is BPT which doesn't have a weight so we drop it.
              const afterTokens = afterTokensWithBpt.slice(1);
              const afterTokenWeights = range(afterTokens.length).map((i) => ({
                token: afterTokens[i],
                weight: afterWeights[i],
              }));

              // In this test, we make no assumptions about the internal behavior of the pool and simply check the
              // observable state: the weights should roughly add up to fp(1), and their old ratios should remain

              expect(afterTokenWeights.reduce((sum, tokenData) => sum.add(tokenData.weight), bn(0))).to.equal(fp(1));

              beforeTokenWeights.forEach((someToken) => {
                beforeTokenWeights
                  .filter((tk) => tk.token !== someToken.token)
                  .forEach((otherToken) => {
                    const someTokenAfterIndex = afterTokens.indexOf(someToken.token);
                    const otherTokenAfterIndex = afterTokens.indexOf(otherToken.token);

                    const beforeWeightRatio = fpDiv(someToken.weight, otherToken.weight);
                    const afterWeightRatio = fpDiv(
                      afterTokenWeights[someTokenAfterIndex].weight,
                      afterTokenWeights[otherTokenAfterIndex].weight
                    );

                    expect(afterWeightRatio).to.equalWithError(beforeWeightRatio, 1e-16);
                  });
              });
            });

            it('emits an event', async () => {
              const tx = await pool.addToken(owner, newToken, assetManager, newWeight);

              expectEvent.inReceipt(await tx.wait(), 'TokenAdded', {
                token: newToken.address,
                normalizedWeight: newWeight,
              });
            });

            context('with a zero mint amount', () => {
              it('mints no BPT to the recipient', async () => {
                const balanceBefore = await pool.balanceOf(other);
                await pool.addToken(owner, newToken, assetManager, newWeight, 0, other.address);
                const balanceAfter = await pool.balanceOf(other);

                expect(balanceAfter).to.equal(balanceBefore);
              });
            });

            context('with a non-zero mint amount', () => {
              it('mints BPT to the specified address', async () => {
                const bptBalanceBefore = await pool.balanceOf(other.address);

                const mintAmount = fp(17);
                await pool.addToken(owner, newToken, assetManager, newWeight, mintAmount, other.address);

                const bptBalanceAfter = await pool.balanceOf(other.address);

                expect(bptBalanceAfter.sub(bptBalanceBefore)).to.equal(mintAmount);
              });
            });

            it('collects aum fees', async () => {
              const tx = await pool.addToken(owner, newToken, assetManager, newWeight);

              expectTransferEvent(await tx.wait(), { from: ZERO_ADDRESS, to: await pool.getOwner() }, pool);
              expectTransferEvent(
                await tx.wait(),
                { from: ZERO_ADDRESS, to: (await vault.getFeesCollector()).address },
                pool
              );

              const [, lastAumFeeCollectionTimestamp] = await pool.getManagementAumFeeParams();
              expect(lastAumFeeCollectionTimestamp).to.equal(await currentTimestamp());
            });
          }
        });
      });
    }
  });

  describe('remove token', () => {
    it('reverts if the pool is at the minimum number of tokens', async () => {
      const { pool, poolTokens } = await createPool(MIN_TOKENS);
      await pool.init({ from: lp, initialBalances: poolTokens.scaledBalances(() => 10 + random(10)) });

      const tokenToRemove = poolTokens.first;
      const { cash } = await pool.vault.getPoolTokenInfo(pool.poolId, tokenToRemove.address);
      await assetManager.withdrawFromPool(pool.poolId, tokenToRemove.address, cash);
      await expect(pool.removeToken(owner, tokenToRemove.address, ZERO_ADDRESS)).to.be.revertedWith('MIN_TOKENS');
    });

    it('remove token (example from comments)', async () => {
      // Pool with 5/15/80% weights.
      const { pool, poolTokens } = await createPool(3, [fp(0.05), fp(0.15), fp(0.8)]);

      await pool.init({ from: lp, initialBalances: poolTokens.scaledBalances(() => 10) });

      // Remove the 80% token
      const tokenToRemove = poolTokens.get(poolTokens.length - 1);
      const { cash } = await pool.vault.getPoolTokenInfo(pool.poolId, tokenToRemove.address);
      await assetManager.withdrawFromPool(pool.poolId, tokenToRemove.address, cash);

      await pool.removeToken(owner, tokenToRemove.address);

      const afterWeights = await pool.getNormalizedWeights();
      // The final weights should be 25/75%.
      expect(afterWeights[0]).to.equal(fp(0.25));
      expect(afterWeights[1]).to.equal(fp(0.75));
    });

    itRemovesATokenAtTokenCount(MIN_TOKENS + 1);
    itRemovesATokenAtTokenCount(10);
    itRemovesATokenAtTokenCount(30);
    itRemovesATokenAtTokenCount(40);
    itRemovesATokenAtTokenCount(MAX_TOKENS);

    function itRemovesATokenAtTokenCount(poolTokenCount: number) {
      let pool: ManagedPool;
      let poolTokens: TokenList;

      context(`when the pool has ${poolTokenCount} tokens`, () => {
        sharedBeforeEach('deploy pool', async () => {
          ({ pool, poolTokens } = await createPool(poolTokenCount));
        });

        let tokenToRemove: Token;

        sharedBeforeEach('select token to remove', async () => {
          tokenToRemove = poolTokens.get(random(0, poolTokenCount - 1));
        });

        it('reverts if the pool is uninitialized', async () => {
          await expect(pool.removeToken(owner, tokenToRemove)).to.be.revertedWith('UNINITIALIZED');
        });

        context('once initialized', () => {
          sharedBeforeEach('initialize pool', async () => {
            // Random non-zero balances
            await pool.init({ from: lp, initialBalances: poolTokens.scaledBalances(() => 10 + random(10)) });
          });

          sharedBeforeEach('withdraw all tokens', async () => {
            // Tokens can only be fully withdrawn via the asset manager. This assumes there's no managed balance.
            const { cash, managed } = await pool.vault.getPoolTokenInfo(pool.poolId, tokenToRemove);
            expect(managed).to.equal(0);

            await assetManager.withdrawFromPool(pool.poolId, tokenToRemove.address, cash);
          });

          describe('failure modes', () => {
            it('reverts when not called by the owner', async () => {
              await expect(pool.removeToken(other, tokenToRemove)).to.be.revertedWith('SENDER_NOT_ALLOWED');
            });

            it('reverts if the token is not in the pool', async () => {
              const otherToken = await Token.create({ decimals: random(0, 18) });
              await expect(pool.removeToken(owner, otherToken)).to.be.revertedWith('TOKEN_NOT_REGISTERED');
            });

            it('reverts if the token to remove is the BPT itself', async () => {
              await expect(pool.removeToken(owner, pool.address)).to.be.revertedWith('ADD_OR_REMOVE_BPT');
            });

            it('reverts if the pool is paused', async () => {
              await pool.pause();
              await expect(pool.removeToken(owner, tokenToRemove)).to.be.revertedWith('PAUSED');
            });

            it('reverts with a scheduled weight change', async () => {
              const startTime = (await currentTimestamp()).add(DAY);
              const endTime = startTime.add(MONTH);

              // We need to renormalize the weights as the pool returns weights that are not exactly normalized
              await pool.updateWeightsGradually(
                owner,
                startTime,
                endTime,
                toNormalizedWeights(await pool.getNormalizedWeights())
              );

              await expect(pool.removeToken(owner, tokenToRemove)).to.be.revertedWith(
                'CHANGE_TOKENS_PENDING_WEIGHT_CHANGE'
              );
            });

            it('reverts with an ongoing weight change', async () => {
              const startTime = (await currentTimestamp()).add(DAY);
              const endTime = startTime.add(MONTH);

              // We need to renormalize the weights as the pool returns weights that are not exactly normalized
              await pool.updateWeightsGradually(
                owner,
                startTime,
                endTime,
                toNormalizedWeights(await pool.getNormalizedWeights())
              );

              await advanceToTimestamp(startTime.add(DAY));

              await expect(pool.removeToken(owner, tokenToRemove)).to.be.revertedWith(
                'CHANGE_TOKENS_DURING_WEIGHT_CHANGE'
              );
            });

            it('reverts if all tokens have not been withdrawn', async () => {
              // We've already withdrawn all tokens in this test, so we simply deposit some to generate a non-zero
              // balance (as if the tokens had not been removed).
              const amount = 42;
              await tokenToRemove.transfer(assetManager.address, amount, { from: lp });
              await assetManager.depositToPool(pool.poolId, tokenToRemove.address, amount);

              const { cash, managed } = await pool.vault.getPoolTokenInfo(pool.poolId, tokenToRemove);
              expect(cash.add(managed)).to.be.gt(0);

              await expect(pool.removeToken(owner, tokenToRemove)).to.be.revertedWith('NONZERO_TOKEN_BALANCE');
            });
          });

          context('with swaps enabled', () => {
            sharedBeforeEach('enable swaps', async () => {
              await pool.setSwapEnabled(owner, true);
            });

            itRemovesATokenWithNoErrors();
          });

          context('with swaps disabled', () => {
            sharedBeforeEach('disable swaps', async () => {
              await pool.setSwapEnabled(owner, false);
            });

            itRemovesATokenWithNoErrors();
          });

          context('with join / exits enabled', () => {
            sharedBeforeEach(async () => {
              await pool.setJoinExitEnabled(owner, true);
            });

            itRemovesATokenWithNoErrors();
          });

          context('with join / exits disabled', () => {
            sharedBeforeEach(async () => {
              await pool.setJoinExitEnabled(owner, false);
            });

            itRemovesATokenWithNoErrors();
          });

          function itRemovesATokenWithNoErrors() {
            it('removes the token', async () => {
              const { tokens: beforeRemoveTokens } = await pool.getTokens();

              await pool.removeToken(owner, tokenToRemove);

              const { tokens: afterRemoveTokens } = await pool.getTokens();
              expect(afterRemoveTokens.length).to.equal(beforeRemoveTokens.length - 1);

              // We need to sort when comparing as the order may have changed
              expect([...afterRemoveTokens].sort()).to.deep.equal(
                beforeRemoveTokens.filter((address) => address != tokenToRemove.address).sort()
              );
            });

            it(`leaves all other balances unchanged`, async () => {
              const { tokens: beforeRemoveTokens, balances: beforeRemoveBalances } = await pool.getTokens();

              await pool.removeToken(owner, tokenToRemove);

              const { tokens: afterRemoveTokens, balances: afterRemoveBalances } = await pool.getTokens();

              afterRemoveTokens.forEach((token, index) => {
                const oldIndex = beforeRemoveTokens.indexOf(token);
                expect(afterRemoveBalances[index]).to.equal(beforeRemoveBalances[oldIndex]);
              });
            });

            it('scales weights of all other tokens', async () => {
              const { tokens: beforeTokensWithBpt } = await pool.getTokens();
              const beforeWeights = await pool.getNormalizedWeights();

              // The first token is BPT which doesn't have a weight so we drop it.
              const beforeTokens = beforeTokensWithBpt.slice(1);
              const beforeTokenWeights = range(beforeTokens.length).map((i) => ({
                token: beforeTokens[i],
                weight: beforeWeights[i],
              }));

              await pool.removeToken(owner, tokenToRemove);

              const { tokens: afterTokensWithBpt } = await pool.getTokens();
              const afterWeights = await pool.getNormalizedWeights();

              // The first token is BPT which doesn't have a weight so we drop it.
              const afterTokens = afterTokensWithBpt.slice(1);
              const afterTokenWeights = range(afterTokens.length).map((i) => ({
                token: afterTokens[i],
                weight: afterWeights[i],
              }));

              // In this test, we make no assumptions about the internal behavior of the pool and simply check the
              // observable state: the weights should roughly add up to fp(1), and their old ratios should remain

              expect(afterTokenWeights.reduce((sum, tokenData) => sum.add(tokenData.weight), bn(0))).to.equalWithError(
                fp(1),
                0.000001
              );

              afterTokenWeights.forEach((someToken) => {
                afterTokenWeights
                  .filter((tk) => tk.token !== someToken.token)
                  .forEach((otherToken) => {
                    const someTokenBeforeIndex = beforeTokens.indexOf(someToken.token);
                    const otherTokenBeforeIndex = beforeTokens.indexOf(otherToken.token);

                    const afterWeightRatio = fpDiv(someToken.weight, otherToken.weight);
                    const beforeWeightRatio = fpDiv(
                      beforeTokenWeights[someTokenBeforeIndex].weight,
                      beforeTokenWeights[otherTokenBeforeIndex].weight
                    );

                    expect(afterWeightRatio).to.equalWithError(beforeWeightRatio, 0.000001);
                  });
              });
            });

            it('emits an event', async () => {
              const tx = await pool.removeToken(owner, tokenToRemove);

              expectEvent.inReceipt(await tx.wait(), 'TokenRemoved', {
                token: tokenToRemove.address,
              });
            });

            context('with a zero burn amount', () => {
              it('burns no BPT from the sender', async () => {
                const balanceBefore = await pool.balanceOf(lp);
                await pool.removeToken(owner, tokenToRemove, lp.address, 0);
                const balanceAfter = await pool.balanceOf(lp);

                expect(balanceAfter).to.equal(balanceBefore);
              });
            });

            context('with a non-zero burn amount', () => {
              it('burns BPT from the sender', async () => {
                const bptBalanceBefore = await pool.balanceOf(lp.address);

                const burnAmount = fp(17);
                await pool.removeToken(owner, tokenToRemove, lp.address, burnAmount);

                const bptBalanceAfter = await pool.balanceOf(lp.address);

                expect(bptBalanceBefore.sub(bptBalanceAfter)).to.equal(burnAmount);
              });

              it('reverts if burning from the zero address', async () => {
                await expect(pool.removeToken(owner, tokenToRemove, ZERO_ADDRESS, 1)).to.be.revertedWith(
                  'BURN_FROM_ZERO'
                );
              });
            });

            it('collects aum fees', async () => {
              const tx = await pool.removeToken(owner, tokenToRemove);

              expectTransferEvent(await tx.wait(), { from: ZERO_ADDRESS, to: await pool.getOwner() }, pool);
              expectTransferEvent(
                await tx.wait(),
                { from: ZERO_ADDRESS, to: (await vault.getFeesCollector()).address },
                pool
              );

              const [, lastAumFeeCollectionTimestamp] = await pool.getManagementAumFeeParams();
              expect(lastAumFeeCollectionTimestamp).to.equal(await currentTimestamp());
            });
          }
        });
      });
    }
  });
});
