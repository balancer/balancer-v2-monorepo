import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { bn, fp, pct } from '@balancer-labs/v2-helpers/src/numbers';
import { MINUTE, DAY, advanceTime, currentTimestamp, WEEK } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { ManagedPoolEncoder, SwapKind } from '@balancer-labs/balancer-js';

import { range } from 'lodash';

describe('ManagedPool', function () {
  let allTokens: TokenList;
  let poolTokens: TokenList;
  let tooManyWeights: BigNumber[];
  let owner: SignerWithAddress, other: SignerWithAddress;
  let pool: WeightedPool;

  before('setup signers', async () => {
    [, owner, other] = await ethers.getSigners();
  });

  const MAX_TOKENS = 50;
  const TOKEN_COUNT = 20;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const POOL_MANAGEMENT_SWAP_FEE_PERCENTAGE = fp(0.7);
  const NEW_MANAGEMENT_SWAP_FEE_PERCENTAGE = fp(0.8);
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
            poolType: WeightedPoolType.MANAGED_POOL,
            tokens,
            weights: WEIGHTS.slice(0, numTokens),
            swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
            managementSwapFeePercentage: POOL_MANAGEMENT_SWAP_FEE_PERCENTAGE,
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

      it('reverts when querying last invariant', async () => {
        await expect(pool.getLastInvariant()).to.be.revertedWith('UNHANDLED_BY_MANAGED_POOL');
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

          it('fails if start time > end time', async () => {
            await expect(pool.updateWeightsGradually(sender, now, now.sub(1), poolWeights)).to.be.revertedWith(
              'GRADUAL_UPDATE_TIME_TRAVEL'
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

          context('with start time in the past', () => {
            let now: BigNumber, startTime: BigNumber, endTime: BigNumber;
            const endWeights = [...poolWeights];

            sharedBeforeEach('updateWeightsGradually (start time in the past)', async () => {
              now = await currentTimestamp();
              // Start an hour in the past
              startTime = now.sub(MINUTE * 60);
              endTime = now.add(UPDATE_DURATION);
            });

            it('fast-forwards start time to present', async () => {
              await pool.updateWeightsGradually(owner, startTime, endTime, endWeights);
              const updateParams = await pool.getGradualWeightUpdateParams();

              // Start time should be fast-forwarded to now
              expect(updateParams.startTime).to.equal(await currentTimestamp());
            });
          });
        });

        context('with valid parameters (ongoing weight update)', () => {
          // startWeights must equal "weights" above - just not using fp to keep math simple
          const startWeights = [...poolWeights];
          const endWeights = [...poolWeights];

          // Now generate endWeights (first weight doesn't change)
          for (let i = 2; i < poolWeights.length; i++) {
            endWeights[i] = 0 == i % 2 ? startWeights[i].add(fp(0.02)) : startWeights[i].sub(fp(0.02));
          }

          function getEndWeights(pct: number): BigNumber[] {
            const intermediateWeights = Array<BigNumber>(poolWeights.length);

            for (let i = 0; i < poolWeights.length; i++) {
              if (startWeights[i] < endWeights[i]) {
                // Weight is increasing
                intermediateWeights[i] = startWeights[i].add(endWeights[i].sub(startWeights[i]).mul(pct).div(100));
              } else {
                // Weight is decreasing (or not changing)
                intermediateWeights[i] = startWeights[i].sub(startWeights[i].sub(endWeights[i]).mul(pct).div(100));
              }
            }

            return intermediateWeights;
          }

          let now, startTime: BigNumber, endTime: BigNumber;
          const START_DELAY = MINUTE * 10;
          const finalEndWeights = getEndWeights(100);

          sharedBeforeEach('updateWeightsGradually', async () => {
            now = await currentTimestamp();
            startTime = now.add(START_DELAY);
            endTime = startTime.add(UPDATE_DURATION);

            await pool.updateWeightsGradually(owner, startTime, endTime, finalEndWeights);
          });

          it('updating weights emits an event', async () => {
            const receipt = await pool.updateWeightsGradually(owner, startTime, endTime, finalEndWeights);

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
            expect(updateParams.endWeights).to.equalWithError(finalEndWeights, 0.001);
          });

          it('gets start weights if called before the start time', async () => {
            const normalizedWeights = await pool.getNormalizedWeights();

            // Need to decrease precision
            expect(normalizedWeights).to.equalWithError(pool.normalizedWeights, 0.0001);
          });

          it('gets end weights if called after the end time', async () => {
            await advanceTime(endTime.add(MINUTE));
            const normalizedWeights = await pool.getNormalizedWeights();

            // Need to decrease precision
            expect(normalizedWeights).to.equalWithError(finalEndWeights, 0.0001);
          });

          for (let pct = 5; pct < 100; pct += 5) {
            it(`gets correct intermediate weights if called ${pct}% through`, async () => {
              await advanceTime(START_DELAY + (UPDATE_DURATION * pct) / 100);
              const normalizedWeights = await pool.getNormalizedWeights();

              // Need to decrease precision
              expect(normalizedWeights).to.equalWithError(getEndWeights(pct), 0.005);
            });
          }
        });
      });
    });

    describe('management fees', () => {
      let vault: Vault;
      const swapFeePercentage = fp(0.02);
      const managementSwapFeePercentage = fp(0.8);

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
        };
        pool = await WeightedPool.create(params);
      });

      sharedBeforeEach('initialize pool', async () => {
        await poolTokens.mint({ to: owner, amount: fp(100) });
        await poolTokens.approve({ from: owner, to: await pool.getVault() });
        await pool.init({ from: owner, initialBalances });
      });

      it('collected fees are initially zero', async () => {
        const fees = await pool.getCollectedManagementFees();

        expect(fees.tokenAddresses).to.deep.equal(poolTokens.addresses);
        expect(fees.amounts).to.deep.equal(new Array(poolTokens.length).fill(bn(0)));
      });

      it('collected fees are reported in the same order as in the vault', async () => {
        const { tokenAddresses: feeTokenAddresses } = await pool.getCollectedManagementFees();
        const { tokens: vaultTokenAddresses } = await vault.getPoolTokens(await pool.getPoolId());

        expect(feeTokenAddresses).to.deep.equal(vaultTokenAddresses);
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

            expectEvent.inReceipt(await receipt.wait(), 'ManagementFeePercentageChanged', {
              managementFeePercentage: NEW_MANAGEMENT_SWAP_FEE_PERCENTAGE,
            });
          });
        });
      });

      describe('fee collection', () => {
        describe('swaps', () => {
          it('collects management fees on swaps given in', async () => {
            const singleSwap = {
              poolId: await pool.getPoolId(),
              kind: SwapKind.GivenIn,
              assetIn: poolTokens.first.address,
              assetOut: poolTokens.second.address,
              amount: fp(0.01),
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

            const expectedSwapFee = singleSwap.amount.mul(swapFeePercentage).div(fp(1));
            const expectedManagementFee = expectedSwapFee.mul(managementSwapFeePercentage).div(fp(1));

            await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);

            const { amounts: actualFees } = await pool.getCollectedManagementFees();
            // The fee was charged in the first token (in)
            expect(actualFees[0]).to.be.equalWithError(expectedManagementFee, 0.001);
            expect(actualFees.filter((_, i) => i != 0)).to.be.zeros;
          });

          it('collects management fees on swaps given out', async () => {
            const singleSwap = {
              poolId: await pool.getPoolId(),
              kind: SwapKind.GivenOut,
              assetIn: poolTokens.second.address,
              assetOut: poolTokens.first.address,
              amount: fp(0.01),
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

            // Since this is a given out swap, we can only estimate the amount out, and then derive expected swap fees from
            // that. This require scaling balances, amounts, and then unscaling the amount in.
            const unscaledBalances = await pool.getBalances();
            const scalingFactors = await pool.getScalingFactors();
            const scaledBalances = unscaledBalances.map((balance, i) => balance.mul(scalingFactors[i]).div(fp(1)));
            const expectedScaledAmountIn = bn(
              await pool.estimateGivenOut(
                { in: 1, out: 0, amount: singleSwap.amount.mul(scalingFactors[0]).div(fp(1)) },
                scaledBalances
              )
            );
            const expectedAmountIn = expectedScaledAmountIn.mul(fp(1)).div(scalingFactors[1]);
            const expectedAmountInPlusSwapFee = expectedAmountIn.mul(fp(1)).div(fp(1).sub(swapFeePercentage));
            const expectedSwapFee = expectedAmountInPlusSwapFee.sub(expectedAmountIn);
            const expectedManagementFee = expectedSwapFee.mul(managementSwapFeePercentage).div(fp(1));

            await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);

            const { amounts: actualFees } = await pool.getCollectedManagementFees();
            // The fee was charged in the second token (in)
            expect(actualFees[1]).to.be.equalWithError(expectedManagementFee, 0.001);
            expect(actualFees.filter((_, i) => i != 1)).to.be.zeros;
          });
        });

        describe('joins', () => {
          it('collects management fees on joinswap given in', async () => {
            const amountsIn = new Array(poolTokens.length).fill(bn(0));
            amountsIn[1] = fp(0.01);
            amountsIn[2] = fp(0.01);

            await pool.joinGivenIn({ from: owner, amountsIn });

            const { amounts: actualFees } = await pool.getCollectedManagementFees();
            // There should be non-zero collected fees on the second and third tokens
            expect(actualFees[1]).to.be.gt(0);
            expect(actualFees[2]).to.be.gt(0);
            expect(actualFees.filter((_, i) => i != 1 && i != 2)).to.be.zeros;
          });

          it('collects management fees on joinswap given out', async () => {
            await pool.joinGivenOut({ from: owner, bptOut: fp(0.5), token: 1 });

            const { amounts: actualFees } = await pool.getCollectedManagementFees();
            // There should be non-zero collected fees on the second token
            expect(actualFees[1]).to.be.gt(0);
            expect(actualFees.filter((_, i) => i != 1)).to.be.zeros;
          });

          it('does not collect management fees on proportional joins', async () => {
            await pool.joinAllGivenOut({ from: owner, bptOut: fp(0.5) });

            const { amounts: actualFees } = await pool.getCollectedManagementFees();
            expect(actualFees).to.be.zeros;
          });
        });

        describe('exits', () => {
          it('collects management fees on exitswap given in', async () => {
            const amountsOut = new Array(poolTokens.length).fill(bn(0));
            amountsOut[1] = fp(0.01);
            amountsOut[2] = fp(0.01);

            await pool.exitGivenOut({ from: owner, amountsOut });

            const { amounts: actualFees } = await pool.getCollectedManagementFees();
            // There should be non-zero collected fees on the second and third tokens
            expect(actualFees[1]).to.be.gt(0);
            expect(actualFees[2]).to.be.gt(0);
            expect(actualFees.filter((_, i) => i != 1 && i != 2)).to.be.zeros;
          });

          it('collects management fees on exitswap given in', async () => {
            await pool.singleExitGivenIn({ from: owner, bptIn: fp(0.1), token: 1 });

            const { amounts: actualFees } = await pool.getCollectedManagementFees();
            // There should be non-zero collected fees on the second token
            expect(actualFees[1]).to.be.gt(0);
            expect(actualFees.filter((_, i) => i != 1)).to.be.zeros;
          });

          it('does not collect management fees on proportional exits', async () => {
            await pool.multiExitGivenIn({ from: owner, bptIn: fp(0.1) });

            const { amounts: actualFees } = await pool.getCollectedManagementFees();
            expect(actualFees).to.be.zeros;
          });
        });

        it('accumulates management fees with existing ones', async () => {
          const singleSwap = {
            poolId: await pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: poolTokens.first.address,
            assetOut: poolTokens.second.address,
            amount: fp(0.01),
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

          const expectedSwapFee = singleSwap.amount.mul(swapFeePercentage).div(fp(1));
          const expectedManagementFee = expectedSwapFee.mul(managementSwapFeePercentage).div(fp(1));

          // The swap fee depends exclusively on the amount in on swaps given in, so we can simply perform the same swap
          // twice and expect to get twice the expected amount of collected fees.

          await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);
          await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);

          const { amounts: actualFees } = await pool.getCollectedManagementFees();
          // The fee was charged in the first token (in)
          expect(actualFees[0]).to.be.equalWithError(expectedManagementFee.mul(2), 0.001);
          expect(actualFees.filter((_, i) => i != 0)).to.be.zeros;
        });
      });

      describe('collection by owner', () => {
        context('when the sender is not the owner', () => {
          it('reverts', async () => {
            await expect(pool.withdrawCollectedManagementFees(other)).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });

        context('when the sender is the owner', () => {
          beforeEach('set sender to owner', () => {
            sender = owner;
          });

          context('with collected fees', () => {
            let feeTokenSymbol: string;
            let managementFeeAmount: BigNumber;

            sharedBeforeEach('cause fees to be collected', async () => {
              const singleSwap = {
                poolId: await pool.getPoolId(),
                kind: SwapKind.GivenIn,
                assetIn: poolTokens.first.address,
                assetOut: poolTokens.second.address,
                amount: fp(0.01),
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

              await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);

              const expectedSwapFee = singleSwap.amount.mul(swapFeePercentage).div(fp(1));
              managementFeeAmount = expectedSwapFee.mul(managementSwapFeePercentage).div(fp(1));
              feeTokenSymbol = pool.tokens.first.symbol; // Fees are collected in the token in
            });

            it('management fees can be collected to any account', async () => {
              await expectBalanceChange(() => pool.withdrawCollectedManagementFees(sender, other), poolTokens, {
                account: other,
                changes: {
                  [feeTokenSymbol]: managementFeeAmount,
                },
              });
            });

            it('collection emits an event', async () => {
              const expectedFees = new Array(poolTokens.length).fill(bn(0));
              expectedFees[poolTokens.findIndexBySymbol(feeTokenSymbol)] = managementFeeAmount;

              const receipt = await (await pool.withdrawCollectedManagementFees(sender, other)).wait();
              expectEvent.inReceipt(receipt, 'ManagementFeesCollected', {
                tokens: poolTokens.addresses,
                amounts: expectedFees,
              });
            });

            it('reverts if the vault is called directly', async () => {
              await expect(
                vault.instance.connect(sender).exitPool(await pool.getPoolId(), sender.address, other.address, {
                  assets: poolTokens.addresses,
                  minAmountsOut: new Array(poolTokens.length).fill(bn(0)),
                  userData: ManagedPoolEncoder.exitForManagementFees(),
                  toInternalBalance: false,
                })
              ).to.be.revertedWith('UNAUTHORIZED_EXIT');
            });

            context('after collection', () => {
              sharedBeforeEach('collect fees', async () => {
                await pool.withdrawCollectedManagementFees(sender, other);
              });

              it('there are no collected fees', async () => {
                const { amounts: fees } = await pool.getCollectedManagementFees();
                expect(fees).to.be.zeros;
              });
            });

            context('while swaps are disabled', () => {
              sharedBeforeEach('disable swaps', async () => {
                await pool.setSwapEnabled(sender, false);
              });

              it('management fees can be collected', async () => {
                await expectBalanceChange(() => pool.withdrawCollectedManagementFees(sender, other), poolTokens, {
                  account: other,
                  changes: {
                    [feeTokenSymbol]: managementFeeAmount,
                  },
                });
              });
            });
          });
        });
      });
    });
  });
});
