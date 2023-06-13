import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { ANY_ADDRESS, DELEGATE_OWNER, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import {
  WEEK,
  DAY,
  MINUTE,
  advanceTime,
  currentTimestamp,
  receiptTimestamp,
  advanceToTimestamp,
} from '@balancer-labs/v2-helpers/src/time';
import {
  BigNumberish,
  bn,
  FP_100_PCT,
  FP_ZERO,
  fp,
  fpMul,
  FP_ONE,
  fpDiv,
  fromFp,
} from '@balancer-labs/v2-helpers/src/numbers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import ManagedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/ManagedPool';
import { CircuitBreakerState, ManagedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { toNormalizedWeights } from '@balancer-labs/balancer-js';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import { range } from 'lodash';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('ManagedPoolSettings', function () {
  let allTokens: TokenList;
  let poolTokens: TokenList;
  let tooManyWeights: BigNumber[];
  let admin: SignerWithAddress, owner: SignerWithAddress, other: SignerWithAddress;
  let pool: ManagedPool;
  let vault: Vault;

  before('setup signers', async () => {
    [, admin, owner, other] = await ethers.getSigners();
  });

  const MAX_TOKENS = 50;
  const TOKEN_COUNT = 20;

  const MIN_SWAP_FEE = fp(0.000001);
  const MAX_SWAP_FEE = fp(0.95);
  const INITIAL_SWAP_FEE = MIN_SWAP_FEE.add(1);

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.05);
  const POOL_MANAGEMENT_AUM_FEE_PERCENTAGE = fp(0.01);

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function createMockPool(params: any): Promise<ManagedPool> {
    const fullParams = {
      ...params,
      swapFeePercentage: INITIAL_SWAP_FEE,
      poolType: ManagedPoolType.MOCK_MANAGED_POOL_SETTINGS,
    };
    return ManagedPool.create(fullParams);
  }

  describe('constructor', () => {
    context('with invalid creation parameters', () => {
      it('fails with < 2 tokens', async () => {
        const params = {
          tokens: allTokens.subset(1),
          weights: [fp(0.3)],
        };
        await expect(createMockPool(params)).to.be.revertedWith('MIN_TOKENS');
      });

      it('fails with > MAX_TOKENS tokens', async () => {
        const params = {
          tokens: allTokens,
          weights: tooManyWeights,
        };
        await expect(createMockPool(params)).to.be.revertedWith('MAX_TOKENS');
      });

      it('fails with mismatched tokens/weights', async () => {
        const params = {
          tokens: allTokens.subset(20),
          weights: tooManyWeights,
        };
        await expect(createMockPool(params)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
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

              pool = await createMockPool({
                tokens,
                weights: poolWeights,
                assetManagers,
                vault,
                swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
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
              expect(startWeights).to.deep.equal(expectedNormalizedWeights);
              expect(endWeights).to.deep.equal(expectedNormalizedWeights);
            });

            it('sets scaling factors', async () => {
              const poolScalingFactors = await pool.getScalingFactors();
              const tokenScalingFactors = tokens.map((token) => fp(10 ** (18 - token.decimals)));

              expect(poolScalingFactors).to.deep.equal(tokenScalingFactors);
            });
          });
        });
      }

      for (const numTokens of [2, 3, 17, 32, 45, MAX_TOKENS]) {
        itComputesWeightsAndScalingFactors(numTokens);
      }

      context('provider fee ID', () => {
        function itStoresProviderFeeIds(aumFeeId: number) {
          context(`when aum fee ID is ${ProtocolFee[aumFeeId]}`, () => {
            sharedBeforeEach('deploy pool', async () => {
              pool = await ManagedPool.create({
                tokens: allTokens.subset(2),
                vault,
                aumFeeId,
                poolType: ManagedPoolType.MOCK_MANAGED_POOL_SETTINGS,
              });
            });

            it('stores provider fee IDs correctly', async () => {
              // Swap and Yield are fixed, Aum is custom.
              expect(await pool.instance.getProviderFeeId(ProtocolFee.SWAP)).to.be.eq(ProtocolFee.SWAP);
              expect(await pool.instance.getProviderFeeId(ProtocolFee.YIELD)).to.be.eq(ProtocolFee.YIELD);
              expect(await pool.instance.getProviderFeeId(ProtocolFee.AUM)).to.be.eq(aumFeeId);
            });
          });
        }

        Object.values(ProtocolFee)
          .filter((v) => !isNaN(Number(v)))
          .forEach((feeId) => {
            itStoresProviderFeeIds(Number(feeId));
          });
      });

      context('swapsEnabled', () => {
        context('when initialized with swaps disabled', () => {
          sharedBeforeEach('deploy pool', async () => {
            const params = {
              tokens: poolTokens,
              weights: poolWeights,
              owner: owner.address,
              swapEnabledOnStart: false,
            };
            pool = await createMockPool(params);
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
              swapEnabledOnStart: true,
            };
            pool = await createMockPool(params);
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
              mustAllowlistLPs: false,
            };
            pool = await createMockPool(params);
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
              mustAllowlistLPs: true,
            };
            pool = await createMockPool(params);
          });

          it('getMustAllowlistLPs() returns true', async () => {
            expect(await pool.instance.getMustAllowlistLPs()).to.be.true;
          });
        });
      });

      context('join / exit enabled by default', () => {
        sharedBeforeEach(async () => {
          pool = await createMockPool({ tokens: poolTokens });
        });

        it('joins and exits show enabled on start', async () => {
          expect(await pool.instance.getJoinExitEnabled()).to.be.true;
        });
      });
    });
  });

  context('LP allowlist', () => {
    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        vault,
        swapEnabledOnStart: true,
        mustAllowlistLPs: true,
        owner: owner.address,
      };
      pool = await createMockPool(params);
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

          // Turn the allowlist back on
          await pool.setMustAllowlistLPs(owner, true);

          // Owner is not allowed again
          expect(await pool.isAllowedAddress(owner.address)).to.be.false;
          // Other is still on the allowlist from before
          expect(await pool.isAllowedAddress(other.address)).to.be.true;
        });

        it('allows checking the allowlist regardless of status', async () => {
          // Initial state: allowlist is on, and the owner is not on it
          expect(await pool.getMustAllowlistLPs()).to.be.true;
          expect(await pool.isAllowedAddress(owner.address)).to.be.false;
          expect(await pool.isAllowedAddress(other.address)).to.be.true;

          // Can still check the raw allowlist, when enabled
          expect(await pool.instance.isAddressOnAllowlist(owner.address)).to.be.false;
          expect(await pool.instance.isAddressOnAllowlist(other.address)).to.be.true;

          // Turn the allowlist off
          await pool.setMustAllowlistLPs(owner, false);
          expect(await pool.isAllowedAddress(owner.address)).to.be.true;
          expect(await pool.isAllowedAddress(ANY_ADDRESS)).to.be.true;

          // Results are the same when disabled
          expect(await pool.instance.isAddressOnAllowlist(owner.address)).to.be.false;
          expect(await pool.instance.isAddressOnAllowlist(other.address)).to.be.true;
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

        // Allows adding or removing addresses now
        await expect(pool.addAllowedAddress(owner, other.address)).to.not.be.reverted;
        await expect(pool.removeAllowedAddress(owner, other.address)).to.not.be.reverted;
      });

      it('reverts if non-owner tries to enable public LPs', async () => {
        await expect(pool.setMustAllowlistLPs(other, false)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });

  describe('permissioned actions', () => {
    describe('enable/disable joins and exits', () => {
      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          owner: owner.address,
          vault,
        };
        pool = await createMockPool(params);
      });

      context('when the sender is not the owner', () => {
        it('non-owners cannot disable joins and exits', async () => {
          await expect(pool.setJoinExitEnabled(other, false)).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });

      context('when the sender is the owner', () => {
        beforeEach('set sender to owner', () => {
          sender = owner;
        });

        sharedBeforeEach('initialize pool', async () => {
          await pool.init({ from: sender, initialBalances });
        });

        it('joins and exits can be enabled and disabled', async () => {
          await pool.setJoinExitEnabled(sender, false);
          expect(await pool.instance.getJoinExitEnabled()).to.be.false;

          await pool.setJoinExitEnabled(sender, true);
          expect(await pool.instance.getJoinExitEnabled()).to.be.true;
        });

        it('disabling joins and exits emits an event', async () => {
          const receipt = await pool.setJoinExitEnabled(sender, false);

          expectEvent.inReceipt(await receipt.wait(), 'JoinExitEnabledSet', {
            joinExitEnabled: false,
          });
        });

        it('enabling joins and exits emits an event', async () => {
          const receipt = await pool.setJoinExitEnabled(sender, true);

          expectEvent.inReceipt(await receipt.wait(), 'JoinExitEnabledSet', {
            joinExitEnabled: true,
          });
        });
      });
    });

    describe('enable/disable swaps', () => {
      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          owner: owner.address,
          vault,
          swapEnabledOnStart: true,
        };
        pool = await createMockPool(params);
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
          swapEnabledOnStart: true,
        };
        pool = await createMockPool(params);
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
          const endWeights = poolWeights.map((weight, i) => (i % 2 == 0 ? weight.add(fp(0.02)) : weight.sub(fp(0.02))));

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

          it('fails with denormalized end weights', async () => {
            // These don't add up to fp(1)
            const badWeights = Array(poolWeights.length).fill(fp(0.6));

            await expect(
              pool.updateWeightsGradually(sender, now.add(100), now.add(WEEK), badWeights)
            ).to.be.revertedWith('NORMALIZED_WEIGHT_INVARIANT');
          });

          it('fails with mismatched token length', async () => {
            const badTokens = [...poolTokens.addresses].concat(ZERO_ADDRESS);

            await expect(
              pool.updateWeightsGradually(sender, now.add(100), now.add(WEEK), endWeights, badTokens)
            ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
          });

          it('fails with mismatched tokens', async () => {
            const badTokens = [...poolTokens.addresses].reverse();

            await expect(
              pool.updateWeightsGradually(sender, now.add(100), now.add(WEEK), endWeights, badTokens)
            ).to.be.revertedWith('TOKENS_MISMATCH');
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

          it('stores the gradual weight update params', async () => {
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

  describe('update swap fee gradually', () => {
    let caller: SignerWithAddress;

    let startTime: BigNumber, endTime: BigNumber;
    const START_DELAY = MINUTE * 10;
    const UPDATE_DURATION = DAY * 2;
    const START_SWAP_FEE = fp(0.5);
    const END_SWAP_FEE = fp(0.01);

    const VALID_SWAP_FEE = MIN_SWAP_FEE.add(MAX_SWAP_FEE).div(2);
    const TOO_LOW_SWAP_FEE = MIN_SWAP_FEE.sub(1);
    const TOO_HIGH_SWAP_FEE = MAX_SWAP_FEE.add(1);

    sharedBeforeEach(async () => {
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
      describe('updateSwapFeeGradually', () => {
        const UPDATE_DURATION = DAY * 2;

        context('with invalid parameters', () => {
          let start: BigNumber;
          let end: BigNumber;

          sharedBeforeEach(async () => {
            const now = await currentTimestamp();
            start = now.add(100);
            end = start.add(WEEK);
          });

          it('cannot set starting swap fee below minimum', async () => {
            await expect(
              pool.updateSwapFeeGradually(caller, start, end, TOO_LOW_SWAP_FEE, VALID_SWAP_FEE)
            ).to.be.revertedWith('MIN_SWAP_FEE_PERCENTAGE');
          });

          it('cannot set starting swap fee above maximum', async () => {
            await expect(
              pool.updateSwapFeeGradually(caller, start, end, TOO_HIGH_SWAP_FEE, VALID_SWAP_FEE)
            ).to.be.revertedWith('MAX_SWAP_FEE_PERCENTAGE');
          });

          it('cannot set ending swap fee below minimum', async () => {
            await expect(
              pool.updateSwapFeeGradually(caller, start, end, VALID_SWAP_FEE, TOO_LOW_SWAP_FEE)
            ).to.be.revertedWith('MIN_SWAP_FEE_PERCENTAGE');
          });

          it('cannot set ending swap fee above maximum', async () => {
            await expect(
              pool.updateSwapFeeGradually(caller, start, end, VALID_SWAP_FEE, TOO_HIGH_SWAP_FEE)
            ).to.be.revertedWith('MAX_SWAP_FEE_PERCENTAGE');
          });

          it('cannot have swap fee change finish before it starts', async () => {
            await expect(
              pool.updateSwapFeeGradually(caller, end, start, VALID_SWAP_FEE, VALID_SWAP_FEE)
            ).to.be.revertedWith('GRADUAL_UPDATE_TIME_TRAVEL');
          });
        });

        function itStartsAGradualWeightChangeCorrectly(startTimeOffset: BigNumberish) {
          let now, startTime: BigNumber, endTime: BigNumber;
          const START_SWAP_FEE = INITIAL_SWAP_FEE;
          const END_SWAP_FEE = VALID_SWAP_FEE;

          sharedBeforeEach('calculate gradual update parameters', async () => {
            now = await currentTimestamp();
            startTime = now.add(startTimeOffset);
            endTime = startTime.add(UPDATE_DURATION);

            // Make sure start <> end (in case it got changed above)
            expect(START_SWAP_FEE).to.not.equal(END_SWAP_FEE);
          });

          it('updates the swap fee parameters', async () => {
            const tx = await pool.updateSwapFeeGradually(caller, startTime, endTime, START_SWAP_FEE, END_SWAP_FEE);

            const updateParams = await pool.getGradualSwapFeeUpdateParams();

            // If the start time has already passed (due to multisig signer wrangling / a tx being slow to confirm),
            // then we bring it forwards to block.timestamp to avoid reverting or causing a discontinuity in swap fees.
            const txTimestamp = bn(await receiptTimestamp(tx.wait()));
            const expectedStartTime = startTime.gt(txTimestamp) ? startTime : txTimestamp;

            expect(updateParams.startTime).to.eq(expectedStartTime);
            expect(updateParams.endTime).to.eq(endTime);
            expect(updateParams.startSwapFeePercentage).to.equal(START_SWAP_FEE);
            expect(updateParams.endSwapFeePercentage).to.equal(END_SWAP_FEE);
          });

          it('emits a GradualSwapFeeUpdateScheduled event', async () => {
            const tx = await pool.updateSwapFeeGradually(caller, startTime, endTime, START_SWAP_FEE, END_SWAP_FEE);
            const receipt = await tx.wait();

            const txTimestamp = bn(await receiptTimestamp(receipt));
            const expectedStartTime = startTime.gt(txTimestamp) ? startTime : txTimestamp;

            expectEvent.inIndirectReceipt(receipt, pool.instance.interface, 'GradualSwapFeeUpdateScheduled', {
              startTime: expectedStartTime,
              endTime: endTime,
              startSwapFeePercentage: START_SWAP_FEE,
              endSwapFeePercentage: END_SWAP_FEE,
            });
          });

          context('when the starting swap fee is different from the current swap fee', () => {
            sharedBeforeEach(async () => {
              await pool.updateSwapFeeGradually(caller, await currentTimestamp(), endTime, MAX_SWAP_FEE, MAX_SWAP_FEE);
              expect(await pool.getSwapFeePercentage()).to.not.equal(START_SWAP_FEE);
            });

            it('instantly sets the swap fee with the starting value', async () => {
              await pool.updateSwapFeeGradually(caller, startTime, endTime, START_SWAP_FEE, END_SWAP_FEE);
              expect(await pool.getSwapFeePercentage()).to.be.equal(START_SWAP_FEE);
            });
          });
        }

        context('when gradual update start time is the future', () => {
          const START_TIME_OFFSET = MINUTE * 10;

          sharedBeforeEach(async () => {
            // Before we schedule the "real" swap fee update we perform another one which ensures that the start and
            // end swap fee percentages held in storage are not equal. This ensures that we're calculating the
            // current swap fee correctly.
            const now = await currentTimestamp();

            await pool.updateSwapFeeGradually(caller, now.add(100), now.add(1000), MIN_SWAP_FEE, MAX_SWAP_FEE);
            await advanceToTimestamp(now.add(10));
          });

          itStartsAGradualWeightChangeCorrectly(START_TIME_OFFSET);
        });

        context('when gradual update start time is in the past', () => {
          const START_TIME_OFFSET = -1 * MINUTE * 10;

          sharedBeforeEach(async () => {
            // Before we schedule the "real" swap fee update we perform another one which ensures that the start and
            // end swap fee percentages held in storage are not equal. This ensures that we're calculating the
            // current swap fee correctly.
            const now = await currentTimestamp();

            await pool.updateSwapFeeGradually(caller, now.add(100), now.add(1000), MIN_SWAP_FEE, MAX_SWAP_FEE);
            await advanceToTimestamp(now.add(10));
          });

          itStartsAGradualWeightChangeCorrectly(START_TIME_OFFSET);
        });
      });

      it('begins a gradual swap fee update', async () => {
        const receipt = await pool.updateSwapFeeGradually(caller, startTime, endTime, START_SWAP_FEE, END_SWAP_FEE);

        expectEvent.inIndirectReceipt(await receipt.wait(), pool.instance.interface, 'GradualSwapFeeUpdateScheduled', {
          startTime: startTime,
          endTime: endTime,
          startSwapFeePercentage: START_SWAP_FEE,
          endSwapFeePercentage: END_SWAP_FEE,
        });
      });
    }

    context('with an owner', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await createMockPool({
          vault,
          tokens: poolTokens,
          owner: owner.address,
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
        pool = await createMockPool({
          vault,
          tokens: poolTokens,
          owner: DELEGATE_OWNER,
        });
        caller = other;
      });

      context('when the sender is allowed', () => {
        sharedBeforeEach('grant permissions', async () => {
          const updateSwapFeeGraduallyPermission = await actionId(pool.instance, 'updateSwapFeeGradually');
          await pool.vault.grantPermissionGlobally(updateSwapFeeGraduallyPermission, other);
        });

        itStartsAGradualFeeChange();
      });

      context('when the sender is not allowed', () => {
        itReverts();
      });
    });

    describe('swap fee validation', () => {
      sharedBeforeEach(async () => {
        pool = await createMockPool({
          vault,
          tokens: poolTokens,
        });
      });

      it('rejects swap fees above maximum', async () => {
        await expect(pool.instance.validateSwapFeePercentage(TOO_HIGH_SWAP_FEE)).to.be.revertedWith(
          'MAX_SWAP_FEE_PERCENTAGE'
        );
      });

      it('rejects swap fee below minimum', async () => {
        await expect(pool.instance.validateSwapFeePercentage(TOO_LOW_SWAP_FEE)).to.be.revertedWith(
          'MIN_SWAP_FEE_PERCENTAGE'
        );
      });

      it('accepts valid swap fees', async () => {
        await expect(pool.instance.validateSwapFeePercentage(VALID_SWAP_FEE)).to.be.not.be.reverted;
      });
    });
  });

  describe('circuit breakers', () => {
    let tokenIndex: number;

    async function getUnscaledBptPrice(tokenIndex: number): Promise<BigNumber> {
      const totalSupply = await pool.getActualSupply();

      return fpDiv(fpMul(totalSupply, poolWeights[tokenIndex]), initialBalances[tokenIndex]);
    }

    async function getScaledBptPrice(tokenIndex: number): Promise<BigNumber> {
      const totalSupply = await pool.getActualSupply();
      const scalingFactors = await pool.getScalingFactors();

      return fpDiv(
        fpMul(totalSupply, poolWeights[tokenIndex]),
        fpMul(initialBalances[tokenIndex], scalingFactors[tokenIndex])
      );
    }

    const randomInt = (max: number) => Math.floor(Math.random() * Math.floor(max));

    describe('setCircuitBreakers', () => {
      const LOWER_BOUND = fp(0.8);
      const UPPER_BOUND = fp(2);
      const MAX_UPPER_BOUND = fp(10);
      let lowerBounds: BigNumber[];
      let upperBounds: BigNumber[];
      let bptPrices: BigNumber[];
      let bptPrice: BigNumber;

      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          vault,
          owner: owner.address,
        };
        pool = await createMockPool(params);
        await pool.init({ from: other, initialBalances });
        tokenIndex = randomInt(poolTokens.length);

        bptPrice = await getUnscaledBptPrice(tokenIndex);

        // For range checks
        lowerBounds = Array(poolTokens.length).fill(LOWER_BOUND);
        upperBounds = Array(poolTokens.length).fill(UPPER_BOUND);
        bptPrices = Array(poolTokens.length).fill(FP_ONE);
      });

      function itReverts() {
        it('reverts', async () => {
          await expect(
            pool.setCircuitBreakers(sender, [poolTokens.first], [bptPrice], [LOWER_BOUND], [UPPER_BOUND])
          ).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      }

      function itSetsTheCircuitBreaker() {
        context('with invalid parameters', () => {
          it('fails if the token is invalid', async () => {
            await expect(
              pool.setCircuitBreakers(sender, [ZERO_ADDRESS], [bptPrice], [LOWER_BOUND], [UPPER_BOUND])
            ).to.be.revertedWith('INVALID_TOKEN');
          });

          it('fails with mismatched upper bounds', async () => {
            await expect(
              pool.setCircuitBreakers(sender, poolTokens.addresses, bptPrices, lowerBounds, [UPPER_BOUND])
            ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
          });

          it('fails with mismatched lower bounds', async () => {
            await expect(
              pool.setCircuitBreakers(sender, poolTokens.addresses, bptPrices, [LOWER_BOUND], upperBounds)
            ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
          });

          it('fails with mismatched BPT prices', async () => {
            await expect(
              pool.setCircuitBreakers(sender, poolTokens.addresses, [bptPrice], lowerBounds, upperBounds)
            ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
          });

          it('fails with a lower bound above the maximum', async () => {
            await expect(
              pool.setCircuitBreakers(sender, [poolTokens.first], [bptPrice], [FP_ONE.add(1)], [UPPER_BOUND])
            ).to.be.revertedWith('INVALID_CIRCUIT_BREAKER_BOUNDS');
          });

          it('fails with a upper bound above the maximum', async () => {
            await expect(
              pool.setCircuitBreakers(sender, [poolTokens.first], [bptPrice], [LOWER_BOUND], [MAX_UPPER_BOUND.add(1)])
            ).to.be.revertedWith('INVALID_CIRCUIT_BREAKER_BOUNDS');
          });

          it('fails with a upper bound below the minimum', async () => {
            await expect(
              pool.setCircuitBreakers(sender, [poolTokens.first], [bptPrice], [LOWER_BOUND], [LOWER_BOUND.sub(1)])
            ).to.be.revertedWith('INVALID_CIRCUIT_BREAKER_BOUNDS');
          });

          it('does not allow setting a breaker on the BPT', async () => {
            await expect(
              pool.setCircuitBreakers(sender, [pool.address], [bptPrice], [LOWER_BOUND], [LOWER_BOUND.sub(1)])
            ).to.be.revertedWith('INVALID_TOKEN');
          });
        });

        context('with valid parameters', () => {
          sharedBeforeEach('set the breaker', async () => {
            await pool.setCircuitBreakers(
              sender,
              [poolTokens.get(tokenIndex)],
              [bptPrice],
              [LOWER_BOUND],
              [UPPER_BOUND]
            );
          });

          it('setting a circuit breaker emits an event', async () => {
            const unscaledBptPrice = await getUnscaledBptPrice(tokenIndex);

            const receipt = await pool.setCircuitBreakers(
              sender,
              [poolTokens.get(tokenIndex)],
              [unscaledBptPrice],
              [LOWER_BOUND],
              [UPPER_BOUND]
            );

            expectEvent.inReceipt(await receipt.wait(), 'CircuitBreakerSet', {
              token: poolTokens.get(tokenIndex).address,
              bptPrice: unscaledBptPrice,
              lowerBoundPercentage: LOWER_BOUND,
              upperBoundPercentage: UPPER_BOUND,
            });
          });

          it('stores the circuit breaker params', async () => {
            const {
              bptPrice: actualBptPrice,
              referenceWeight: actualReferenceWeight,
              lowerBound: actualLowerBound,
              upperBound: actualUpperBound,
            } = await pool.getCircuitBreakerState(poolTokens.get(tokenIndex));
            const expectedWeight = poolWeights[tokenIndex];

            // Don't scale; the getter will return the unscaled value.
            const expectedBptPrice = await getUnscaledBptPrice(tokenIndex);

            expect(actualLowerBound).to.equalWithError(LOWER_BOUND, 0.001);
            expect(actualUpperBound).to.equalWithError(UPPER_BOUND, 0.001);
            expect(actualBptPrice).to.equalWithError(expectedBptPrice, 0.0000001);
            expect(actualReferenceWeight).to.equal(expectedWeight);
          });
        });
      }

      context('with an owner', () => {
        sharedBeforeEach('deploy pool', async () => {
          pool = await createMockPool({
            vault,
            tokens: poolTokens,
            owner: owner.address,
          });
          await pool.init({ from: other, initialBalances });
        });

        context('when the sender is allowed', () => {
          sharedBeforeEach(async () => {
            sender = owner;
          });

          itSetsTheCircuitBreaker();
        });

        context('when the sender is not allowed', () => {
          sharedBeforeEach(async () => {
            sender = other;
          });

          itReverts();
        });
      });

      context('with a delegated owner', () => {
        sharedBeforeEach('deploy pool', async () => {
          pool = await createMockPool({
            vault,
            tokens: poolTokens,
            owner: DELEGATE_OWNER,
          });
          await pool.init({ from: other, initialBalances });
          sender = other;
        });

        context('when the sender is allowed', () => {
          sharedBeforeEach('grant permissions', async () => {
            const setCircuitBreakersPermission = await actionId(pool.instance, 'setCircuitBreakers');
            await pool.vault.grantPermissionGlobally(setCircuitBreakersPermission, other);
          });

          itSetsTheCircuitBreaker();
        });

        context('when the sender is not allowed', () => {
          itReverts();
        });
      });
    });

    context('circuit breaker bounds', () => {
      let unscaledBptPrice: BigNumber;
      let scaledBptPrice: BigNumber;
      let initialWeight: BigNumber;
      let scalingFactor: BigNumber;

      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          vault,
          owner: owner.address,
        };
        pool = await createMockPool(params);
        await pool.init({ from: other, initialBalances });
        tokenIndex = randomInt(poolTokens.length);
        initialWeight = poolWeights[tokenIndex];
        const scalingFactors = await pool.getScalingFactors();
        scalingFactor = scalingFactors[tokenIndex];

        unscaledBptPrice = await getUnscaledBptPrice(tokenIndex);
        scaledBptPrice = await getScaledBptPrice(tokenIndex);
      });

      const lowerBound = 0.9;
      const upperBound = 1.5;

      let referenceState: CircuitBreakerState;

      function getBptPriceBounds(bptPrice: BigNumber, normalizedWeight: BigNumber): BigNumber[] {
        const weightComplement = Number(fromFp(FP_ONE.sub(normalizedWeight)));

        const result: BigNumber[] = [];
        result[0] = fpMul(bptPrice, fp(lowerBound ** weightComplement));
        result[1] = fpMul(bptPrice, fp(upperBound ** weightComplement));

        return result;
      }

      sharedBeforeEach('set the breaker', async () => {
        await pool.setCircuitBreakers(
          owner,
          [poolTokens.get(tokenIndex)],
          [unscaledBptPrice],
          [fp(lowerBound)],
          [fp(upperBound)]
        );

        referenceState = await pool.getCircuitBreakerState(poolTokens.get(tokenIndex));
      });

      it('sets the reference bounds', async () => {
        // Computing with the original weight should match the stored values
        const [expectedLowerBoundBptPrice, expectedUpperBoundBptPrice] = getBptPriceBounds(
          scaledBptPrice,
          initialWeight
        );

        expect(referenceState.lowerBptPriceBound).to.equalWithError(
          fpMul(expectedLowerBoundBptPrice, scalingFactor),
          0.001
        );
        expect(referenceState.upperBptPriceBound).to.equalWithError(
          fpMul(expectedUpperBoundBptPrice, scalingFactor),
          0.001
        );
      });

      describe('tracks weight changes', () => {
        const UPDATE_DURATION = DAY * 2;

        const START_DELAY = MINUTE * 10;
        let now, startTime: BigNumber, endTime: BigNumber;
        let endWeights: BigNumber[];

        sharedBeforeEach('updateWeightsGradually', async () => {
          now = await currentTimestamp();
          startTime = now.add(START_DELAY);
          endTime = startTime.add(UPDATE_DURATION);
          endWeights = poolWeights.reverse();

          await pool.updateWeightsGradually(owner, startTime, endTime, endWeights);
        });

        function getIntermediateWeight(startWeight: BigNumber, endWeight: BigNumber, pct: number): BigNumber {
          if (startWeight < endWeight) {
            // Weight is increasing
            return startWeight.add(endWeight.sub(startWeight).mul(pct).div(100));
          } else {
            // Weight is decreasing (or not changing)
            return startWeight.sub(startWeight.sub(endWeight).mul(pct).div(100));
          }
        }

        for (let pct = 5; pct < 100; pct += 5) {
          it(`gets correct bounds if called ${pct}% through`, async () => {
            await advanceTime(START_DELAY + (UPDATE_DURATION * pct) / 100);

            const intermediateWeight = getIntermediateWeight(poolWeights[tokenIndex], endWeights[tokenIndex], pct);

            const [expectedLowerBptPriceBound, expectedUpperBptPriceBound] = getBptPriceBounds(
              scaledBptPrice,
              intermediateWeight
            );

            const { lowerBptPriceBound: actualLowerBptPriceBound, upperBptPriceBound: actualUpperBptPriceBound } =
              await pool.getCircuitBreakerState(poolTokens.get(tokenIndex));

            expect(actualLowerBptPriceBound).to.equalWithError(fpMul(expectedLowerBptPriceBound, scalingFactor), 0.001);
            expect(actualUpperBptPriceBound).to.equalWithError(fpMul(expectedUpperBptPriceBound, scalingFactor), 0.001);
          });
        }
      });
    });
  });

  describe('recovery mode', () => {
    const managementAumFeePercentage = fp(0.01);

    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        owner: owner.address,
        swapEnabledOnStart: true,
        managementAumFeePercentage,
        vault,
      };
      pool = await createMockPool(params);
      await pool.init({ from: other, initialBalances });

      await pool.collectAumManagementFees(owner);
    });

    context('when entering recovery mode', () => {
      it('sets the AUM fee percentage to zero', async () => {
        const [aumFeePercentageBefore] = await pool.getManagementAumFeeParams();
        expect(aumFeePercentageBefore).to.be.gt(0);

        await pool.enableRecoveryMode();

        const [aumFeePercentageAfter] = await pool.getManagementAumFeeParams();
        expect(aumFeePercentageAfter).to.equal(0);
      });

      it('sets the actual supply equal to the virtual supply', async () => {
        // Advance time so that AUM fees are accrued.
        await advanceTime(365 * DAY);

        const virtualSupplyBefore = await pool.getVirtualSupply();
        const actualSupplyBefore = await pool.getActualSupply();

        // The virtual supply which doesn't consider yet-to-be-minted fees should be lower.
        // Check that we have a difference of at least 0.01% to discard rounding error.
        expect(virtualSupplyBefore).to.be.lt(actualSupplyBefore.mul(9999).div(10000));

        await pool.enableRecoveryMode();

        const virtualSupplyAfter = await pool.getVirtualSupply();
        expect(virtualSupplyAfter).to.be.eq(virtualSupplyBefore);

        const actualSupplyAfter = await pool.getActualSupply();
        expect(actualSupplyAfter).to.equalWithError(virtualSupplyAfter, 0.0001);
      });
    });

    context('when leaving recovery mode', () => {
      sharedBeforeEach('enable recovery mode', async () => {
        const [, expectedLastAUMCollectionTimestamp] = await pool.getManagementAumFeeParams();
        // Set recovery mode to stop AUM fee calculations.
        await pool.enableRecoveryMode();

        // Advance time so that AUM fees would otherwise be accrued.
        await advanceTime(365 * DAY);

        const [, lastAUMCollectionTimestamp] = await pool.getManagementAumFeeParams();
        expect(lastAUMCollectionTimestamp).to.be.eq(expectedLastAUMCollectionTimestamp);
      });

      it('resets the AUM fee percentage to its original value', async () => {
        const [aumFeePercentageBefore] = await pool.getManagementAumFeeParams();
        expect(aumFeePercentageBefore).to.equal(0);

        await pool.disableRecoveryMode();

        const [aumFeePercentageAfter] = await pool.getManagementAumFeeParams();
        expect(aumFeePercentageAfter).to.equal(managementAumFeePercentage);
      });

      it('sets the lastAumFeeCollectionTimestamp to the current timestamp', async () => {
        const tx = await pool.disableRecoveryMode();
        const expectedLastAUMCollectionTimestamp = await receiptTimestamp(tx.wait());
        const [, updatedLastAUMCollectionTimestamp] = await pool.getManagementAumFeeParams();
        expect(updatedLastAUMCollectionTimestamp).to.be.eq(expectedLastAUMCollectionTimestamp);
      });
    });
  });

  describe('management fees', () => {
    const swapFeePercentage = fp(0.02);
    const managementAumFeePercentage = fp(0.1);

    let assetManager: Contract;

    sharedBeforeEach('deploy pool', async () => {
      assetManager = await deploy('MockWithdrawDepositAssetManager', { args: [vault.address] });
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        assetManagers: poolTokens.map(() => assetManager.address),
        owner: owner.address,
        swapEnabledOnStart: true,
        vault,
        swapFeePercentage,
        managementAumFeePercentage,
      };
      pool = await createMockPool(params);
    });

    describe('management aum fee collection', () => {
      function expectedAUMFees(
        virtualSupply: BigNumberish,
        aumFeePercentage: BigNumberish,
        timeElapsed: BigNumberish
      ): BigNumber {
        const annualBptAmount = bn(virtualSupply).mul(aumFeePercentage).div(fp(1).sub(aumFeePercentage));

        return annualBptAmount.mul(timeElapsed).div(365 * DAY);
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
        const MAX_REL_ERROR = 1e-8;

        it('collects the expected amount of fees', async () => {
          const balanceBefore = await pool.balanceOf(owner);

          const virtualSupply = await pool.getVirtualSupply();
          const expectedManagementFeeBpt = expectedAUMFees(virtualSupply, managementAumFeePercentage, timeElapsed);

          const receipt = await collectAUMFees();

          const balanceAfter = await pool.balanceOf(owner);
          const actualManagementFeeBpt = balanceAfter.sub(balanceBefore);
          expect(actualManagementFeeBpt).to.equalWithError(expectedManagementFeeBpt, 1e-5);

          expectEvent.inIndirectReceipt(receipt, pool.instance.interface, 'ManagementAumFeeCollected', {
            bptAmount: actualManagementFeeBpt,
          });
        });

        it('reports the expected actual supply', async () => {
          const virtualSupplyBefore = await pool.getVirtualSupply();
          const expectedManagementFeeBpt = expectedAUMFees(
            virtualSupplyBefore,
            managementAumFeePercentage,
            timeElapsed
          );

          const expectedActualSupply = virtualSupplyBefore.add(expectedManagementFeeBpt);
          const actualSupply = await pool.getActualSupply();
          expect(actualSupply).to.be.equalWithError(expectedActualSupply, MAX_REL_ERROR);
        });

        it('does not affect the actual supply', async () => {
          const actualSupplyBefore = await pool.getActualSupply();

          await collectAUMFees();

          const actualSupplyAfter = await pool.getActualSupply();
          expect(actualSupplyAfter).to.be.equalWithError(actualSupplyBefore, MAX_REL_ERROR);
        });

        it('syncs the virtual supply to the actual supply', async () => {
          const actualSupplyBefore = await pool.getActualSupply();

          await collectAUMFees();

          const virtualSupplyAfter = await pool.getVirtualSupply();
          expect(virtualSupplyAfter).to.equalWithError(actualSupplyBefore, MAX_REL_ERROR);
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
        await poolTokens.mint({ to: other, amount: fp(100) });
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

          it('returns the paid AUM fees', async () => {
            await advanceTime(10 * DAY);

            const expectedManagementFeeBpt = await pool.instance.callStatic.collectAumManagementFees();

            const tx = await pool.collectAumManagementFees(owner);
            const receipt = await tx.wait();

            const {
              args: { bptAmount: actualManagementFeeBpt },
            } = expectEvent.inIndirectReceipt(receipt, pool.instance.interface, 'ManagementAumFeeCollected');
            expect(actualManagementFeeBpt).to.equalWithError(expectedManagementFeeBpt, 1e-6);
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
    let protocolFeesProvider: Contract;
    let authorizer: Contract;

    const AUM_PROTOCOL_FEE_PERCENTAGE = fp(0.1);
    const swapFeePercentage = fp(0.02);
    const managementAumFeePercentage = fp(0.1);
    const maxYieldValue = fp(1);
    const maxAUMValue = fp(1);

    sharedBeforeEach('deploy and set protocol AUM fee', async () => {
      vault = await Vault.create({
        admin,
        maxYieldValue,
        maxAUMValue,
      });

      authorizer = vault.authorizer;
      protocolFeesProvider = vault.protocolFeesProvider;

      const action = await actionId(protocolFeesProvider, 'setFeeTypePercentage');
      await authorizer.connect(admin).grantPermission(action, admin.address, ANY_ADDRESS);
      await protocolFeesProvider.connect(admin).setFeeTypePercentage(ProtocolFee.AUM, AUM_PROTOCOL_FEE_PERCENTAGE);
    });

    sharedBeforeEach('deploy and initialize pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        owner: owner.address,
        swapEnabledOnStart: true,
        vault,
        swapFeePercentage,
        managementAumFeePercentage,
      };
      pool = await createMockPool(params);

      await poolTokens.mint({ to: owner, amount: fp(100) });
      await poolTokens.approve({ from: owner, to: await pool.getVault() });
      await pool.init({ from: owner, initialBalances });

      // Clock no longer starts at initialization
      // Now we have to do a join to start the clock
      await expect(pool.joinAllGivenOut({ from: owner, bptOut: FP_ZERO }));
    });

    it('accounts for the protocol portion of the AUM fee', async () => {
      const protocolFeesCollector = await vault.getFeesCollector();

      const virtualSupplyAfter = await pool.getVirtualSupply();
      const expectedBpt = virtualSupplyAfter
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
