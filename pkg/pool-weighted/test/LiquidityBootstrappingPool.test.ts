import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MINUTE, advanceTime, currentTimestamp } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';

describe('LiquidityBootstrappingPool', function () {
  let owner: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, owner, other] = await ethers.getSigners();
  });

  let tokens: TokenList;

  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });
    await tokens.mint({ to: [other], amount: fp(200) });
  });

  let pool: WeightedPool;
  let sender: SignerWithAddress;
  const weights = [fp(0.3), fp(0.55), fp(0.1), fp(0.05)];
  const initialBalances = [fp(0.9), fp(1.8), fp(2.7), fp(3.6)];

  sharedBeforeEach('deploy pool', async () => {
    const params = { tokens, weights, owner, lbp: true, swapEnabledOnStart: true };
    pool = await WeightedPool.create(params);
  });

  describe('weights', () => {
    it('sets token weights', async () => {
      const normalizedWeights = await pool.getNormalizedWeights();

      // Need to decrease precision
      expect(normalizedWeights).to.equalWithError(pool.normalizedWeights, 0.0001);
    });
  });

  context('when the sender is the owner', () => {
    sharedBeforeEach('set sender to owner', async () => {
      sender = owner;
      await pool.init({ from: owner, initialBalances });
    });

    it('owner can enable/disable trading', async () => {
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

    context('when swaps enabled', () => {
      sharedBeforeEach('enable swaps', async () => {
        await pool.setSwapEnabled(sender, true);
      });

      it('does not prevent swap', async () => {
        await expect(pool.swapGivenIn({ in: 1, out: 0, amount: fp(0.1) })).to.not.be.reverted;
      });
    });

    context('when swaps disabled', () => {
      sharedBeforeEach('disable swaps', async () => {
        await pool.setSwapEnabled(sender, false);
      });

      it('prevents swaps', async () => {
        await expect(pool.swapGivenIn({ in: 1, out: 0, amount: fp(0.1) })).to.be.revertedWith('SWAPS_DISABLED');
      });
    });
  });

  context('when the sender is not the owner', () => {
    sharedBeforeEach('set sender to other', async () => {
      sender = other;
    });

    it('non-owner cannot disable swaps', async () => {
      await expect(pool.setSwapEnabled(other, false)).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    it('non-owner cannot enable swaps', async () => {
      await pool.setSwapEnabled(owner, false);

      await expect(pool.setSwapEnabled(other, true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });

  describe('joins', () => {
    sharedBeforeEach('initialize pool', async () => {
      await pool.init({ from: owner, initialBalances });
    });

    it('non-owners cannot join', async () => {
      await expect(pool.joinGivenIn({ from: other, amountsIn: initialBalances })).to.be.revertedWith(
        'CALLER_IS_NOT_OWNER'
      );
    });

    it('allows owner to join', async () => {
      let bpt = await pool.balanceOf(owner.address);

      await expect(pool.joinGivenIn({ from: owner, amountsIn: initialBalances })).to.not.be.reverted;

      // Check that owner gets BPT - joining with initial balances again should close to double it
      const bptAfterJoin = await pool.balanceOf(owner.address);
      expect(bptAfterJoin).to.equalWithError(bpt.mul(2), 0.0001);
    });
  });

  describe('update weights', () => {
    const UPDATE_DURATION = MINUTE * 60;

    sharedBeforeEach('deploy tokens', async () => {
      const action = await actionId(pool.instance, 'updateWeightsGradually');
      await pool.vault.grantRole(action, owner);
    });

    it('non-owners cannot update weights', async () => {
      const now = await currentTimestamp();

      await expect(pool.updateWeightsGradually(other, now, now, weights)).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    it('reverts if the number of end weights is incorrect', async () => {
      const now = await currentTimestamp();

      await expect(pool.updateWeightsGradually(owner, now, now, weights.slice(0, 1))).to.be.revertedWith(
        'INPUT_LENGTH_MISMATCH'
      );
    });

    it('will fail if start time > end time', async () => {
      const now = await currentTimestamp();

      await expect(pool.updateWeightsGradually(owner, now, now.sub(1), weights)).to.be.revertedWith(
        'GRADUAL_UPDATE_TIME_TRAVEL'
      );
    });

    it('will fail with an invalid end weight', async () => {
      const now = await currentTimestamp();
      const badWeights = weights;
      badWeights[2] = fp(0);

      await expect(pool.updateWeightsGradually(owner, now.add(100), now.add(1000), badWeights)).to.be.revertedWith(
        'MIN_WEIGHT'
      );
    });

    it('will fail with invalid normalized end weights', async () => {
      const now = await currentTimestamp();
      const badWeights = Array(weights.length).fill(fp(0.6));

      await expect(pool.updateWeightsGradually(owner, now.add(100), now.add(1000), badWeights)).to.be.revertedWith(
        'NORMALIZED_WEIGHT_INVARIANT'
      );
    });

    context('gradual weights update in the past', () => {
      let now: BigNumber, startTime: BigNumber, endTime: BigNumber;
      const endWeights = [fp(0.15), fp(0.25), fp(0.55), fp(0.05)];

      sharedBeforeEach('updateWeightsGradually (start time in the past)', async () => {
        now = await currentTimestamp();
        // Start an hour in the past
        startTime = now.sub(MINUTE * 60);
        endTime = now.add(UPDATE_DURATION);  
      });

      it('should fast-forward start time if in the past', async () => {
        await pool.updateWeightsGradually(owner, startTime, endTime, endWeights);
        const updateParams = await pool.getGradualWeightUpdateParams();

        // Start time should be fast-forwarded to now
        expect(updateParams.startTime).to.equalWithError(now, 0.001);          
      });
    });

    context('owner can update weights', () => {
      // startWeights = [fp(0.3), fp(0.55), fp(0.1), fp(0.5)];
      const endWeights = [fp(0.15), fp(0.25), fp(0.55), fp(0.05)];
      const halfWeights = [fp(0.225), fp(0.4), fp(0.325), fp(0.05)];
      const oneFifthWeights = [fp(0.27), fp(0.49), fp(0.19), fp(0.05)];
      const fourFifthWeights = [fp(0.18), fp(0.31), fp(0.46), fp(0.05)];
      let now, startTime: BigNumber, endTime: BigNumber;
      const START_DELAY = MINUTE * 10;

      sharedBeforeEach('updateWeightsGradually', async () => {
        now = await currentTimestamp();
        startTime = now.add(START_DELAY);
        endTime = startTime.add(UPDATE_DURATION);

        await pool.updateWeightsGradually(owner, startTime, endTime, endWeights);
      });

      it('stores the params', async () => {
        const updateParams = await pool.getGradualWeightUpdateParams();

        expect(updateParams.startTime).to.equalWithError(startTime, 0.001);
        expect(updateParams.endTime).to.equalWithError(endTime, 0.001);
        expect(updateParams.endWeights).to.equalWithError(endWeights, 0.001);
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
        expect(normalizedWeights).to.equalWithError(endWeights, 0.0001);
      });

      it('gets intermediate weights if called halfway through', async () => {
        await advanceTime(START_DELAY + UPDATE_DURATION / 2);
        const normalizedWeights = await pool.getNormalizedWeights();

        // Need to decrease precision
        expect(normalizedWeights).to.equalWithError(halfWeights, 0.001);
      });

      it('gets intermediate weights if called 20% through', async () => {
        await advanceTime(START_DELAY + UPDATE_DURATION * 0.2);
        const normalizedWeights = await pool.getNormalizedWeights();

        // Need to decrease precision
        expect(normalizedWeights).to.equalWithError(oneFifthWeights, 0.001);
      });

      it('gets intermediate weights if called 80% through', async () => {
        await advanceTime(START_DELAY + UPDATE_DURATION * 0.8);
        const normalizedWeights = await pool.getNormalizedWeights();

        // Need to decrease precision
        expect(normalizedWeights).to.equalWithError(fourFifthWeights, 0.001);
      });
    });
  });
});
