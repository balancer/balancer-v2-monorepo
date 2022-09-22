import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import {
  MONTH,
  WEEK,
  DAY,
  MINUTE,
  advanceTime,
  advanceToTimestamp,
  currentTimestamp,
  receiptTimestamp,
} from '@balancer-labs/v2-helpers/src/time';
import { BigNumberish, bn, FP_100_PCT, FP_ZERO, fp, fpMul } from '@balancer-labs/v2-helpers/src/numbers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { toNormalizedWeights } from '@balancer-labs/balancer-js';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokensDeployer from '@balancer-labs/v2-helpers/src/models/tokens/TokensDeployer';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import { range } from 'lodash';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';
import { Interface } from 'ethers/lib/utils';

describe('ManagedPoolSettings', function () {
  let allTokens: TokenList;
  let poolTokens: TokenList;
  let tooManyWeights: BigNumber[];
  let admin: SignerWithAddress, owner: SignerWithAddress, other: SignerWithAddress;
  let pool: WeightedPool;
  let authorizer: Contract;
  let vault: Vault;

  before('setup signers', async () => {
    [, admin, owner, other] = await ethers.getSigners();
  });

  const MAX_TOKENS = 38;
  const TOKEN_COUNT = 20;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.05);
  const POOL_MANAGEMENT_SWAP_FEE_PERCENTAGE = fp(0.7);
  const POOL_MANAGEMENT_AUM_FEE_PERCENTAGE = fp(0.01);

  const DELEGATE_OWNER = '0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B';

  const WEIGHTS = range(10000, 10000 + MAX_TOKENS); // These will be normalized to weights that are close to each other, but different

  const poolWeights: BigNumber[] = Array(TOKEN_COUNT).fill(fp(1 / TOKEN_COUNT));
  const initialBalances = Array(TOKEN_COUNT).fill(fp(1000));
  let sender: SignerWithAddress;

  sharedBeforeEach('deploy tokens and AUMProtocolFeeCollector', async () => {
    allTokens = await TokenList.create(MAX_TOKENS + 1, { sorted: true, varyDecimals: true });
    tooManyWeights = Array(allTokens.length).fill(fp(0.01));
    poolTokens = allTokens.subset(20);
    await allTokens.mint({ to: [other, owner], amount: fp(2000) });

    vault = await Vault.create({ admin });
    await allTokens.approve({ from: other, to: vault });
    await allTokens.approve({ from: owner, to: vault });
  });

  describe('constructor', () => {
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

    describe('with valid creation parameters', () => {
      function itComputesWeightsAndScalingFactors(numTokens: number): void {
        context(`with ${numTokens} tokens`, () => {
          describe('weights and scaling factors', () => {
            let tokens: TokenList;
            let poolWeights: number[];
            let assetManagers: string[];

            sharedBeforeEach('deploy pool', async () => {
              tokens = allTokens.subset(numTokens);
              poolWeights = WEIGHTS.slice(0, numTokens);
              assetManagers = await Promise.all(
                range(numTokens).map(async () => await ethers.Wallet.createRandom().getAddress())
              );

              pool = await WeightedPool.create({
                poolType: WeightedPoolType.MANAGED_POOL,
                tokens,
                weights: poolWeights,
                assetManagers,
                vault,
                swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
                managementSwapFeePercentage: POOL_MANAGEMENT_SWAP_FEE_PERCENTAGE,
                managementAumFeePercentage: POOL_MANAGEMENT_AUM_FEE_PERCENTAGE,
              });
            });

            it('sets token weights', async () => {
              const expectedNormalizedWeights = toNormalizedWeights(poolWeights.map(bn));
              const actualNormalizedWeights = await pool.getNormalizedWeights();

              for (let i = 0; i < numTokens; i++) {
                expectEqualWithError(actualNormalizedWeights[i], expectedNormalizedWeights[i], 0.0000001);
              }

              const { startTime, endTime, startWeights, endWeights } = await pool.getGradualWeightUpdateParams();

              expect(startTime).to.equal(endTime);
              expect(startWeights).to.equalWithError(expectedNormalizedWeights, 0.0001);
              expect(endWeights).to.equalWithError(expectedNormalizedWeights, 0.0001);
            });

            it('sets scaling factors', async () => {
              const poolScalingFactors = await pool.getScalingFactors();
              const tokenScalingFactors = tokens.map((token) => fp(10 ** (18 - token.decimals)));

              expect(poolScalingFactors).to.deep.equal(tokenScalingFactors);
            });

            it('sets asset managers', async () => {
              await tokens.asyncEach(async (token, i) => {
                const info = await pool.getTokenInfo(token);
                expect(info.assetManager).to.eq(assetManagers[i]);
              });
            });
          });
        });
      }

      for (const numTokens of [2, 3, 17, 32, MAX_TOKENS]) {
        itComputesWeightsAndScalingFactors(numTokens);
      }

      context('swapsEnabled', () => {
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
        });

        context('when initialized with swaps enabled', () => {
          sharedBeforeEach('deploy pool', async () => {
            const params = {
              tokens: poolTokens,
              weights: poolWeights,
              vault,
              poolType: WeightedPoolType.MANAGED_POOL,
              swapEnabledOnStart: true,
            };
            pool = await WeightedPool.create(params);
          });

          it('swaps show enabled on start', async () => {
            expect(await pool.instance.getSwapEnabled()).to.be.true;
          });
        });
      });

      context('mustAllowlistLPs', () => {
        context('when initialized with allowlist disabled', () => {
          sharedBeforeEach('deploy pool', async () => {
            const params = {
              tokens: poolTokens,
              weights: poolWeights,
              owner: owner.address,
              poolType: WeightedPoolType.MANAGED_POOL,
              mustAllowlistLPs: false,
            };
            pool = await WeightedPool.create(params);
          });

          it('getMustAllowlistLPs() returns false', async () => {
            expect(await pool.instance.getMustAllowlistLPs()).to.be.false;
          });
        });

        context('when initialized with allowlist enabled', () => {
          sharedBeforeEach('deploy pool', async () => {
            const params = {
              tokens: poolTokens,
              weights: poolWeights,
              vault,
              poolType: WeightedPoolType.MANAGED_POOL,
              mustAllowlistLPs: true,
            };
            pool = await WeightedPool.create(params);
          });

          it('getMustAllowlistLPs() returns true', async () => {
            expect(await pool.instance.getMustAllowlistLPs()).to.be.true;
          });
        });
      });
    });
  });

  context('LP allowlist', () => {
    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        poolType: WeightedPoolType.MANAGED_POOL,
        vault,
        swapEnabledOnStart: true,
        mustAllowlistLPs: true,
        owner: owner.address,
      };
      pool = await WeightedPool.create(params);
    });

    context('when allowlist is active', () => {
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

        it('retains the allowlist when turned off and back on', async () => {
          // Initial state: allowlist is on, and the owner is not on it
          expect(await pool.isAllowedAddress(owner.address)).to.be.false;

          // Open up for public LPs
          await pool.setMustAllowlistLPs(owner, false);

          // Owner is now allowed
          expect(await pool.isAllowedAddress(owner.address)).to.be.true;
          expect(await pool.isAllowedAddress(other.address)).to.be.true;

          // Cannot remove addresses when the allowlist is disabled
          await expect(pool.removeAllowedAddress(owner, other.address)).to.be.revertedWith('FEATURE_DISABLED');

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
    });

    context('when mustAllowlistLPs is toggled', () => {
      it('allows owner to turn it off (open to public LPs)', async () => {
        const receipt = await pool.setMustAllowlistLPs(owner, false);
        expectEvent.inReceipt(await receipt.wait(), 'MustAllowlistLPsSet', {
          mustAllowlistLPs: false,
        });

        // Should be turned off
        expect(await pool.getMustAllowlistLPs()).to.be.false;

        // Does not allow adding or removing addresses now
        await expect(pool.addAllowedAddress(owner, other.address)).to.be.revertedWith('FEATURE_DISABLED');
        await expect(pool.removeAllowedAddress(owner, other.address)).to.be.revertedWith('FEATURE_DISABLED');
      });

      it('reverts if non-owner tries to enable public LPs', async () => {
        await expect(pool.setMustAllowlistLPs(other, false)).to.be.revertedWith('SENDER_NOT_ALLOWED');
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
          vault,
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
          await expect(pool.addAllowedAddress(sender, other.address)).to.be.revertedWith('FEATURE_DISABLED');
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
      });
    });

    describe('update weights gradually', () => {
      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          vault,
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
          await pool.init({ from: other, initialBalances });
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
          let startWeights: BigNumber[];
          const endWeights = poolWeights.map((weight, i) => (i % 2 == 0 ? weight.add(fp(0.02)) : weight.sub(fp(0.02))));

          let now, startTime: BigNumber, endTime: BigNumber;
          const START_DELAY = MINUTE * 10;

          sharedBeforeEach('updateWeightsGradually', async () => {
            now = await currentTimestamp();
            startTime = now.add(START_DELAY);
            endTime = startTime.add(UPDATE_DURATION);
            startWeights = await pool.getNormalizedWeights();

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
            expect(updateParams.startWeights).to.equalWithError(startWeights, 0.001);
            expect(updateParams.endWeights).to.equalWithError(endWeights, 0.001);
          });
        });
      });
    });
  });

  describe('update swap fee', () => {
    const MAX_SWAP_FEE_PERCENTAGE = fp(0.8);

    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        owner: owner.address,
        swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
        poolType: WeightedPoolType.MANAGED_POOL,
        swapEnabledOnStart: true,
      };
      pool = await WeightedPool.create(params);
      await pool.init({ from: owner, initialBalances });
    });

    /* Test that would cause joinSwap to fail at 100% fee, if allowed:

    context('with a 100% swap fee', () => {
      sharedBeforeEach('set swap fee to 100%', async () => {
        await pool.setSwapFeePercentage(owner, fp(1));
      });

      it('reverts on joinSwap', async () => {
        await expect(pool.joinGivenOut({ recipient: owner, bptOut: fp(1), token: 0 })).to.be.revertedWith('ZERO_DIVISION');
      });
    });*/

    context('with the max swap fee', () => {
      sharedBeforeEach('set swap fee to the max value (< 100%)', async () => {
        await pool.setSwapFeePercentage(owner, MAX_SWAP_FEE_PERCENTAGE);
      });

      it('allows (unfavorable) joinSwap', async () => {
        await expect(pool.joinGivenOut({ recipient: owner, bptOut: fp(1), token: 0 })).to.not.be.reverted;
      });
    });

    context('when there is an ongoing gradual change', () => {
      let now, startTime: BigNumber, endTime: BigNumber;
      const START_DELAY = MINUTE * 10;
      const UPDATE_DURATION = DAY * 2;
      const NEW_SWAP_FEE = fp(0.1);

      sharedBeforeEach('start gradual swap fee update', async () => {
        now = await currentTimestamp();
        startTime = now.add(START_DELAY);
        endTime = startTime.add(UPDATE_DURATION);

        await pool.updateSwapFeeGradually(owner, startTime, endTime, POOL_SWAP_FEE_PERCENTAGE, NEW_SWAP_FEE);
      });

      it('fails when gradual change is set to start in the future', async () => {
        await expect(pool.setSwapFeePercentage(owner, NEW_SWAP_FEE)).to.be.revertedWith(
          'SET_SWAP_FEE_PENDING_FEE_CHANGE'
        );
      });

      it('fails when gradual change is in progress', async () => {
        advanceToTimestamp(startTime.add(1));
        await expect(pool.setSwapFeePercentage(owner, NEW_SWAP_FEE)).to.be.revertedWith(
          'SET_SWAP_FEE_DURING_FEE_CHANGE'
        );
      });
    });
  });

  describe('update swap fee gradually', () => {
    let caller: SignerWithAddress;

    let libInterface: Interface;

    let startTime: BigNumber, endTime: BigNumber;
    const START_DELAY = MINUTE * 10;
    const UPDATE_DURATION = DAY * 2;
    const START_SWAP_FEE = fp(0.5);
    const END_SWAP_FEE = fp(0.01);

    sharedBeforeEach(async () => {
      libInterface = new Interface((await getArtifact('ManagedPoolSwapFeesLib')).abi);

      const now = await currentTimestamp();
      startTime = now.add(START_DELAY);
      endTime = startTime.add(UPDATE_DURATION);
    });

    function itReverts() {
      it('reverts', async () => {
        await expect(
          pool.updateSwapFeeGradually(caller, startTime, endTime, START_SWAP_FEE, END_SWAP_FEE)
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    }

    function itStartsAGradualFeeChange() {
      it('begins a gradual swap fee update', async () => {
        const receipt = await pool.updateSwapFeeGradually(caller, startTime, endTime, START_SWAP_FEE, END_SWAP_FEE);

        expectEvent.inIndirectReceipt(await receipt.wait(), libInterface, 'GradualSwapFeeUpdateScheduled', {
          startTime: startTime,
          endTime: endTime,
          startSwapFeePercentage: START_SWAP_FEE,
          endSwapFeePercentage: END_SWAP_FEE,
        });
      });
    }

    context('with an owner', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await WeightedPool.create({
          vault,
          tokens: poolTokens,
          owner: owner.address,
          poolType: WeightedPoolType.MANAGED_POOL,
        });
      });

      context('when the sender is allowed', () => {
        sharedBeforeEach(() => {
          caller = owner;
        });

        itStartsAGradualFeeChange();
      });

      context('when the sender is not allowed', () => {
        sharedBeforeEach(() => {
          caller = other;
        });

        itReverts();
      });
    });

    context('with a delegated owner', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await WeightedPool.create({
          vault,
          tokens: poolTokens,
          owner: DELEGATE_OWNER,
          poolType: WeightedPoolType.MANAGED_POOL,
        });
        caller = other;
      });

      context('when the sender is allowed', () => {
        sharedBeforeEach('grant permissions', async () => {
          const updateSwapFeeGraduallyPermission = await actionId(pool.instance, 'updateSwapFeeGradually');
          await pool.vault.grantPermissionsGlobally([updateSwapFeeGraduallyPermission], other);
        });

        itStartsAGradualFeeChange();
      });

      context('when the sender is not allowed', () => {
        itReverts();
      });
    });
  });

  describe('recovery mode', () => {
    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        owner: owner.address,
        poolType: WeightedPoolType.MANAGED_POOL,
        swapEnabledOnStart: true,
        vault,
      };
      pool = await WeightedPool.create(params);
      await pool.init({ from: other, initialBalances });

      await pool.collectAumManagementFees(owner);
    });

    context('when leaving recovery mode', () => {
      it('sets the lastAumFeeCollectionTimestamp to the current timestamp', async () => {
        const lastAUMCollectionTimestamp = await pool.instance.getLastAumFeeCollectionTimestamp();
        // Set recovery mode to stop AUM fee calculations.
        await pool.enableRecoveryMode();

        // Advance time so that AUM fees would otherwise be accrued.
        await advanceTime(365 * DAY);

        expect(await pool.instance.getLastAumFeeCollectionTimestamp()).to.be.eq(lastAUMCollectionTimestamp);

        // On disabling recovery mode we expect the `_lastAumFeeCollectionTimestamp` to be be equal to the current time.
        const tx = await pool.disableRecoveryMode();
        const expectedLastAUMCollectionTimestamp = await receiptTimestamp(tx.wait());
        const updatedLastAUMCollectionTimestamp = await pool.instance.getLastAumFeeCollectionTimestamp();
        expect(updatedLastAUMCollectionTimestamp).to.be.eq(expectedLastAUMCollectionTimestamp);
      });
    });
  });

  describe('management fees', () => {
    const swapFeePercentage = fp(0.02);
    const managementSwapFeePercentage = fp(0.8);
    const managementAumFeePercentage = fp(0.01);

    let assetManager: Contract;

    sharedBeforeEach('deploy pool', async () => {
      assetManager = await deploy('MockWithdrawDepositAssetManager', { args: [vault.address] });
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        assetManagers: poolTokens.map(() => assetManager.address),
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

      function itReverts(collectAUMFees: () => Promise<ContractReceipt>) {
        it('reverts', async () => {
          await expect(collectAUMFees()).to.be.revertedWith('PAUSED');
        });
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

      function itCollectsAUMFeesForExpectedDuration(
        collectAUMFees: () => Promise<ContractReceipt>,
        timeElapsed: BigNumberish
      ) {
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

      function itCollectsAUMFeesCorrectly(collectAUMFees: () => Promise<ContractReceipt>) {
        const timeElapsed = 10 * DAY;

        sharedBeforeEach('advance time', async () => {
          await advanceTime(timeElapsed);
        });

        itCollectsAUMFeesForExpectedDuration(collectAUMFees, timeElapsed);

        context('when the pool is paused and enters into recovery mode', () => {
          sharedBeforeEach('pause pool and enter recovery mode', async () => {
            await pool.pause();
            await pool.enableRecoveryMode();
          });

          itReverts(collectAUMFees);

          context('when the pool is then unpaused and removed from recovery mode', () => {
            sharedBeforeEach('unpause pool and exit recovery mode', async () => {
              // Exiting recovery mode will update the timestamp of the last collection.
              // This avoids the pool overcharging AUM fees after the unpause.
              await pool.unpause();
              await pool.disableRecoveryMode();

              // We now advance time so that we can test that the collected fees correspond to `timeElapsed`,
              // rather than `2 * timeElapsed` as we'd expect if the pool didn't correctly update while paused.
              await advanceTime(timeElapsed);
            });

            itCollectsAUMFeesForExpectedDuration(collectAUMFees, timeElapsed);
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
          sharedBeforeEach('initialize pool', async () => {
            await pool.init({ from: other, initialBalances });
          });

          itCollectsAUMFeesCorrectly(async () => {
            const tx = await pool.collectAumManagementFees(owner);
            return tx.wait();
          });
        });
      });

      context('on token addition', () => {
        context('after pool initialization', () => {
          sharedBeforeEach('initialize pool', async () => {
            await pool.init({ from: other, initialBalances });
          });

          itCollectsAUMFeesCorrectly(async () => {
            const token = await Token.create('NEW');
            const tx = await pool.addToken(owner, token, ZERO_ADDRESS, fp(0.02));
            return tx.wait();
          });
        });
      });

      context('on token removal', () => {
        context('after pool initialization', () => {
          sharedBeforeEach('initialize pool', async () => {
            await pool.init({ from: other, initialBalances });
          });

          itCollectsAUMFeesCorrectly(async () => {
            const { tokens, balances } = await pool.getTokens();
            const tokenToBeRemoved = tokens[tokens.length - 1];
            const tokenBalance = balances[tokens.length - 1];

            // Before we can remove the token from the pool we have to drain its balance from the Vault.
            await assetManager.withdrawFromPool(pool.poolId, tokenToBeRemoved, tokenBalance);

            const tx = await pool.removeToken(owner, tokenToBeRemoved, other.address);
            return tx.wait();
          });
        });
      });

      context('on updating the protocol fee cache', () => {
        context('when the pool is uninitialized', () => {
          itCollectsNoAUMFees(async () => {
            const tx = await pool.updateProtocolFeePercentageCache();
            return tx.wait();
          });
        });

        context('when the pool is initialized', () => {
          sharedBeforeEach('initialize pool', async () => {
            await pool.init({ from: other, initialBalances });
          });

          itCollectsAUMFeesCorrectly(async () => {
            const tx = await pool.updateProtocolFeePercentageCache();
            return tx.wait();
          });
        });
      });
    });
  });

  describe('non-zero AUM protocol fees', () => {
    let authorizedVault: Contract;
    let protocolFeesProvider: Contract;
    let vault: Vault;

    const AUM_PROTOCOL_FEE_PERCENTAGE = fp(0.1);
    const swapFeePercentage = fp(0.02);
    const managementSwapFeePercentage = fp(0.8);
    const managementAumFeePercentage = fp(0.1);
    const maxYieldValue = fp(1);
    const maxAUMValue = fp(1);

    sharedBeforeEach('deploy and set protocol AUM fee', async () => {
      const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

      authorizer = await deploy('v2-vault/TimelockAuthorizer', { args: [admin.address, ZERO_ADDRESS, MONTH] });
      authorizedVault = await deploy('v2-vault/Vault', { args: [authorizer.address, WETH.address, MONTH, MONTH] });
      protocolFeesProvider = await deploy('v2-standalone-utils/ProtocolFeePercentagesProvider', {
        args: [authorizedVault.address, maxYieldValue, maxAUMValue],
      });

      const action = await actionId(protocolFeesProvider, 'setFeeTypePercentage');
      await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);
      await protocolFeesProvider.connect(admin).setFeeTypePercentage(ProtocolFee.AUM, AUM_PROTOCOL_FEE_PERCENTAGE);
    });

    sharedBeforeEach('deploy and initialize pool', async () => {
      // protocolFeesProvider unused for now
      vault = new Vault(false, authorizedVault, authorizer, protocolFeesProvider, admin);

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

      await poolTokens.mint({ to: owner, amount: fp(100) });
      await poolTokens.approve({ from: owner, to: await pool.getVault() });
      await pool.init({ from: owner, initialBalances });

      // Clock no longer starts at initialization
      // Now we have to do a join to start the clock
      await expect(pool.joinAllGivenOut({ from: owner, bptOut: FP_ZERO }));
    });

    it('accounts for the protocol portion of the AUM fee', async () => {
      const protocolFeesCollector = await vault.getFeesCollector();

      const totalSupply = await pool.totalSupply();
      const expectedBpt = totalSupply
        .mul(180)
        .div(365)
        .mul(managementAumFeePercentage)
        .div(FP_100_PCT.sub(managementAumFeePercentage));

      const balanceBefore = await pool.balanceOf(owner);

      const protocolPortion = fpMul(expectedBpt, AUM_PROTOCOL_FEE_PERCENTAGE);
      const ownerPortion = expectedBpt.sub(protocolPortion);

      await advanceTime(180 * DAY);

      const receipt = await pool.collectAumManagementFees(owner);
      expectEvent.inReceipt(await receipt.wait(), 'ManagementAumFeeCollected');

      const balanceAfter = await pool.balanceOf(owner);
      expect(balanceAfter.sub(balanceBefore)).to.equalWithError(ownerPortion, 0.0001);

      // Fee collector should have its balance
      const protocolFees = await pool.balanceOf(protocolFeesCollector.address);
      expect(protocolFees).to.equalWithError(protocolPortion, 0.00001);
    });
  });
});
