import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { WeightedPoolType, BasePoolRights } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { encodeInvestmentConfig } from '@balancer-labs/v2-asset-manager-utils/test/helpers/rebalance';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';

const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
const WEIGHTS = [fp(30), fp(60), fp(5), fp(5)];
const PAUSE_WINDOW_DURATION = MONTH * 3;
const BUFFER_PERIOD_DURATION = MONTH;
const METADATA = '0x4b04c67fb743403d339729f8438ecad295a3a015ca144a0945bb6bb9abe3da20';

let admin: SignerWithAddress;
let manager: SignerWithAddress;
let other: SignerWithAddress;
let assetManager: Contract;
let pool: WeightedPool;
let allTokens: TokenList;
let vault: Vault;
let poolController: Contract;

before('setup signers', async () => {
  [, admin, manager, other] = await ethers.getSigners();
});

sharedBeforeEach('deploy Vault, asset manager, and tokens', async () => {
  vault = await Vault.create({
    admin,
    pauseWindowDuration: PAUSE_WINDOW_DURATION,
    bufferPeriodDuration: BUFFER_PERIOD_DURATION,
  });

  allTokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });
  await allTokens.mint({ to: manager, amount: fp(100) });

  assetManager = await deploy('v2-asset-manager-utils/MockAssetManager', { args: [allTokens.DAI.address] });
});

async function deployControllerAndPool(canTransfer = true, canChangeSwapFee = true, canUpdateMetadata = true) {
  const basePoolRights: BasePoolRights = {
    canTransferOwnership: canTransfer,
    canChangeSwapFee: canChangeSwapFee,
    canUpdateMetadata: canUpdateMetadata,
  };

  const controllerState = TypesConverter.toEncodedBasePoolRights(basePoolRights);

  poolController = await deploy('BasePoolController', { from: manager, args: [controllerState, manager.address] });
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
  };
  pool = await WeightedPool.create(params);
}

describe('BasePoolController', function () {
  const NEW_SWAP_FEE = fp(0.05);
  const NEXT_SWAP_FEE = fp(0.005);

  context('pool controller not initialized', () => {
    sharedBeforeEach('deploy controller (default permissions)', async () => {
      await deployControllerAndPool();
    });

    it('creates the pool', async () => {
      expect(await pool.getOwner()).to.equal(poolController.address);
    });

    it('sets up the pool controller', async () => {
      expect(await poolController.getManager()).to.equal(manager.address);
    });

    it('cannot call functions before initialization', async () => {
      await expect(poolController.connect(manager).setSwapFeePercentage(NEW_SWAP_FEE)).to.be.revertedWith(
        'UNINITIALIZED_POOL_CONTROLLER'
      );
    });

    it('sets all permissions', async () => {
      const allRights: BasePoolRights = {
        canTransferOwnership: true,
        canChangeSwapFee: true,
        canUpdateMetadata: true,
      };

      expect(await poolController.canTransferOwnership()).to.be.true;
      expect(await poolController.canChangeSwapFee()).to.be.true;
      expect(await poolController.canUpdateMetadata()).to.be.true;

      const controllerState = await poolController.encodePermissions(allRights);
      const calculatedState = TypesConverter.toEncodedBasePoolRights(allRights);

      expect(controllerState).to.equal(calculatedState);
    });

    describe('metadata', () => {
      it('has no initial metadata', async () => {
        expect(await poolController.getMetadata()).to.equal('0x');
      });

      it('lets the manager update metadata', async () => {
        const tx = await poolController.connect(manager).updateMetadata(METADATA);
        expectEvent.inReceipt(await tx.wait(), 'MetadataUpdated', {
          metadata: METADATA,
        });

        expect(await poolController.getMetadata()).to.equal(METADATA);
      });

      it('reverts if a non-manager updates metadata', async () => {
        await expect(poolController.connect(other).updateMetadata(METADATA)).to.be.revertedWith('CALLER_IS_NOT_OWNER');
      });
    });
  });

  context('pool controller is initialized', () => {
    sharedBeforeEach('initialize pool controller', async () => {
      await deployControllerAndPool();
      await poolController.initialize(pool.address);
    });

    describe('set swap fee', () => {
      it('sets the swap fee controller to the manager', async () => {
        expect(await poolController.getSwapFeeController()).to.equal(manager.address);
      });

      it('lets the manager set the swap fee', async () => {
        await poolController.connect(manager).setSwapFeePercentage(NEW_SWAP_FEE);

        expect(await pool.getSwapFeePercentage()).to.equal(NEW_SWAP_FEE);
      });

      it('reverts if non-manager sets the swap fee', async () => {
        await expect(poolController.connect(other).setSwapFeePercentage(NEW_SWAP_FEE)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });

      context('when the manager delegates swap fees', () => {
        sharedBeforeEach('delegate control of swap fees', async () => {
          await poolController.connect(manager).setSwapFeeController(other.address);
        });

        it('sets the swap fee controller to the delegate', async () => {
          expect(await poolController.getSwapFeeController()).to.equal(other.address);
        });

        it('the manager can no longer set the swap fee', async () => {
          await expect(poolController.connect(manager).setSwapFeePercentage(NEW_SWAP_FEE)).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });

        it('the delegate can set the swap fee', async () => {
          await poolController.connect(other).setSwapFeePercentage(NEW_SWAP_FEE);

          expect(await pool.getSwapFeePercentage()).to.equal(NEW_SWAP_FEE);
        });
      });
    });

    describe('set asset manager config', () => {
      const poolConfig = {
        targetPercentage: 3,
        upperCriticalPercentage: 4,
        lowerCriticalPercentage: 2,
      };

      it('lets the manager set the asset manager config', async () => {
        await poolController
          .connect(manager)
          .setAssetManagerPoolConfig(allTokens.DAI.address, encodeInvestmentConfig(poolConfig));
      });

      it('reverts if non-manager sets the asset manager config', async () => {
        await expect(
          poolController
            .connect(other)
            .setAssetManagerPoolConfig(allTokens.DAI.address, encodeInvestmentConfig(poolConfig))
        ).to.be.revertedWith('CALLER_IS_NOT_OWNER');
      });
    });
  });

  describe('pool controller permissions', () => {
    context('with transferrable set to false', () => {
      sharedBeforeEach('deploy controller (transferrable false)', async () => {
        await deployControllerAndPool(false);
      });

      it('sets the permission to false', async () => {
        expect(await poolController.canTransferOwnership()).to.be.false;
      });

      it('reverts if the manager transfers ownership', async () => {
        await expect(poolController.connect(manager).transferOwnership(other.address)).to.be.revertedWith(
          'UNAUTHORIZED_OPERATION'
        );
      });
    });

    context('with transferrable set to true', () => {
      sharedBeforeEach('deploy controller (transferrable true)', async () => {
        await deployControllerAndPool(true);
      });

      it('reverts if a non-candidate claims ownership', async () => {
        await expect(poolController.connect(other).claimOwnership()).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });

      it('reverts if a non-manager transfers ownership', async () => {
        await expect(poolController.connect(other).transferOwnership(other.address)).to.be.revertedWith(
          'CALLER_IS_NOT_OWNER'
        );
      });

      it('lets the manager transfer ownership', async () => {
        await poolController.initialize(pool.address);
        await poolController.connect(manager).transferOwnership(other.address);

        // Still have the old manager until claimed
        expect(await poolController.getManager()).to.equal(manager.address);
        expect(await poolController.getManagerCandidate()).to.equal(other.address);

        await expect(poolController.connect(admin).claimOwnership()).to.be.revertedWith('SENDER_NOT_ALLOWED');

        const tx = await poolController.connect(other).claimOwnership();
        expectEvent.inReceipt(await tx.wait(), 'OwnershipTransferred', {
          previousManager: manager.address,
          newManager: other.address,
        });

        // Now the manager has changed
        expect(await poolController.getManager()).to.equal(other.address);
        expect(await poolController.getManagerCandidate()).to.equal(ZERO_ADDRESS);

        // Transferring ownership does not transfer swap fee controller
        await expect(poolController.connect(other).setSwapFeePercentage(NEXT_SWAP_FEE)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );

        // Original swap fee controller can still do it
        await poolController.connect(manager).setSwapFeePercentage(NEXT_SWAP_FEE);

        expect(await pool.getSwapFeePercentage()).to.equal(NEXT_SWAP_FEE);
      });
    });

    context('with set swap fee set to false', () => {
      sharedBeforeEach('deploy controller (set swap fee false)', async () => {
        await deployControllerAndPool(true, false);
        await poolController.initialize(pool.address);
      });

      it('sets the permission to false', async () => {
        expect(await poolController.canChangeSwapFee()).to.be.false;
      });

      it('sets the swap fee controller to zero', async () => {
        expect(await poolController.getSwapFeeController()).to.equal(ZERO_ADDRESS);
      });

      it('reverts if manager sets the swap fee', async () => {
        await expect(poolController.connect(manager).setSwapFeePercentage(NEW_SWAP_FEE)).to.be.revertedWith(
          'UNAUTHORIZED_OPERATION'
        );
      });
    });

    context('with update metadata set to false', () => {
      sharedBeforeEach('deploy controller (update metadata false)', async () => {
        await deployControllerAndPool(true, true, false);
        await poolController.initialize(pool.address);
      });

      it('sets the permission to false', async () => {
        expect(await poolController.canUpdateMetadata()).to.be.false;
      });

      it('reverts if the manager updates metadata', async () => {
        await expect(poolController.connect(manager).updateMetadata(METADATA)).to.be.revertedWith(
          'UNAUTHORIZED_OPERATION'
        );
      });
    });
  });
});
