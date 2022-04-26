import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, bn, fp, FP_SCALING_FACTOR, fromFp, pct } from '@balancer-labs/v2-helpers/src/numbers';
import { MINUTE, DAY, currentTimestamp, WEEK, advanceToTimestamp, SECOND } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { ManagedPoolEncoder, toNormalizedWeights } from '@balancer-labs/balancer-js';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';
import { SwapKind } from '@balancer-labs/balancer-js';

import { random, range } from 'lodash';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describe('ManagedPool', function () {
  let allTokens: TokenList;
  let poolTokens: TokenList;
  let tooManyWeights: BigNumber[];
  let admin: SignerWithAddress, owner: SignerWithAddress, other: SignerWithAddress;
  let pool: WeightedPool;

  before('setup signers', async () => {
    [, admin, owner, other] = await ethers.getSigners();
  });

  const MAX_TOKENS = 50;
  const TOKEN_COUNT = 20;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const POOL_MANAGEMENT_SWAP_FEE_PERCENTAGE = fp(0.7);
  const POOL_MANAGEMENT_AUM_FEE_PERCENTAGE = fp(0.01);
  const NEW_MANAGEMENT_SWAP_FEE_PERCENTAGE = fp(0.8);

  const WEIGHTS = range(10000, 10000 + MAX_TOKENS); // These will be normalized to weights that are close to each other, but different

  const poolWeights: BigNumber[] = Array(TOKEN_COUNT).fill(fp(1 / TOKEN_COUNT));
  const initialBalances = Array(TOKEN_COUNT).fill(fp(1000));
  let sender: SignerWithAddress;

  sharedBeforeEach('deploy tokens', async () => {
    allTokens = await TokenList.create(MAX_TOKENS + 1, { sorted: true, varyDecimals: true });
    tooManyWeights = Array(allTokens.length).fill(fp(0.01));
    poolTokens = allTokens.subset(20);
    await poolTokens.mint({ to: [other], amount: fp(2000) });
  });

  function itComputesWeightsAndScalingFactors(weightSum = 1): void {
    describe('weights and scaling factors', () => {
      for (const numTokens of range(2, MAX_TOKENS + 1)) {
        context(`with ${numTokens} tokens and a totalWeight of ${weightSum}`, () => {
          let tokens: TokenList;

          sharedBeforeEach('deploy pool', async () => {
            tokens = allTokens.subset(numTokens);

            pool = await WeightedPool.create({
              poolType: WeightedPoolType.MANAGED_POOL,
              tokens,
              weights: WEIGHTS.slice(0, numTokens),
              swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
              managementSwapFeePercentage: POOL_MANAGEMENT_SWAP_FEE_PERCENTAGE,
              managementAumFeePercentage: POOL_MANAGEMENT_AUM_FEE_PERCENTAGE,
            });
          });

          it('has the correct total weight', async () => {
            expect(await pool.instance.getDenormalizedWeightSum()).to.equal(fp(weightSum));
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
  }

  itComputesWeightsAndScalingFactors();

  context('with invalid creation parameters', () => {
    it('fails with < 2 tokens', async () => {
      const params = {
        tokens: allTokens.subset(1),
        weights: [fp(0.3)],
        poolType: WeightedPoolType.MANAGED_POOL,
      };
      await expect(WeightedPool.create(params)).to.be.revertedWith('MIN_TOKENS');
    });

    it('fails with > MAX_TOKENS tokens', async () => {
      const params = {
        tokens: allTokens,
        weights: tooManyWeights,
        poolType: WeightedPoolType.MANAGED_POOL,
      };
      await expect(WeightedPool.create(params)).to.be.revertedWith('MAX_TOKENS');
    });

    it('fails with mismatched tokens/weights', async () => {
      const params = {
        tokens: allTokens.subset(20),
        weights: tooManyWeights,
        poolType: WeightedPoolType.MANAGED_POOL,
      };
      await expect(WeightedPool.create(params)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });
  });

  context('when deployed from factory', () => {
    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        poolType: WeightedPoolType.MANAGED_POOL,
        from: owner,
        fromFactory: true,
      };
      pool = await WeightedPool.create(params);
    });

    it('has zero asset managers', async () => {
      await poolTokens.asyncEach(async (token) => {
        const info = await pool.getTokenInfo(token);
        expect(info.assetManager).to.eq(ZERO_ADDRESS);
      });
    });
  });

  describe('when initialized with an LP allowlist', () => {
    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        poolType: WeightedPoolType.MANAGED_POOL,
        swapEnabledOnStart: true,
        mustAllowlistLPs: true,
        owner: owner.address,
      };
      pool = await WeightedPool.create(params);
    });

    it('shows mustAllowlistLPs on and active', async () => {
      expect(await pool.getMustAllowlistLPs()).to.be.true;
      expect(await pool.isAllowedAddress(owner.address)).to.be.false;
      expect(await pool.isAllowedAddress(other.address)).to.be.false;
    });

    context('when an address is added to the allowlist', () => {
      sharedBeforeEach('add address to allowlist', async () => {
        const receipt = await pool.addAllowedAddress(owner, other.address);

        expectEvent.inReceipt(await receipt.wait(), 'AllowlistAddressAdded', {
          member: other.address,
        });

        await pool.init({ from: other, initialBalances });
      });

      it('the LP address is on the list', async () => {
        expect(await pool.isAllowedAddress(other.address)).to.be.true;
        expect(await pool.isAllowedAddress(owner.address)).to.be.false;
      });

      it('an address cannot be added twice', async () => {
        await expect(pool.addAllowedAddress(owner, other.address)).to.be.revertedWith('ADDRESS_ALREADY_ALLOWLISTED');
      });

      it('the listed LP can join', async () => {
        const startingBpt = await pool.balanceOf(other);

        const { amountsIn } = await pool.joinAllGivenOut({ from: other, bptOut: startingBpt });

        expect(amountsIn).to.deep.equal(initialBalances);
      });

      it('addresses not on the list cannot join', async () => {
        const startingBpt = await pool.balanceOf(owner);

        await expect(pool.joinAllGivenOut({ from: owner, bptOut: startingBpt })).to.be.revertedWith(
          'ADDRESS_NOT_ALLOWLISTED'
        );
      });

      it('retains the allowlist when turned off and back on', async () => {
        // Initial state: allowlist is on, and the owner is not on it
        expect(await pool.isAllowedAddress(owner.address)).to.be.false;

        // Open up for public LPs
        await pool.setMustAllowlistLPs(owner, false);
        // Owner is now allowed
        expect(await pool.isAllowedAddress(owner.address)).to.be.true;

        // Turn the allowlist back on
        await pool.setMustAllowlistLPs(owner, true);

        // Owner is not allowed again
        expect(await pool.isAllowedAddress(owner.address)).to.be.false;
        // Other is still on the allowlist from before
        expect(await pool.isAllowedAddress(other.address)).to.be.true;
      });

      context('when an address is removed', () => {
        sharedBeforeEach('remove address from allowlist', async () => {
          const receipt = await pool.removeAllowedAddress(owner, other.address);

          expectEvent.inReceipt(await receipt.wait(), 'AllowlistAddressRemoved', {
            member: other.address,
          });
        });

        it('the LP address is no longer on the list', async () => {
          expect(await pool.isAllowedAddress(other.address)).to.be.false;
          expect(await pool.isAllowedAddress(owner.address)).to.be.false;
        });

        it('reverts when removing an address not on the list', async () => {
          await expect(pool.removeAllowedAddress(owner, other.address)).to.be.revertedWith('ADDRESS_NOT_ALLOWLISTED');
        });
      });
    });

    context('when mustAllowlistLPs is toggled', () => {
      sharedBeforeEach('initialize pool', async () => {
        await pool.init({ from: owner, initialBalances });
      });

      it('allowlist is initially on', async () => {
        const startingBpt = await pool.balanceOf(owner);

        expect(await pool.getMustAllowlistLPs()).to.be.true;
        await expect(pool.joinAllGivenOut({ from: owner, bptOut: startingBpt })).to.be.revertedWith(
          'ADDRESS_NOT_ALLOWLISTED'
        );
      });

      it('allows owner to turn it off (open to public LPs)', async () => {
        const startingBpt = await pool.balanceOf(owner);

        const receipt = await pool.setMustAllowlistLPs(owner, false);
        expectEvent.inReceipt(await receipt.wait(), 'MustAllowlistLPsSet', {
          mustAllowlistLPs: false,
        });

        // Should be turned off
        expect(await pool.getMustAllowlistLPs()).to.be.false;

        // And allow joins from anywhere
        await expect(pool.joinAllGivenOut({ from: other, bptOut: startingBpt })).to.not.be.reverted;

        // Does not allow adding addresses now
        await expect(pool.addAllowedAddress(owner, other.address)).to.be.revertedWith('UNAUTHORIZED_OPERATION');
        await expect(pool.removeAllowedAddress(owner, other.address)).to.be.revertedWith('ADDRESS_NOT_ALLOWLISTED');
      });

      it('reverts if non-owner tries to enable public LPs', async () => {
        await expect(pool.setMustAllowlistLPs(other, false)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });

  describe('with valid creation parameters', () => {
    context('when initialized with swaps disabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          owner: owner.address,
          poolType: WeightedPoolType.MANAGED_POOL,
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
          poolType: WeightedPoolType.MANAGED_POOL,
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

      it('stores the initial weights as a zero duration weight change', async () => {
        const { startTime, endTime, endWeights } = await pool.getGradualWeightUpdateParams();

        expect(startTime).to.equal(endTime);
        expect(endWeights).to.equalWithError(pool.normalizedWeights, 0.0001);
      });

      it('reverts if swap hook caller is not the vault', async () => {
        await expect(
          pool.instance.onSwap(
            {
              kind: SwapKind.GivenIn,
              tokenIn: poolTokens.first.address,
              tokenOut: poolTokens.second.address,
              amount: 0,
              poolId: await pool.getPoolId(),
              lastChangeBlock: 0,
              from: other.address,
              to: other.address,
              userData: '0x',
            },
            0,
            0
          )
        ).to.be.revertedWith('CALLER_NOT_VAULT');
      });
    });
  });

  describe('permissioned actions', () => {
    describe('enable/disable swaps', () => {
      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          owner: owner.address,
          poolType: WeightedPoolType.MANAGED_POOL,
          swapEnabledOnStart: true,
        };
        pool = await WeightedPool.create(params);
      });

      context('when the sender is not the owner', () => {
        it('non-owners cannot disable swaps', async () => {
          await expect(pool.setSwapEnabled(other, false)).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });

      context('when the sender is the owner', () => {
        beforeEach('set sender to owner', () => {
          sender = owner;
        });

        sharedBeforeEach('initialize pool', async () => {
          await pool.init({ from: sender, initialBalances });
        });

        it('cannot add to the allowlist when it is not enabled', async () => {
          await expect(pool.addAllowedAddress(sender, other.address)).to.be.revertedWith('UNAUTHORIZED_OPERATION');
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

        context('with swaps disabled', () => {
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

    describe('update weights gradually', () => {
      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          owner: owner.address,
          poolType: WeightedPoolType.MANAGED_POOL,
          swapEnabledOnStart: true,
        };
        pool = await WeightedPool.create(params);
      });

      const UPDATE_DURATION = DAY * 2;

      context('when the sender is not the owner', () => {
        it('non-owners cannot update weights', async () => {
          const now = await currentTimestamp();

          await expect(pool.updateWeightsGradually(other, now, now, poolWeights)).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });
      });

      context('when the sender is the owner', () => {
        beforeEach('set sender to owner', () => {
          sender = owner;
        });

        sharedBeforeEach('initialize pool', async () => {
          await pool.init({ from: sender, initialBalances });
        });

        context('with invalid parameters', () => {
          let now: BigNumber;

          sharedBeforeEach(async () => {
            now = await currentTimestamp();
          });

          it('fails if end weights are mismatched (too few)', async () => {
            await expect(pool.updateWeightsGradually(sender, now, now, WEIGHTS.slice(0, 1))).to.be.revertedWith(
              'INPUT_LENGTH_MISMATCH'
            );
          });

          it('fails if the end weights are mismatched (too many)', async () => {
            await expect(pool.updateWeightsGradually(sender, now, now, [...WEIGHTS, fp(0.5)])).to.be.revertedWith(
              'INPUT_LENGTH_MISMATCH'
            );
          });

          it('fails with an end weight below the minimum', async () => {
            const badWeights = [...poolWeights];
            badWeights[2] = fp(0.005);

            await expect(
              pool.updateWeightsGradually(sender, now.add(100), now.add(WEEK), badWeights)
            ).to.be.revertedWith('MIN_WEIGHT');
          });

          it('fails with invalid normalized end weights', async () => {
            const badWeights = Array(poolWeights.length).fill(fp(0.6));

            await expect(
              pool.updateWeightsGradually(sender, now.add(100), now.add(WEEK), badWeights)
            ).to.be.revertedWith('NORMALIZED_WEIGHT_INVARIANT');
          });
        });

        context('with valid parameters (ongoing weight update)', () => {
          const endWeights = poolWeights.map((weight, i) => (i % 2 == 0 ? weight.add(fp(0.02)) : weight.sub(fp(0.02))));

          let now, startTime: BigNumber, endTime: BigNumber;
          const START_DELAY = MINUTE * 10;

          sharedBeforeEach('updateWeightsGradually', async () => {
            now = await currentTimestamp();
            startTime = now.add(START_DELAY);
            endTime = startTime.add(UPDATE_DURATION);

            await pool.updateWeightsGradually(owner, startTime, endTime, endWeights);
          });

          it('updating weights emits an event', async () => {
            const receipt = await pool.updateWeightsGradually(owner, startTime, endTime, endWeights);

            expectEvent.inReceipt(await receipt.wait(), 'GradualWeightUpdateScheduled', {
              startTime: startTime,
              endTime: endTime,
              // weights don't exactly match because of the compression
            });
          });

          it('stores the params', async () => {
            const updateParams = await pool.getGradualWeightUpdateParams();

            expect(updateParams.startTime).to.equalWithError(startTime, 0.001);
            expect(updateParams.endTime).to.equalWithError(endTime, 0.001);
            expect(updateParams.endWeights).to.equalWithError(endWeights, 0.001);
          });
        });
      });
    });
  });

  describe('remove token', () => {
    let vault: Vault;

    // We are going to create a pool with more tokens than we need, and then remove some of them for each scenario.
    // This is not the same as creating pools with fewer tokens, as removing tokens shifts the weights and makes them
    // be denormalized internally (which we want to have happen in order to test).
    let originalTokens: TokenList;
    let poolTokens: TokenList;

    sharedBeforeEach('deploy Vault', async () => {
      vault = await Vault.create({ admin });
    });

    sharedBeforeEach('deploy pool', async () => {
      const TOTAL_TOKENS = 5;
      originalTokens = allTokens.subset(TOTAL_TOKENS);

      const params = {
        tokens: originalTokens,
        weights: range(TOTAL_TOKENS).map(() => fp(random(50))), // The deployer will normalize these
        owner: owner.address,
        poolType: WeightedPoolType.MANAGED_POOL,
        swapEnabledOnStart: true,
        vault,
      };

      pool = await WeightedPool.create(params);

      await originalTokens.mint({ to: owner, amount: fp(100) });
      await originalTokens.approve({ from: owner, to: await pool.getVault() });
      await pool.init({ from: owner, initialBalances: range(originalTokens.length).map(() => fp(random(100))) });
    });

    function removeTokensDownTo(finalAmount: number) {
      sharedBeforeEach(`removing down to ${finalAmount} tokens`, async () => {
        const toRemove = originalTokens.length - finalAmount;
        for (let i = 0; i < toRemove; ++i) {
          const { tokens } = await pool.getTokens();
          await pool.removeToken(owner, tokens[tokens.length - 1], other.address);
        }

        poolTokens = originalTokens.subset(finalAmount);
      });
    }

    context('on a pool with two tokens', () => {
      removeTokensDownTo(2);

      it('reverts', async () => {
        await expect(pool.removeToken(owner, poolTokens.addresses[0], other.address)).to.be.revertedWith('MIN_TOKENS');
      });
    });

    itRevomesTokensCorrectly(3);
    itRevomesTokensCorrectly(4);

    function itRevomesTokensCorrectly(totalTokens: number) {
      context(`on a pool with ${totalTokens} tokens`, () => {
        removeTokensDownTo(totalTokens);

        context('when the sender is not the owner', () => {
          beforeEach('set sender to other', () => {
            sender = other;
          });

          it('non-owners cannot remove tokens', async () => {
            await expect(pool.removeToken(sender, poolTokens.addresses[0], other.address)).to.be.revertedWith(
              'SENDER_NOT_ALLOWED'
            );
          });
        });

        context('when the sender is the owner', () => {
          beforeEach('set sender to owner', () => {
            sender = owner;
          });

          it('reverts if the exit type is used on a regular vault exit', async () => {
            await expect(
              vault.instance.connect(owner).exitPool(await pool.getPoolId(), owner.address, other.address, {
                assets: poolTokens.addresses,
                minAmountsOut: new Array(poolTokens.length).fill(bn(0)),
                userData: ManagedPoolEncoder.exitForRemoveToken(0),
                toInternalBalance: false,
              })
            ).to.be.revertedWith('UNAUTHORIZED_EXIT');
          });

          it('reverts if the token is not in the pool', async () => {
            await expect(pool.removeToken(sender, ZERO_ADDRESS, other.address)).to.be.revertedWith('INVALID_TOKEN');
          });
          context('when the pool is paused', () => {
            sharedBeforeEach('pause pool', async () => {
              await vault.authorizer
                ?.connect(admin)
                .grantPermissions([await actionId(pool.instance, 'setPaused')], other.address, [pool.address]);
              await pool.instance.connect(other).setPaused(true);
            });

            it('reverts', async () => {
              await expect(pool.removeToken(sender, poolTokens.addresses[0], other.address)).to.be.revertedWith(
                'PAUSED'
              );
            });
          });

          context('with a scheduled weight change', () => {
            let startTime: BigNumber, endTime: BigNumber;

            sharedBeforeEach('schedule weight change', async () => {
              const weights = await pool.getNormalizedWeights();

              startTime = (await currentTimestamp()).add(DAY);
              endTime = startTime.add(DAY * 3);

              // We need to renormalize the weights as the pool returns weights that are not exactly normalized
              await pool.updateWeightsGradually(sender, startTime, endTime, toNormalizedWeights(weights));
            });

            it('reverts', async () => {
              await expect(pool.removeToken(sender, poolTokens.addresses[0], other.address)).to.be.revertedWith(
                'CHANGE_TOKENS_PENDING_WEIGHT_CHANGE'
              );
            });

            context('with an ongoing weight change', () => {
              sharedBeforeEach(async () => {
                await advanceToTimestamp(startTime.add(SECOND));
              });

              it('reverts', async () => {
                await expect(pool.removeToken(sender, poolTokens.addresses[0], other.address)).to.be.revertedWith(
                  'CHANGE_TOKENS_DURING_WEIGHT_CHANGE'
                );
              });
            });

            context('after a weight change', () => {
              sharedBeforeEach(async () => {
                await advanceToTimestamp(endTime.add(SECOND));
              });

              itRemovesAnyToken();

              function itRemovesAnyToken() {
                for (let i = 0; i < 3; i++) {
                  describe(`remove token ${i}`, () => {
                    context('with swaps enabled', () => {
                      sharedBeforeEach('enable swaps', async () => {
                        await pool.setSwapEnabled(sender, true);
                      });

                      itRemovesToken(i);
                    });

                    context('with swaps disabled', () => {
                      sharedBeforeEach('disable swaps', async () => {
                        await pool.setSwapEnabled(sender, false);
                      });

                      itRemovesToken(i);
                    });
                  });
                }

                function itRemovesToken(tokenIndex: number) {
                  it(`removes the token with index ${tokenIndex}`, async () => {
                    await pool.removeToken(sender, poolTokens.addresses[tokenIndex], other.address);

                    const { tokens: afterRemoveTokens } = await pool.getTokens();
                    expect(afterRemoveTokens.length).to.equal(poolTokens.length - 1);

                    // We need to sort when comparing as the order may have changed
                    expect([...afterRemoveTokens].sort()).to.deep.equal(
                      poolTokens.addresses.filter((_, i) => i != tokenIndex).sort()
                    );
                  });

                  it(`sends the entire token balance to the recipient`, async () => {
                    const { balances: beforeRemoveBalances } = await pool.getTokens();

                    const tokenSymbol = poolTokens.get(tokenIndex).symbol;
                    await expectBalanceChange(
                      () => pool.removeToken(sender, poolTokens.addresses[tokenIndex], other.address),
                      poolTokens,
                      [
                        {
                          account: other,
                          changes: { [tokenSymbol]: beforeRemoveBalances[tokenIndex] },
                        },
                        {
                          account: vault.address,
                          changes: { [tokenSymbol]: beforeRemoveBalances[tokenIndex].mul(-1) },
                        },
                      ]
                    );
                  });

                  it(`leaves all other balances unchanged`, async () => {
                    const { tokens: beforeRemoveTokens, balances: beforeRemoveBalances } = await pool.getTokens();

                    await pool.removeToken(sender, poolTokens.addresses[tokenIndex], other.address);

                    const { tokens: afterRemoveTokens, balances: afterRemoveBalances } = await pool.getTokens();

                    afterRemoveTokens.forEach((token, index) => {
                      const oldIndex = beforeRemoveTokens.indexOf(token);
                      expect(afterRemoveBalances[index]).to.equal(beforeRemoveBalances[oldIndex]);
                    });
                  });

                  it('scales weights of all other tokens', async () => {
                    const { tokens: beforeTokens } = await pool.getTokens();
                    const beforeWeights = await pool.getNormalizedWeights();

                    const beforeTokenWeights = range(beforeTokens.length).map((i) => ({
                      token: beforeTokens[i],
                      weight: beforeWeights[i],
                    }));

                    await pool.removeToken(sender, poolTokens.addresses[tokenIndex], other.address);

                    const { tokens: afterTokens } = await pool.getTokens();
                    const afterWeights = await pool.getNormalizedWeights();

                    const afterTokenWeights = range(afterTokens.length).map((i) => ({
                      token: afterTokens[i],
                      weight: afterWeights[i],
                    }));

                    // In this test, we make no assumptions about the internal behavior of the pool and simply check the
                    // observable state: the weights should roughly add up to fp(1), and their old ratios should remain

                    expect(
                      afterTokenWeights.reduce((sum, tokenData) => sum.add(tokenData.weight), bn(0))
                    ).to.equalWithError(fp(1), 0.000001);

                    afterTokenWeights.forEach((someToken) => {
                      afterTokenWeights
                        .filter((tk) => tk.token !== someToken.token)
                        .forEach((otherToken) => {
                          const someTokenBeforeIndex = beforeTokens.indexOf(someToken.token);
                          const otherTokenBeforeIndex = beforeTokens.indexOf(otherToken.token);

                          const afterWeightRatio = someToken.weight.mul(FP_SCALING_FACTOR).div(otherToken.weight);
                          const beforeWeightRatio = beforeTokenWeights[someTokenBeforeIndex].weight
                            .mul(FP_SCALING_FACTOR)
                            .div(beforeTokenWeights[otherTokenBeforeIndex].weight);

                          expect(afterWeightRatio).to.equalWithError(beforeWeightRatio, 0.000001);
                        });
                    });
                  });

                  it('updates the denormalized sum correctly', async () => {
                    const beforeWeights = await pool.getNormalizedWeights();
                    const beforeSum = await pool.instance.getDenormalizedWeightSum();

                    const expectedDenormWeightSum = beforeWeights
                      .filter((_, i) => i !== tokenIndex)
                      .reduce((sum, weight) => sum.add(weight.mul(beforeSum).div(FP_SCALING_FACTOR)), bn(0));

                    await pool.removeToken(sender, poolTokens.addresses[tokenIndex], other.address);

                    expect(await pool.instance.getDenormalizedWeightSum()).to.equalWithError(
                      expectedDenormWeightSum,
                      0.000001
                    );
                  });

                  it('emits an event', async () => {
                    const { balances: beforeRemoveBalances } = await pool.getTokens();

                    const tx = await pool.removeToken(sender, poolTokens.addresses[tokenIndex], other.address);

                    expectEvent.inReceipt(await tx.wait(), 'TokenRemoved', {
                      token: poolTokens.addresses[tokenIndex],
                      tokenAmountOut: beforeRemoveBalances[tokenIndex],
                    });
                  });

                  it('returns the amount of tokens removed', async () => {
                    const { balances: beforeRemoveBalances } = await pool.getTokens();

                    const amount = await pool.instance
                      .connect(sender)
                      .callStatic.removeToken(poolTokens.addresses[tokenIndex], other.address, 0, 0);

                    expect(amount).to.equal(beforeRemoveBalances[tokenIndex]);
                  });

                  context('with a non-zero burn amount', () => {
                    it('burns BPT from the caller', async () => {
                      const bptBalanceBefore = await pool.balanceOf(sender.address);

                      const burnAmount = fp(17);
                      await pool.removeToken(sender, poolTokens.addresses[tokenIndex], other.address, { burnAmount });

                      const bptBalanceAfter = await pool.balanceOf(sender.address);

                      expect(bptBalanceBefore.sub(bptBalanceAfter)).to.equal(burnAmount);
                    });
                  });

                  it('reverts if the minimum amount out is larger than the balance', async () => {
                    const { balances: beforeRemoveBalances } = await pool.getTokens();

                    await expect(
                      pool.removeToken(sender, poolTokens.addresses[tokenIndex], other.address, {
                        minAmountOut: beforeRemoveBalances[tokenIndex].add(1),
                      })
                    ).to.be.revertedWith('EXIT_BELOW_MIN');
                  });
                }
              }
            });
          });
        });
      });
    }
  });

  describe('BPT protocol fees', () => {
    let protocolFeesCollector: Contract;
    let vault: Vault;
    const swapFeePercentage = fp(0.02);
    const protocolFeePercentage = fp(0.5); // 50 %
    const managementSwapFeePercentage = fp(0); // Set to zero to isolate BPT fees
    const tokenAmount = 100;
    const poolWeights = [fp(0.8), fp(0.2)];
    let bptFeeBalance: BigNumber;
    let mockMath: Contract;

    let twoTokens: TokenList;
    let localBalances: Array<BigNumber>;
    let swapAmount: BigNumber;

    sharedBeforeEach('deploy pool', async () => {
      vault = await Vault.create({ admin });
      await vault.setSwapFeePercentage(protocolFeePercentage, { from: admin });
      protocolFeesCollector = await vault.getFeesCollector();

      twoTokens = poolTokens.subset(2);
      localBalances = [
        bn(tokenAmount * 10 ** twoTokens.first.decimals),
        bn(tokenAmount * 10 ** twoTokens.second.decimals),
      ];

      // 10% of the initial balance
      swapAmount = localBalances[0].div(10);

      // Make a 2-token pool for this purpose
      const params = {
        tokens: twoTokens,
        weights: poolWeights,
        owner: owner.address,
        poolType: WeightedPoolType.MANAGED_POOL,
        swapEnabledOnStart: true,
        vault,
        swapFeePercentage,
        managementSwapFeePercentage,
      };
      pool = await WeightedPool.create(params);
      mockMath = await deploy('MockWeightedMath');
    });

    sharedBeforeEach('initialize pool', async () => {
      await poolTokens.mint({ to: owner, amount: fp(10000) });
      await poolTokens.approve({ from: owner, to: await pool.getVault() });
      await pool.init({ from: owner, initialBalances: localBalances });
    });

    it('protocol fees are initially zero', async () => {
      bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

      expect(bptFeeBalance).to.equal(0);
    });

    describe('pays protocol fees on swaps', () => {
      let upscaledBalances: Array<BigNumber>;
      let upscaledSwapAmount: BigNumber;

      sharedBeforeEach('upscale balances and amounts', async () => {
        const scaleFactor0 = bn(10 ** (18 - twoTokens.first.decimals));
        const scaleFactor1 = bn(10 ** (18 - twoTokens.second.decimals));
        upscaledBalances = [localBalances[0].mul(scaleFactor0), localBalances[1].mul(scaleFactor1)];
        upscaledSwapAmount = swapAmount.mul(scaleFactor0);
      });

      it('charges the expected protocol fee', async () => {
        const actualProtocolFee = await protocolFeesCollector.getSwapFeePercentage();
        expect(actualProtocolFee).to.equal(protocolFeePercentage);
      });

      context('on swap given in', () => {
        it('pays fees on swap given in', async () => {
          const singleSwap = {
            poolId: await pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: poolTokens.first.address,
            assetOut: poolTokens.second.address,
            amount: swapAmount,
            userData: '0x',
          };
          const funds = {
            sender: owner.address,
            fromInternalBalance: false,
            recipient: other.address,
            toInternalBalance: false,
          };
          const limit = 0; // Minimum amount out
          const deadline = MAX_UINT256;

          const prevInvariant = await mockMath.invariant(poolWeights, upscaledBalances);

          const adjustedAmountIn = upscaledSwapAmount.mul(fp(1).sub(swapFeePercentage)).div(fp(1));
          const amountOut = await mockMath.outGivenIn(
            upscaledBalances[0],
            poolWeights[0],
            upscaledBalances[1],
            poolWeights[1],
            adjustedAmountIn
          );

          const postBalances = [upscaledBalances[0].add(upscaledSwapAmount), upscaledBalances[1].sub(amountOut)];
          const postInvariant = await mockMath.invariant(poolWeights, postBalances);
          const totalSupply = await pool.totalSupply();

          const expectedProtocolFees = await mockMath.calculateDueProtocolSwapFeeBPTAmount(
            totalSupply,
            prevInvariant,
            postInvariant,
            protocolFeePercentage
          );

          await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);

          bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

          expect(bptFeeBalance).to.equalWithError(expectedProtocolFees, 0.000001);
        });
      });

      context('on swap given out', () => {
        it('pays fees on swap given out', async () => {
          const singleSwap = {
            poolId: await pool.getPoolId(),
            kind: SwapKind.GivenOut,
            assetIn: poolTokens.second.address,
            assetOut: poolTokens.first.address,
            amount: swapAmount,
            userData: '0x',
          };
          const funds = {
            sender: owner.address,
            fromInternalBalance: false,
            recipient: other.address,
            toInternalBalance: false,
          };
          const limit = MAX_UINT256; // Maximum amount in
          const deadline = MAX_UINT256;

          const prevInvariant = await mockMath.invariant(poolWeights, upscaledBalances);

          const amountIn = await mockMath.inGivenOut(
            upscaledBalances[1],
            poolWeights[1],
            upscaledBalances[0],
            poolWeights[0],
            upscaledSwapAmount
          );

          // Has to be a better way to do this...
          const proportion = fp(1).sub(swapFeePercentage);
          const adjustedAmountIn = fp(fromFp(amountIn).toNumber() / fromFp(proportion).toNumber());

          const postBalances = [upscaledBalances[1].sub(upscaledSwapAmount), upscaledBalances[0].add(adjustedAmountIn)];
          const postInvariant = await mockMath.invariant(poolWeights, postBalances);
          const totalSupply = await pool.totalSupply();

          const expectedProtocolFees = await mockMath.calculateDueProtocolSwapFeeBPTAmount(
            totalSupply,
            prevInvariant,
            postInvariant,
            protocolFeePercentage
          );

          await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);

          bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

          expect(bptFeeBalance).to.equalWithError(expectedProtocolFees, 0.000001);
        });
      });
    });

    describe('does not pay on join/exit', () => {
      context('with balance changes', () => {
        let currentBalances: BigNumber[];
        let bptIn: BigNumber;

        sharedBeforeEach('simulate increased initial balances', async () => {
          // 4/3 of the initial balances
          currentBalances = initialBalances.map((balance) => balance.mul(4).div(3));
          bptIn = (await pool.balanceOf(owner)).div(10);
        });

        it('no protocol fees on join exact tokens in for BPT out', async () => {
          await pool.joinGivenIn({ from: owner, amountsIn: fp(1), currentBalances });
          bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

          expect(bptFeeBalance).to.be.zero;
        });

        it('no protocol fees on exit exact BPT in for one token out', async () => {
          await pool.singleExitGivenIn({
            from: owner,
            bptIn: bptIn,
            token: 0,
            currentBalances,
            protocolFeePercentage,
          });

          bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

          expect(bptFeeBalance).to.be.zero;
        });

        it('no protocol fees on exit exact BPT in for all tokens out', async () => {
          await pool.multiExitGivenIn({
            from: owner,
            bptIn: bptIn,
            currentBalances,
            protocolFeePercentage,
          });

          bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

          expect(bptFeeBalance).to.be.zero;
        });

        it('no protocol fees on exit BPT In for exact tokens out', async () => {
          const { balances } = await pool.getTokens();

          await pool.exitGivenOut({
            from: owner,
            amountsOut: [balances[0].div(5), balances[1].div(5)],
            maximumBptIn: MAX_UINT256,
            protocolFeePercentage,
          });

          bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

          expect(bptFeeBalance).to.be.zero;
        });
      });
    });
  });

  describe('management fees', () => {
    let vault: Vault;
    const swapFeePercentage = fp(0.02);
    const managementSwapFeePercentage = fp(0.8);
    const managementAumFeePercentage = fp(0.01);

    sharedBeforeEach('deploy pool', async () => {
      vault = await Vault.create();

      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        owner: owner.address,
        poolType: WeightedPoolType.MANAGED_POOL,
        swapEnabledOnStart: true,
        vault,
        swapFeePercentage,
        managementSwapFeePercentage,
        managementAumFeePercentage,
      };
      pool = await WeightedPool.create(params);
    });

    describe('set management fee', () => {
      context('when the sender is not the owner', () => {
        it('non-owners cannot set the management fee', async () => {
          await expect(
            pool.setManagementSwapFeePercentage(other, NEW_MANAGEMENT_SWAP_FEE_PERCENTAGE)
          ).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });
      context('when the sender is the owner', () => {
        it('the management fee can be set', async () => {
          await pool.setManagementSwapFeePercentage(owner, NEW_MANAGEMENT_SWAP_FEE_PERCENTAGE);
          expect(await pool.getManagementSwapFeePercentage()).to.equal(NEW_MANAGEMENT_SWAP_FEE_PERCENTAGE);
        });

        it('setting the management fee emits an event', async () => {
          const receipt = await pool.setManagementSwapFeePercentage(owner, NEW_MANAGEMENT_SWAP_FEE_PERCENTAGE);

          expectEvent.inReceipt(await receipt.wait(), 'ManagementSwapFeePercentageChanged', {
            managementSwapFeePercentage: NEW_MANAGEMENT_SWAP_FEE_PERCENTAGE,
          });

          it('cannot be set above the maximum AUM fee', async () => {
            await expect(pool.setManagementAumFeePercentage(owner, fp(0.2))).to.be.revertedWith(
              'MAX_MANAGEMENT_AUM_FEE_PERCENTAGE'
            );
          });
        });
      });
    });

    describe('management aum fee collection', () => {
      function expectedAUMFees(
        totalSupply: BigNumberish,
        aumFeePercentage: BigNumberish,
        timeElapsed: BigNumberish
      ): BigNumber {
        return bn(totalSupply)
          .mul(timeElapsed)
          .div(365 * DAY)
          .mul(aumFeePercentage)
          .div(fp(1).sub(aumFeePercentage));
      }

      function itCollectsNoAUMFees(collectAUMFees: () => Promise<ContractReceipt>) {
        it('collects no AUM fees', async () => {
          const balanceBefore = await pool.balanceOf(owner);

          const receipt = await collectAUMFees();

          const balanceAfter = await pool.balanceOf(owner);
          expect(balanceAfter).to.equal(balanceBefore);

          expectEvent.notEmitted(receipt, 'ManagementAumFeeCollected');
        });
      }

      function itCollectsAUMFeesCorrectly(collectAUMFees: () => Promise<ContractReceipt>, timeElapsed: BigNumberish) {
        it('collects the expected amount of fees', async () => {
          const balanceBefore = await pool.balanceOf(owner);

          const totalSupply = await pool.totalSupply();
          const expectedManagementFeeBpt = expectedAUMFees(totalSupply, managementAumFeePercentage, timeElapsed);

          const receipt = await collectAUMFees();

          const balanceAfter = await pool.balanceOf(owner);
          const actualManagementFeeBpt = balanceAfter.sub(balanceBefore);
          expect(actualManagementFeeBpt).to.equalWithError(expectedManagementFeeBpt, 0.0001);

          expectEvent.inIndirectReceipt(receipt, pool.instance.interface, 'ManagementAumFeeCollected', {
            bptAmount: actualManagementFeeBpt,
          });
        });
      }

      sharedBeforeEach('mint tokens', async () => {
        await poolTokens.mint({ to: other, amount: fp(10000) });
        await poolTokens.approve({ from: other, to: await pool.getVault() });
      });

      context('manual claiming of AUM fees', () => {
        context('when the pool is uninitialized', () => {
          it('reverts', async () => {
            await expect(pool.collectAumManagementFees(owner)).to.be.revertedWith('UNINITIALIZED');
          });
        });

        context('when the pool is initialized', () => {
          const timeElapsed = 10 * DAY;

          sharedBeforeEach('initialize pool and advance time', async () => {
            await pool.init({ from: other, initialBalances });

            await advanceTime(timeElapsed);
          });

          context('on the first attempt to collect fees', () => {
            itCollectsNoAUMFees(async () => {
              const tx = await pool.collectAumManagementFees(owner);
              return tx.wait();
            });
          });

          context('on subsequent attempts to collect fees', () => {
            sharedBeforeEach('advance time', async () => {
              // AUM fees only accrue after the first collection so we have to wait for more time to elapse.
              await pool.collectAumManagementFees(owner);
              await advanceTime(timeElapsed);
            });

            itCollectsAUMFeesCorrectly(async () => {
              const tx = await pool.collectAumManagementFees(owner);
              return tx.wait();
            }, timeElapsed);

            context('when the pool is paused', () => {
              sharedBeforeEach('pause pool', async () => {
                await pool.pause();
              });

              itCollectsNoAUMFees(async () => {
                const tx = await pool.collectAumManagementFees(owner);
                return tx.wait();
              });

              context('when the pool is then unpaused', () => {
                sharedBeforeEach('collect fees and unpause pool', async () => {
                  // Trigger a collection of the management fees, this will collect no fees but will update the
                  // timestamp of the last collection. This avoids the pool overcharging AUM fees after the unpause.
                  // Note that if nobody interacts with the pool before it is unpaused then AUM fees will be charged
                  // as if the pool were never paused, however this is unlikely to occur.
                  await pool.collectAumManagementFees(owner);

                  await pool.setPaused(false);

                  // We now advance time so that we can test that the collected fees correspond to `timeElapsed`,
                  // rather than `2 * timeElapsed` as we'd expect if the pool didn't correctly update while paused.
                  await advanceTime(timeElapsed);
                });

                itCollectsAUMFeesCorrectly(async () => {
                  const tx = await pool.collectAumManagementFees(owner);
                  return tx.wait();
                }, timeElapsed);
              });
            });
          });
        });
      });

      context('on pool joins', () => {
        context('on pool initialization', () => {
          itCollectsNoAUMFees(async () => {
            const { receipt } = await pool.init({ from: other, recipient: other, initialBalances });
            return receipt;
          });
        });

        context('after pool initialization', () => {
          const timeElapsed = 10 * DAY;

          sharedBeforeEach('initialize pool and advance time', async () => {
            await pool.init({ from: other, initialBalances });
            // AUM fees only accrue after the first collection attempt so we attempt to collect fees here.
            await pool.collectAumManagementFees(owner);

            await advanceTime(timeElapsed);
          });

          sharedBeforeEach('mint tokens', async () => {
            await poolTokens.mint({ to: other, amount: fp(10000) });
            await poolTokens.approve({ from: other, to: await pool.getVault() });
          });

          itCollectsAUMFeesCorrectly(async () => {
            const amountsIn = initialBalances.map((x) => x.div(2));
            const { receipt } = await pool.joinGivenIn({ from: other, amountsIn });
            return receipt;
          }, timeElapsed);

          context('when the pool is paused and then then unpaused', () => {
            sharedBeforeEach('pause pool, collect fees and unpause pool', async () => {
              await pool.pause();

              // Trigger a collection of the management fees, this will collect no fees but will update the
              // timestamp of the last collection. This avoids the pool overcharging AUM fees after the unpause.
              // Note that if nobody interacts with the pool before it is unpaused then AUM fees will be charged
              // as if the pool were never paused, however this is unlikely to occur.
              await pool.collectAumManagementFees(owner);

              await pool.setPaused(false);

              // We now advance time so that we can test that the collected fees correspond to `timeElapsed`,
              // rather than `2 * timeElapsed` as we'd expect if the pool didn't correctly update while paused.
              await advanceTime(timeElapsed);
            });

            itCollectsAUMFeesCorrectly(async () => {
              const amountsIn = initialBalances.map((x) => x.div(2));
              const { receipt } = await pool.joinGivenIn({ from: other, amountsIn });
              return receipt;
            }, timeElapsed);
          });
        });
      });

      context('on pool exits', () => {
        const timeElapsed = 10 * DAY;

        sharedBeforeEach('initialize pool and advance time', async () => {
          await pool.init({ from: other, initialBalances });
          // AUM fees only accrue after the first collection attempt so we attempt to collect fees here.
          await pool.collectAumManagementFees(owner);

          await advanceTime(timeElapsed);
        });

        itCollectsAUMFeesCorrectly(async () => {
          const { receipt } = await pool.multiExitGivenIn({ from: other, bptIn: await pool.balanceOf(other) });
          return receipt;
        }, timeElapsed);

        context('when the pool is paused', () => {
          sharedBeforeEach('pause pool', async () => {
            await pool.pause();
          });

          itCollectsNoAUMFees(async () => {
            const { receipt } = await pool.multiExitGivenIn({ from: other, bptIn: await pool.balanceOf(other) });
            return receipt;
          });

          context('when the pool is then unpaused', () => {
            sharedBeforeEach('collect fees and unpause pool', async () => {
              // Trigger a collection of the management fees, this will collect no fees but will update the
              // timestamp of the last collection. This avoids the pool overcharging AUM fees after the unpause.
              // Note that if nobody interacts with the pool before it is unpaused then AUM fees will be charged
              // as if the pool were never paused, however this is unlikely to occur.
              await pool.collectAumManagementFees(owner);

              await pool.setPaused(false);

              // We now advance time so that we can test that the collected fees correspond to `timeElapsed`,
              // rather than `2 * timeElapsed` as we'd expect if the pool didn't correctly update while paused.
              await advanceTime(timeElapsed);
            });

            itCollectsAUMFeesCorrectly(async () => {
              const { receipt } = await pool.multiExitGivenIn({ from: other, bptIn: await pool.balanceOf(other) });
              return receipt;
            }, timeElapsed);
          });
        });
      });
    });
  });
});
