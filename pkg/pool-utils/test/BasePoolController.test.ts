import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { encodeInvestmentConfig } from '@balancer-labs/v2-asset-manager-utils/test/helpers/rebalance';

const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
const WEIGHTS = [fp(30), fp(60), fp(5), fp(5)];
const PAUSE_WINDOW_DURATION = MONTH * 3;
const BUFFER_PERIOD_DURATION = MONTH;

let admin: SignerWithAddress;
let other: SignerWithAddress;
let governance: SignerWithAddress;
let pool: WeightedPool;
let allTokens: TokenList;
let vault: Vault;
let poolController: Contract;

before('setup signers', async () => {
  [admin, other, governance] = await ethers.getSigners();
});

sharedBeforeEach('deploy Vault and tokens', async () => {
  vault = await Vault.create({
    admin,
    pauseWindowDuration: PAUSE_WINDOW_DURATION,
    bufferPeriodDuration: BUFFER_PERIOD_DURATION,
  });

  allTokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });
  await allTokens.mint({ to: admin, amount: fp(100) });
});

describe('BasePoolController', function () {
  const NEW_SWAP_FEE = fp(0.05);
  const NEXT_SWAP_FEE = fp(0.005);

  sharedBeforeEach('deploy controller and pool', async () => {
    poolController = await deploy('BasePoolController');

    const params = {
      vault,
      tokens: allTokens,
      weights: WEIGHTS,
      owner: poolController.address,
      swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
      poolType: WeightedPoolType.WEIGHTED_POOL,
      swapEnabledOnStart: false,
    };
    pool = await WeightedPool.create(params);
  });

  context('pool controller not initialized', () => {
    it('creates the pool', async () => {
      expect(await pool.getOwner()).to.equal(poolController.address);
    });

    it('sets up the pool controller', async () => {
      expect(await poolController.owner()).to.equal(admin.address);
    });

    it('cannot call functions before initialization', async () => {
      await expect(poolController.connect(admin).setSwapFeePercentage(NEW_SWAP_FEE)).to.be.revertedWith(
        'UNINITIALIZED'
      );
    });
  });

  context('pool controller is initialized', () => {
    sharedBeforeEach('initialize pool controller', async () => {
      await poolController.bindPool(pool.address);
    });

    it('owner can set the swap fee', async () => {
      await poolController.connect(admin).setSwapFeePercentage(NEW_SWAP_FEE);

      expect(await pool.getSwapFeePercentage()).to.equal(NEW_SWAP_FEE);
    });

    it('enforces owner permissions', async () => {
      await expect(poolController.connect(other).setSwapFeePercentage(NEW_SWAP_FEE)).to.be.revertedWith(
        'CALLER_IS_NOT_OWNER'
      );
    });

    it('can be transferred', async () => {
      await poolController.transferOwnership(other.address);

      await expect(poolController.connect(admin).setSwapFeePercentage(NEXT_SWAP_FEE)).to.be.revertedWith(
        'CALLER_IS_NOT_OWNER'
      );

      await poolController.connect(other).setSwapFeePercentage(NEXT_SWAP_FEE);

      expect(await pool.getSwapFeePercentage()).to.equal(NEXT_SWAP_FEE);
    });

    it('can renounce ownership', async () => {
      await poolController.renounceOwnership();

      await expect(poolController.connect(admin).setSwapFeePercentage(NEXT_SWAP_FEE)).to.be.revertedWith(
        'CALLER_IS_NOT_OWNER'
      );

      expect(await poolController.owner()).to.equal(ZERO_ADDRESS);
    });

    it('cannot be paused by owner', async () => {
      await expect(pool.setPaused(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    context('pause authorized', async () => {
      sharedBeforeEach('authorize governance to pause', async () => {
        const action = await actionId(pool.instance, 'setPaused');
        await vault.grantRole(action, governance.address);
      });

      it('still cannot be paused by owner', async () => {
        await expect(pool.setPaused(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });

      it('can be paused by governance', async () => {
        await pool.instance.connect(governance).setPaused(true);

        expect(await pool.isPaused()).to.be.true;
      });
    });

    describe('Asset Managed pool', () => {
      let assetManagerContract: Contract;
      let assetManagers: string[];
      let assetManagedPool: WeightedPool;
      let poolId: string;

      const poolConfig = {
        targetPercentage: 3,
        upperCriticalPercentage: 4,
        lowerCriticalPercentage: 2,
      };

      sharedBeforeEach('deploy asset managed pool', async () => {
        const lendingPool = await deploy('v2-asset-manager-utils/MockAaveLendingPool', { args: [] });
        const aaveRewardsController = await deploy('v2-asset-manager-utils/MockAaveRewards');

        const daiAToken = await deploy('v2-asset-manager-utils/MockAToken', {
          args: [lendingPool.address, 'aDai', 'aDai', 18],
        });
        await lendingPool.registerAToken(allTokens.DAI.address, daiAToken.address);

        // Deploy Asset manager
        assetManagerContract = await deploy('v2-asset-manager-utils/AaveATokenAssetManager', {
          args: [vault.address, allTokens.DAI.address, lendingPool.address, aaveRewardsController.address],
        });
        const distributor = await deploy('v2-distributors/MultiRewards', {
          args: [vault.address],
        });

        poolController = await deploy('BasePoolController');
        assetManagers = Array(allTokens.length).fill(ZERO_ADDRESS);
        assetManagers[allTokens.indexOf(allTokens.DAI)] = assetManagerContract.address;

        const params = {
          vault,
          assetManagers,
          tokens: allTokens,
          weights: WEIGHTS,
          owner: poolController.address,
          swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          poolType: WeightedPoolType.WEIGHTED_POOL,
          swapEnabledOnStart: false,
        };
        assetManagedPool = await WeightedPool.create(params);
        poolId = await assetManagedPool.getPoolId();

        await poolController.bindPool(assetManagedPool.address);
        await assetManagerContract.initialize(poolId, distributor.address);
      });

      it('deploys the asset manager', async () => {
        expect(assetManagerContract).to.not.equal(undefined);

        const { assetManager } = await assetManagedPool.getTokenInfo(allTokens.DAI);
        expect(assetManager).to.equal(assetManagerContract.address);
      });

      it('owner can set the asset manager config', async () => {
        await poolController
          .connect(admin)
          .setAssetManagerPoolConfig(allTokens.DAI.address, encodeInvestmentConfig(poolConfig));
        const result = await assetManagerContract.getInvestmentConfig(poolId);

        expect(result.targetPercentage).to.equal(poolConfig.targetPercentage);
        expect(result.upperCriticalPercentage).to.equal(poolConfig.upperCriticalPercentage);
        expect(result.lowerCriticalPercentage).to.equal(poolConfig.lowerCriticalPercentage);
      });

      it('enforces owner permissions', async () => {
        await expect(
          poolController
            .connect(other)
            .setAssetManagerPoolConfig(allTokens.DAI.address, encodeInvestmentConfig(poolConfig))
        ).to.be.revertedWith('CALLER_IS_NOT_OWNER');
      });
    });
  });
});
