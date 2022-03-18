import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { Contract } from 'ethers';

describe('Unseeded AssetManagedLiquidityBootstrappingPool', function () {
  const MAX_TOKENS = 2;
  let manager: SignerWithAddress, other: SignerWithAddress;
  let tokens: TokenList;
  let vault: Vault;

  before('setup signers', async () => {
    [, manager, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    // Because they are sorted, 0 is always the projectToken, and 1 is the reserveToken
    tokens = await TokenList.create(MAX_TOKENS, { sorted: true });
    await tokens.mint({ to: [other], amount: fp(200) });
  });

  let pool: WeightedPool;
  let poolController: Contract;
  const weights = [fp(0.9), fp(0.1)];
  const initialBalances = [fp(1000), fp(1.8)];

  context('when deployed from factory', () => {
    sharedBeforeEach('deploy pool', async () => {
      vault = await Vault.create();

      const params = {
        tokens,
        weights,
        poolType: WeightedPoolType.UNSEEDED_AM_LIQUIDITY_BOOTSTRAPPING_POOL,
        vault,
        fromFactory: true,
        from: manager,
      };
      pool = await WeightedPool.create(params);
      poolController = await deployedAt('AssetManagedLBPController', await pool.getOwner());
    });

    it('has no asset manager on the project token', async () => {
      const { assetManager } = await pool.getTokenInfo(tokens.get(0));
      expect(assetManager).to.be.zeroAddress;
    });

    it('has an asset manager on the reserve token', async () => {
      const { assetManager } = await pool.getTokenInfo(tokens.get(1));
      expect(assetManager).to.equal(await pool.getOwner());
    });

    describe('fund pool', () => {
      sharedBeforeEach('mint base tokens', async () => {
        // The manager needs to have the base tokens
        tokens.get(0).mint(manager, fp(1000));
      });

      it('funds the pool', async () => {
        // Need to allow the pool controller to pull tokens
        await tokens.get(0).approve(poolController, initialBalances[0], { from: manager });

        await poolController.connect(manager).fundPool(initialBalances);

        const { balances } = await vault.getPoolTokens(await pool.getPoolId());
        expect(balances[1]).to.equal(initialBalances[1]);

        await poolController.restorePool();
      });
    });
  });
});
