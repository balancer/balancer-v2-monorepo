import { ethers } from 'hardhat';
import { expect } from 'chai';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';

import { range } from 'lodash';
import { itPaysProtocolFeesFromInvariantGrowth } from './WeightedPoolProtocolFees.behavior';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { deploy, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('WeightedPool', function () {
  let allTokens: TokenList;
  let admin: SignerWithAddress;
  let lp: SignerWithAddress;

  const MAX_TOKENS = 8;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = range(1000, 1000 + MAX_TOKENS); // These will be normalized to weights that are close to each other, but different

  before('setup signers', async () => {
    [, admin, lp] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    allTokens = await TokenList.create(MAX_TOKENS, { sorted: true, varyDecimals: true });
  });

  itPaysProtocolFeesFromInvariantGrowth();

  describe('weights and scaling factors', () => {
    for (const numTokens of range(2, MAX_TOKENS + 1)) {
      context(`with ${numTokens} tokens`, () => {
        let pool: WeightedPool;
        let tokens: TokenList;

        sharedBeforeEach('deploy pool', async () => {
          tokens = allTokens.subset(numTokens);

          pool = await WeightedPool.create({
            poolType: WeightedPoolType.WEIGHTED_POOL,
            tokens,
            weights: WEIGHTS.slice(0, numTokens),
            swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          });
        });

        it('sets token weights', async () => {
          const normalizedWeights = await pool.getNormalizedWeights();

          expect(normalizedWeights).to.deep.equal(pool.normalizedWeights);
        });

        it('sets scaling factors', async () => {
          const poolScalingFactors = await pool.getScalingFactors();
          const tokenScalingFactors = tokens.map((token) => fp(10 ** (18 - token.decimals)));

          expect(poolScalingFactors).to.deep.equal(tokenScalingFactors);
        });
      });
    }
  });

  describe('permissioned actions', () => {
    let pool: Contract;

    sharedBeforeEach('deploy pool', async () => {
      const vault = await Vault.create();
      pool = await deploy('MockWeightedPool', {
        args: [
          {
            name: '',
            symbol: '',
            tokens: allTokens.subset(2).addresses,
            normalizedWeights: [fp(0.5), fp(0.5)],
            rateProviders: new Array(2).fill(ZERO_ADDRESS),
            assetManagers: new Array(2).fill(ZERO_ADDRESS),
            swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          },

          vault.address,
          vault.getFeesProvider().address,
          0,
          0,
          ZERO_ADDRESS,
        ],
      });
    });

    function itIsOwnerOnly(method: string) {
      it(`${method} can only be called by non-delegated owners`, async () => {
        expect(await pool.isOwnerOnlyAction(await actionId(pool, method))).to.be.true;
      });
    }

    function itIsNotOwnerOnly(method: string) {
      it(`${method} can never be called by the owner`, async () => {
        expect(await pool.isOwnerOnlyAction(await actionId(pool, method))).to.be.false;
      });
    }

    const poolArtifact = getArtifact('v2-pool-weighted/WeightedPool');
    const nonViewFunctions = poolArtifact.abi
      .filter(
        (elem) =>
          elem.type === 'function' && (elem.stateMutability === 'payable' || elem.stateMutability === 'nonpayable')
      )
      .map((fn) => fn.name);

    const expectedOwnerOnlyFunctions = ['setSwapFeePercentage', 'setAssetManagerPoolConfig'];

    const expectedNotOwnerOnlyFunctions = nonViewFunctions.filter((fn) => !expectedOwnerOnlyFunctions.includes(fn));

    describe('owner only actions', () => {
      for (const expectedOwnerOnlyFunction of expectedOwnerOnlyFunctions) {
        itIsOwnerOnly(expectedOwnerOnlyFunction);
      }
    });

    describe('non owner only actions', () => {
      for (const expectedNotOwnerOnlyFunction of expectedNotOwnerOnlyFunctions) {
        itIsNotOwnerOnly(expectedNotOwnerOnlyFunction);
      }
    });
  });

  describe('getRate', () => {
    const swapFeePercentage = fp(0.1); // 10 %
    const protocolFeePercentage = fp(0.5); // 50 %
    const numTokens = 2;

    let tokens: TokenList;
    let pool: WeightedPool;

    sharedBeforeEach('deploy pool', async () => {
      tokens = allTokens.subset(numTokens);
      const vault = await Vault.create({ admin });

      pool = await WeightedPool.create({
        poolType: WeightedPoolType.WEIGHTED_POOL,
        tokens,
        weights: WEIGHTS.slice(0, numTokens),
        swapFeePercentage: swapFeePercentage,
        vault,
      });
      await vault.setSwapFeePercentage(protocolFeePercentage);

      await pool.updateProtocolFeePercentageCache();
    });

    context('before initialized', () => {
      it('rate is zero', async () => {
        await expect(pool.getRate()).to.be.revertedWith('ZERO_INVARIANT');
      });
    });

    context('once initialized', () => {
      sharedBeforeEach('initialize pool', async () => {
        // Init pool with equal balances so that each BPT accounts for approximately one underlying token.
        const equalBalances = Array(numTokens).fill(fp(100));

        await allTokens.mint({ to: lp.address, amount: fp(1000) });
        await allTokens.approve({ from: lp, to: pool.vault.address });

        await pool.init({ from: lp, recipient: lp.address, initialBalances: equalBalances });
      });

      context('without protocol fees', () => {
        it('reports correctly', async () => {
          const totalSupply = await pool.totalSupply();
          const invariant = await pool.estimateInvariant();

          const expectedRate = invariant.mul(numTokens).div(totalSupply).mul(fp(1));
          const rate = await pool.getRate();

          expect(rate).to.be.equalWithError(expectedRate, 0.0001);
        });
      });

      context.skip('with protocol fees', () => {
        sharedBeforeEach('swap bpt in', async () => {
          const amount = fp(20);
          const tokenIn = tokens.first;
          const tokenOut = tokens.second;

          await pool.swapGivenIn({ from: lp, recipient: lp.address, in: tokenIn, out: tokenOut, amount });
        });

        it("doesn't include the value of uncollected protocol fees in the rate", async () => {
          const totalSupply = await pool.totalSupply();
          const invariant = await pool.estimateInvariant();

          const rateAssumingNoProtocolFees = invariant.mul(numTokens).div(totalSupply).mul(fp(1));
          const rate = await pool.getRate();

          const rateDifference = rateAssumingNoProtocolFees.sub(rate);
          // 10000 is chosen as a non-negligible amount to show that the difference is not just from rounding errors.
          expect(rateDifference).to.be.gt(10000);
        });

        it('minting protocol fee BPT should not affect rate', async () => {
          const rateBeforeJoin = await pool.getRate();

          // Perform a very small proportional join. This ensures that the rate should not increase from swap fees
          // due to this join so this can't mask issues with the rate.
          const poolBalances = await pool.getBalances();
          const amountsIn = poolBalances.map((balance) => balance.div(10000));
          await pool.joinGivenIn({ from: lp, amountsIn });

          const rateAfterJoin = await pool.getRate();

          const rateDelta = rateAfterJoin.sub(rateBeforeJoin);
          expect(rateDelta.abs()).to.be.lte(2);
        });
      });
    });
  });
});
