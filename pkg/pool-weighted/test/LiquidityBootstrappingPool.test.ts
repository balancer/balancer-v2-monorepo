import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MINUTE, advanceTime, currentTimestamp } from '@balancer-labs/v2-helpers/src/time';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';

import { itBehavesAsWeightedPool } from './BaseWeightedPool.behavior';

// eslint-disable-next-line @typescript-eslint/no-empty-function
describe('LiquidityBootstrappingPool', function () {
  describe('as a 2-token weighted pool', () => {
    itBehavesAsWeightedPool(2);
  });

  describe('as a 3-token weighted pool', () => {
    itBehavesAsWeightedPool(3);
  });

  let trader: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;

  before('setup signers', async () => {
    [, lp, trader, owner] = await ethers.getSigners();
  });

  let tokens: TokenList;

  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });
    await tokens.mint({ to: [lp, trader], amount: fp(200) });
  });

  let pool: WeightedPool;
  const weights = [fp(0.3), fp(0.55), fp(0.1), fp(0.05)];
  const initialBalances = [fp(0.9), fp(1.8), fp(2.7), fp(3.6)];

  sharedBeforeEach('deploy pool', async () => {
    const params = { tokens, weights, owner, lbp: true, swapEnabledOnStart: true };
    pool = await WeightedPool.create(params);
  });

  /*const initializePool = () => {
    sharedBeforeEach('initialize pool', async () => {
      await pool.init({ initialBalances, recipient: lp });
    });
  };*/

  describe('weights', () => {
    it('sets token weights', async () => {
      const normalizedWeights = await pool.getNormalizedWeights();

      // Need to decrease precision
      expect(normalizedWeights).to.equalWithError(pool.normalizedWeights, 0.0001);
    });
  });

  describe('public swap', () => {
    sharedBeforeEach('deploy tokens', async () => {
      const action = await actionId(pool.instance, 'setPublicSwap');
      await pool.vault.grantRole(action, owner);
    });

    it('Owner can pause swaps', async () => {
      await pool.setPublicSwap(owner, false);

      expect(await pool.instance.swapEnabled()).to.be.false;

      await expect(pool.swapGivenIn({ in: 1, out: 0, amount: fp(0.1) })).to.be.revertedWith('SWAPS_PAUSED');

      await pool.setPublicSwap(owner, true);

      expect(await pool.instance.swapEnabled()).to.be.true;
    });

    it('LP cannot pause swaps', async () => {
      await expect(pool.setPublicSwap(lp, false)).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });

  describe('joins', () => {
    sharedBeforeEach('initialize pool', async () => {
      await pool.init({ recipient: owner, initialBalances });

      //const action = await actionId(pool.instance, '_onJoinPool');
      //await pool.vault.grantRole(action, owner);
    });

    it('no public LPs', async () => {
      await expect(pool.joinGivenIn({ recipient: lp, amountsIn: initialBalances })).to.be.revertedWith(
        'SENDER_NOT_ALLOWED'
      );
    });

    it('allows owner to join', async () => {
      await expect(pool.joinGivenIn({ recipient: owner, from: owner, amountsIn: initialBalances })).to.not.be.reverted;
    });
  });

  describe('update weights', () => {
    sharedBeforeEach('deploy tokens', async () => {
      const action = await actionId(pool.instance, 'updateWeightsGradually');
      await pool.vault.grantRole(action, owner);
    });

    it('only allows owner to update weights', async () => {
      const now = await currentTimestamp();

      await expect(pool.updateWeightsGradually(lp, now, now, weights)).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    context('call update weights', () => {
      // startWeights = [fp(0.3), fp(0.55), fp(0.1), fp(0.5)];
      const endWeights = [fp(0.15), fp(0.25), fp(0.55), fp(0.05)];
      const halfWeights = [fp(0.225), fp(0.4), fp(0.325), fp(0.05)];
      let now, startTime: BigNumber, endTime: BigNumber;

      sharedBeforeEach('updateWeightsGradually', async () => {
        now = await currentTimestamp();
        startTime = now.add(MINUTE * 10);
        endTime = startTime.add(MINUTE * 60);

        await pool.updateWeightsGradually(owner, startTime, endTime, endWeights);
      });

      it('stores the params', async () => {
        const updateParams = await pool.getGradualUpdateParams();

        expect(updateParams.startTime).to.equalWithError(startTime, 0.001);
        expect(updateParams.endTime).to.equalWithError(endTime, 0.001);
        expect(updateParams.endWeights).to.equalWithError(endWeights, 0.001);
      });

      it('gets start weights if called early', async () => {
        const normalizedWeights = await pool.getNormalizedWeights();

        // Need to decrease precision
        expect(normalizedWeights).to.equalWithError(pool.normalizedWeights, 0.0001);
      });

      it('gets end weights if called late', async () => {
        await advanceTime(MINUTE * 100);
        const normalizedWeights = await pool.getNormalizedWeights();

        // Need to decrease precision
        expect(normalizedWeights).to.equalWithError(endWeights, 0.0001);
      });

      it('gets intermediate weights if called halfway through', async () => {
        await advanceTime(MINUTE * 40);
        const normalizedWeights = await pool.getNormalizedWeights();

        // Need to decrease precision
        expect(normalizedWeights).to.equalWithError(halfWeights, 0.001);
      });
    });
  });
});
