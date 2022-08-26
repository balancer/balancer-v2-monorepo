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

describe('WeightedPool', function () {
  let allTokens: TokenList;

  const MAX_TOKENS = 8;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = range(1000, 1000 + MAX_TOKENS); // These will be normalized to weights that are close to each other, but different

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
});
