import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { encodeInvestmentConfig } from '@balancer-labs/v2-asset-manager-utils/test/helpers/rebalance';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
const WEIGHTS = [fp(30), fp(60), fp(5), fp(5)];
const PAUSE_WINDOW_DURATION = MONTH * 3;
const BUFFER_PERIOD_DURATION = MONTH;
const METADATA = '0x4b04c67fb743403d339729f8438ecad295a3a015ca144a0945bb6bb9abe3da20';

let admin: SignerWithAddress;
let other: SignerWithAddress;
let assetManager: Contract;
let pool: WeightedPool;
let allTokens: TokenList;
let vault: Vault;
let poolController: Contract;

before('setup signers', async () => {
  [, admin, other] = await ethers.getSigners();
});

sharedBeforeEach('deploy Vault, asset manager, and tokens', async () => {
  vault = await Vault.create({
    admin,
    pauseWindowDuration: PAUSE_WINDOW_DURATION,
    bufferPeriodDuration: BUFFER_PERIOD_DURATION,
  });

  allTokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });
  await allTokens.mint({ to: admin, amount: fp(100) });

  assetManager = await deploy('v2-asset-manager-utils/MockAssetManager', { args: [allTokens.DAI.address] });
});

describe('BasePoolController', function () {
  const NEW_SWAP_FEE = fp(0.05);
  const NEXT_SWAP_FEE = fp(0.005);

  sharedBeforeEach('deploy controller and pool', async () => {
    poolController = await deploy('BasePoolController', { from: admin });
    const assetManagers = Array(allTokens.length).fill(ZERO_ADDRESS);
    assetManagers[allTokens.indexOf(allTokens.DAI)] = assetManager.address;

    const params = {
      vault,
      tokens: allTokens,
      weights: WEIGHTS,
      owner: poolController.address,
      assetManagers,
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

    describe('metadata', () => {
      it('has no initial metadata', async () => {
        expect(await poolController.getMetadata()).to.equal('0x');
      });

      it('lets the owner update metadata', async () => {
        const tx = await poolController.connect(admin).updateMetadata(METADATA);
        expectEvent.inReceipt(await tx.wait(), 'MetadataUpdated', {
          metadata: METADATA,
        });

        expect(await poolController.getMetadata()).to.equal(METADATA);
      });

      it('reverts if a non-owner updates metadata', async () => {
        await expect(poolController.connect(other).updateMetadata(METADATA)).to.be.revertedWith('CALLER_IS_NOT_OWNER');
      });
    });
  });

  context('pool controller is initialized', () => {
    sharedBeforeEach('initialize pool controller', async () => {
      await poolController.initialize(pool.address);
    });

    describe('set swap fee', () => {
      it('lets the owner set the swap fee', async () => {
        await poolController.connect(admin).setSwapFeePercentage(NEW_SWAP_FEE);

        expect(await pool.getSwapFeePercentage()).to.equal(NEW_SWAP_FEE);
      });

      it('reverts if non-owner sets the swap fee', async () => {
        await expect(poolController.connect(other).setSwapFeePercentage(NEW_SWAP_FEE)).to.be.revertedWith(
          'CALLER_IS_NOT_OWNER'
        );
      });
    });

    describe('set asset manager config', () => {
      const poolConfig = {
        targetPercentage: 3,
        upperCriticalPercentage: 4,
        lowerCriticalPercentage: 2,
      };

      it('lets the owner set the asset manager config', async () => {
        await poolController
          .connect(admin)
          .setAssetManagerPoolConfig(allTokens.DAI.address, encodeInvestmentConfig(poolConfig));
      });

      it('reverts if non-owner sets the asset manager config', async () => {
        await expect(
          poolController
            .connect(other)
            .setAssetManagerPoolConfig(allTokens.DAI.address, encodeInvestmentConfig(poolConfig))
        ).to.be.revertedWith('CALLER_IS_NOT_OWNER');
      });
    });

    it('ownership can be transferred', async () => {
      await poolController.connect(admin).transferOwnership(other.address);

      await expect(poolController.connect(admin).setSwapFeePercentage(NEXT_SWAP_FEE)).to.be.revertedWith(
        'CALLER_IS_NOT_OWNER'
      );

      await poolController.connect(other).setSwapFeePercentage(NEXT_SWAP_FEE);

      expect(await pool.getSwapFeePercentage()).to.equal(NEXT_SWAP_FEE);
    });
  });
});
