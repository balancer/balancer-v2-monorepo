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

// eslint-disable-next-line @typescript-eslint/no-empty-function
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

    it('owner can pause/unpause', async () => {
      await pool.setSwapEnabled(sender, false);
      expect(await pool.instance.swapEnabled()).to.be.false;

      await pool.setSwapEnabled(sender, true);
      expect(await pool.instance.swapEnabled()).to.be.true;
    });

    it('pausing emits an event', async () => {
      const receipt = await pool.setSwapEnabled(sender, false);

      expectEvent.inReceipt(await receipt.wait(), 'SwapEnabledSet', {
        swapEnabled: false,
      });
    });

    it('unpausing emits an event', async () => {
      const receipt = await pool.setSwapEnabled(sender, true);

      expectEvent.inReceipt(await receipt.wait(), 'SwapEnabledSet', {
        swapEnabled: true,
      });
    });

    context('when paused', () => {
      sharedBeforeEach('pause swaps', async () => {
        await pool.setSwapEnabled(sender, false);
      });

      it('prevents swaps', async () => {
        await expect(pool.swapGivenIn({ in: 1, out: 0, amount: fp(0.1) })).to.be.revertedWith('SWAPS_PAUSED');
      });
    });
  });

  context('when the sender is not the owner', () => {
    sharedBeforeEach('set sender to other', async () => {
      sender = other;
    });

    it('non-owner cannot pause', async () => {
      await expect(pool.setSwapEnabled(other, false)).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    it('non-owner cannot unpause', async () => {
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
        'SENDER_NOT_ALLOWED'
      );
    });

    it('allows owner to join', async () => {
      await expect(pool.joinGivenIn({ from: owner, amountsIn: initialBalances })).to.not.be.reverted;
    });
  });

  describe('update weights', () => {
    sharedBeforeEach('deploy tokens', async () => {
      const action = await actionId(pool.instance, 'updateWeightsGradually');
      await pool.vault.grantRole(action, owner);
    });

    it('non-owners cannot update weights', async () => {
      const now = await currentTimestamp();

      await expect(pool.updateWeightsGradually(other, now, now, weights)).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    it('will fail if end weights do not match', async () => {
      const now = await currentTimestamp();

      await expect(pool.updateWeightsGradually(owner, now, now, weights.slice(0, 1))).to.be.revertedWith(
        'INPUT_LENGTH_MISMATCH'
      );
    });

    it('will succeed with start time in the past', async () => {
      const now = await currentTimestamp();

      await expect(pool.updateWeightsGradually(owner, now.sub(1000), now.add(1), weights)).not.to.be.reverted;
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

    context('owner can update weights', () => {
      // startWeights = [fp(0.3), fp(0.55), fp(0.1), fp(0.5)];
      const endWeights = [fp(0.15), fp(0.25), fp(0.55), fp(0.05)];
      const halfWeights = [fp(0.225), fp(0.4), fp(0.325), fp(0.05)];
      let now, startTime: BigNumber, endTime: BigNumber;
      const START_DELAY = MINUTE * 10;
      const UPDATE_DURATION = MINUTE * 60;

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
    });
  });
});
