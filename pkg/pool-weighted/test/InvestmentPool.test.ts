import { ethers } from 'hardhat';
import { expect } from 'chai';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { BigNumber, Contract } from 'ethers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';

import { range } from 'lodash';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('InvestmentPool', function () {
  let allTokens: TokenList;
  let assetManager: SignerWithAddress;
  let owner: SignerWithAddress;

  const MAX_TOKENS = 100;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const MANAGEMENT_FEE_PERCENTAGE = fp(0.2);
  const WEIGHTS = range(10000, 10000 + MAX_TOKENS); // These will be normalized to weights that are close to each other, but different

  before('setup signers', async () => {
    [, owner, assetManager] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    allTokens = await TokenList.create(MAX_TOKENS, { sorted: true, varyDecimals: true });
  });

  describe('asset managers', () => {
    let vault: Vault;
    let factory: Contract;
    let tokens: TokenList;
    let validWeights: BigNumber[];
    let validManagers: string[];

    sharedBeforeEach('deploy factory & tokens', async () => {
      vault = await Vault.create();
      factory = await deploy('InvestmentPoolFactory', { args: [vault.address] });

      tokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });
      validWeights = Array(tokens.length).fill(fp(1 / tokens.length));
      validManagers = Array(tokens.length).fill(assetManager.address);
    });

    async function createPool(
      weights: BigNumber[] = validWeights,
      assetManagers: string[] = validManagers
    ): Promise<Contract> {
      const receipt = await (
        await factory.create(
          'Balancer Investment Pool',
          'INV-BPT',
          tokens.addresses,
          weights,
          assetManagers,
          POOL_SWAP_FEE_PERCENTAGE,
          owner.address,
          MANAGEMENT_FEE_PERCENTAGE
        )
      ).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      return deployedAt('InvestmentPool', event.args.pool);
    }

    it('should have asset managers', async () => {
      const pool = await createPool();
      const poolId = await pool.getPoolId();

      await tokens.asyncEach(async (token) => {
        const info = await vault.getPoolTokenInfo(poolId, token);
        expect(info.assetManager).to.equal(assetManager.address);
      });
    });

    it('should fail if weights wrong length', async () => {
      const badWeights = Array(MAX_TOKENS).fill(fp(0.01));
      await expect(createPool(badWeights)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });

    it('should fail if asset managers wrong length', async () => {
      const badManagers = Array(MAX_TOKENS).fill(assetManager.address);

      await expect(createPool(validWeights, badManagers)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });
  });

  describe('weights and scaling factors', () => {
    for (const numTokens of range(2, MAX_TOKENS + 1)) {
      context(`with ${numTokens} tokens`, () => {
        let pool: WeightedPool;
        let tokens: TokenList;

        sharedBeforeEach('deploy pool', async () => {
          tokens = allTokens.subset(numTokens);

          pool = await WeightedPool.create({
            poolType: WeightedPoolType.INVESTMENT_POOL,
            tokens,
            weights: WEIGHTS.slice(0, numTokens),
            swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
            managementFeePercentage: MANAGEMENT_FEE_PERCENTAGE
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
});
