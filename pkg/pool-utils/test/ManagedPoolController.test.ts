import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  WeightedPoolType,
  ManagedPoolRights,
  BasePoolRights,
} from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { currentTimestamp, MONTH, DAY, HOUR } from '@balancer-labs/v2-helpers/src/time';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { encodeInvestmentConfig } from '@balancer-labs/v2-pool-utils/test/helpers/rebalance';
import { ZERO_ADDRESS, MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { SwapKind } from '@balancer-labs/balancer-js';

const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
const WEIGHTS = [fp(30), fp(60), fp(5), fp(5)];
const PAUSE_WINDOW_DURATION = MONTH * 3;
const BUFFER_PERIOD_DURATION = MONTH;
const MIN_WEIGHT_CHANGE_DURATION = DAY;

let admin: SignerWithAddress;
let manager: SignerWithAddress;
let other: SignerWithAddress;
let assetManager: Contract;
let pool: WeightedPool;
let allTokens: TokenList;
let vault: Vault;
let poolController: Contract;

const LONG_UPDATE = DAY * 3;
const SHORT_UPDATE = HOUR * 8;
const END_WEIGHTS = [fp(0.6), fp(0.3), fp(0.05), fp(0.05)];

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
  await allTokens.mint({ to: other, amount: fp(100) });

  assetManager = await deploy('MockAssetManager', { args: [allTokens.DAI.address] });
});

async function deployControllerAndPool(
  canTransfer = true,
  canChangeSwapFee = true,
  canUpdateMetadata = true,
  canChangeWeights = true,
  canDisableSwaps = true,
  canSetMustAllowlistLPs = true,
  canSetCircuitBreakers = true,
  canChangeTokens = true,
  canChangeMgmtFees = true,
  swapEnabledOnStart = true,
  protocolSwapFeePercentage = MAX_UINT256
) {
  const basePoolRights: BasePoolRights = {
    canTransferOwnership: canTransfer,
    canChangeSwapFee: canChangeSwapFee,
    canUpdateMetadata: canUpdateMetadata,
  };

  const managedPoolRights: ManagedPoolRights = {
    canChangeWeights: canChangeWeights,
    canDisableSwaps: canDisableSwaps,
    canSetMustAllowlistLPs: canSetMustAllowlistLPs,
    canSetCircuitBreakers: canSetCircuitBreakers,
    canChangeTokens: canChangeTokens,
    canChangeMgmtFees: canChangeMgmtFees,
  };

  poolController = await deploy('ManagedPoolController', {
    from: manager,
    args: [basePoolRights, managedPoolRights, MIN_WEIGHT_CHANGE_DURATION, manager.address],
  });
  const assetManagers = Array(allTokens.length).fill(ZERO_ADDRESS);
  assetManagers[allTokens.indexOf(allTokens.DAI)] = assetManager.address;

  const aumProtocolFeesCollector = await deploy('v2-standalone-utils/AumProtocolFeesCollector', {
    args: [vault.address],
  });

  const params = {
    vault,
    tokens: allTokens,
    weights: WEIGHTS,
    owner: poolController.address,
    assetManagers,
    swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
    poolType: WeightedPoolType.MANAGED_POOL,
    swapEnabledOnStart: swapEnabledOnStart,
    protocolSwapFeePercentage: protocolSwapFeePercentage,
    aumProtocolFeesCollector: aumProtocolFeesCollector.address,
  };
  pool = await WeightedPool.create(params);
}

// Some tests repeated; could have a behavesLikeBasePoolController.behavior.ts
describe('ManagedPoolController', function () {
  const NEW_SWAP_FEE = fp(0.05);
  const NEW_MGMT_SWAP_FEE = fp(0.78);
  const NEW_MGMT_AUM_FEE = fp(0.015);

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

    it('sets base pool permissions', async () => {
      expect(await poolController.canTransferOwnership()).to.be.true;
      expect(await poolController.canChangeSwapFee()).to.be.true;
      expect(await poolController.canUpdateMetadata()).to.be.true;
    });

    it('sets managed pool permissions', async () => {
      expect(await poolController.canChangeWeights()).to.be.true;
      expect(await poolController.canDisableSwaps()).to.be.true;
      expect(await poolController.canSetMustAllowlistLPs()).to.be.true;
      expect(await poolController.canSetCircuitBreakers()).to.be.true;
      expect(await poolController.canChangeTokens()).to.be.true;
      expect(await poolController.canChangeManagementFees()).to.be.true;
    });

    it('sets the minimum weight change duration', async () => {
      expect(await poolController.getMinWeightChangeDuration()).to.equal(MIN_WEIGHT_CHANGE_DURATION);
    });
  });

  context('pool controller is initialized', () => {
    sharedBeforeEach('initialize pool controller', async () => {
      await deployControllerAndPool();
      await poolController.initialize(pool.address);
    });

    describe('set swap fee percentage', () => {
      it('lets the manager set the swap fee', async () => {
        await poolController.connect(manager).setSwapFeePercentage(NEW_SWAP_FEE);

        expect(await pool.getSwapFeePercentage()).to.equal(NEW_SWAP_FEE);
      });

      it('reverts if non-manager sets the swap fee', async () => {
        await expect(poolController.connect(other).setSwapFeePercentage(NEW_SWAP_FEE)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    describe('change management swap fee percentage', () => {
      it('lets the manager set the management swap fee', async () => {
        await poolController.connect(manager).setManagementSwapFeePercentage(NEW_MGMT_SWAP_FEE);

        expect(await pool.getManagementSwapFeePercentage()).to.equal(NEW_MGMT_SWAP_FEE);
      });

      it('reverts if non-manager sets the management fee', async () => {
        await expect(
          poolController.connect(other).setManagementSwapFeePercentage(NEW_MGMT_SWAP_FEE)
        ).to.be.revertedWith('CALLER_IS_NOT_OWNER');
      });
    });

    describe('change management aum fee percentage', () => {
      it('lets the manager set the management AUM fee', async () => {
        await poolController.connect(manager).setManagementAumFeePercentage(NEW_MGMT_AUM_FEE);

        expect(await pool.getManagementAumFeePercentage()).to.equal(NEW_MGMT_AUM_FEE);
      });

      it('reverts if non-manager sets the management AUM fee', async () => {
        await expect(poolController.connect(other).setManagementAumFeePercentage(NEW_MGMT_AUM_FEE)).to.be.revertedWith(
          'CALLER_IS_NOT_OWNER'
        );
      });
    });

    describe('set swap enabled', () => {
      it('lets the manager disable trading', async () => {
        await poolController.connect(manager).setSwapEnabled(false);

        expect(await pool.getSwapEnabled(manager)).to.be.false;
      });

      it('reverts if non-manager disables trading', async () => {
        await expect(poolController.connect(other).setSwapEnabled(false)).to.be.revertedWith('CALLER_IS_NOT_OWNER');
      });
    });

    describe('management fee collection', () => {
      it('lets the manager collect management fees', async () => {
        await poolController.connect(manager).withdrawCollectedManagementFees(manager.address);
      });

      it('reverts if non-manager collects management fees', async () => {
        await expect(poolController.connect(other).withdrawCollectedManagementFees(other.address)).to.be.revertedWith(
          'CALLER_IS_NOT_OWNER'
        );
      });
    });

    describe('update weights gradually', () => {
      it('lets the manager update weights gradually', async () => {
        const now = await currentTimestamp();

        await poolController.connect(manager).updateWeightsGradually(now, now.add(LONG_UPDATE), END_WEIGHTS);
      });

      it('reverts if non-manager updates weights gradually', async () => {
        const now = await currentTimestamp();

        await expect(
          poolController.connect(other).updateWeightsGradually(now, now.add(LONG_UPDATE), END_WEIGHTS)
        ).to.be.revertedWith('CALLER_IS_NOT_OWNER');
      });

      it('reverts if manager updates weights too fast', async () => {
        const now = await currentTimestamp();

        await expect(
          poolController.connect(manager).updateWeightsGradually(now, now.add(SHORT_UPDATE), END_WEIGHTS)
        ).to.be.revertedWith('WEIGHT_CHANGE_TOO_FAST');
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

    describe('control LP allowlist', () => {
      it('lets the manager toggle mustAllowlistLPs', async () => {
        await poolController.connect(manager).setMustAllowlistLPs(true);

        expect(await pool.getMustAllowlistLPs()).to.be.true;
      });

      it('reverts if non-manager toggle mustAllowlistLPs', async () => {
        await expect(poolController.connect(other).setMustAllowlistLPs(true)).to.be.revertedWith('CALLER_IS_NOT_OWNER');
      });
    });
  });

  describe('pool controller permissions', () => {
    context('with transferrable set to false', () => {
      sharedBeforeEach('deploy controller (transferrable false)', async () => {
        await deployControllerAndPool(false);
      });

      it('reverts if the manager transfers ownership', async () => {
        await expect(poolController.connect(manager).transferOwnership(other.address)).to.be.revertedWith(
          'FEATURE_DISABLED'
        );
      });
    });

    context('with canUpdateMetadata set to false', () => {
      sharedBeforeEach('deploy controller (canUpdateMetadata false)', async () => {
        await deployControllerAndPool(true, true, false);
        await poolController.initialize(pool.address);
      });

      it('reverts if the manager updates metadata', async () => {
        await expect(poolController.connect(manager).updateMetadata('0x')).to.be.revertedWith('FEATURE_DISABLED');
      });
    });

    context('with canChangeWeights set to false', () => {
      sharedBeforeEach('deploy controller (canChangeWeights false)', async () => {
        await deployControllerAndPool(true, true, true, false);
        await poolController.initialize(pool.address);
      });

      it('reverts if the manager updates weights', async () => {
        const now = await currentTimestamp();

        await expect(
          poolController.connect(manager).updateWeightsGradually(now, now.add(LONG_UPDATE), END_WEIGHTS)
        ).to.be.revertedWith('FEATURE_DISABLED');
      });
    });

    context('with canDisableSwaps set to false', () => {
      sharedBeforeEach('deploy controller (canDisableSwaps false)', async () => {
        await deployControllerAndPool(true, true, true, true, false);
        await poolController.initialize(pool.address);
      });

      it('reverts if the manager disables swaps', async () => {
        await expect(poolController.connect(manager).setSwapEnabled(false)).to.be.revertedWith('FEATURE_DISABLED');
      });
    });

    context('with canSetMustAllowlistLPs set to false', () => {
      sharedBeforeEach('deploy controller (canSetMustAllowlistLPs false)', async () => {
        await deployControllerAndPool(true, true, true, true, true, false);
        await poolController.initialize(pool.address);
      });

      it('reverts if the manager tries to disable the allowlist', async () => {
        await expect(poolController.connect(manager).setMustAllowlistLPs(true)).to.be.revertedWith('FEATURE_DISABLED');
      });
    });

    context('with canChangeMgmtFees set to false', () => {
      sharedBeforeEach('deploy controller (canChangeMgmtFees false)', async () => {
        await deployControllerAndPool(true, true, true, true, true, false, true, true, false);
        await poolController.initialize(pool.address);
      });

      it('reverts if the manager tries to change the management swap fee', async () => {
        await expect(
          poolController.connect(manager).setManagementSwapFeePercentage(NEW_MGMT_SWAP_FEE)
        ).to.be.revertedWith('FEATURE_DISABLED');
      });

      it('reverts if the manager tries to change the management AUM fee', async () => {
        await expect(
          poolController.connect(manager).setManagementAumFeePercentage(NEW_MGMT_AUM_FEE)
        ).to.be.revertedWith('FEATURE_DISABLED');
      });
    });

    context('with public swaps disabled (on start)', () => {
      sharedBeforeEach('deploy controller (swapEnabledOnStart false)', async () => {
        await deployControllerAndPool(true, true, true, true, true, false, true, true, true, false);
        await poolController.initialize(pool.address);
        await allTokens.approve({ from: manager, to: await pool.getVault() });
        const initialBalances = Array(allTokens.length).fill(fp(1));
        await pool.init({ from: manager, initialBalances });
      });

      it('reverts if anyone swaps', async () => {
        const singleSwap = {
          poolId: await pool.getPoolId(),
          kind: SwapKind.GivenIn,
          assetIn: allTokens.first.address,
          assetOut: allTokens.second.address,
          amount: fp(0.01),
          userData: '0x',
        };
        const funds = {
          sender: manager.address,
          fromInternalBalance: false,
          recipient: other.address,
          toInternalBalance: false,
        };
        const limit = 0; // Minimum amount out
        const deadline = MAX_UINT256;

        await expect(vault.instance.connect(manager).swap(singleSwap, funds, limit, deadline)).to.be.revertedWith(
          'SWAPS_DISABLED'
        );
      });
    });

    context('with canSetCircuitBreakers set to false', () => {
      sharedBeforeEach('deploy controller (canSetCircuitBreakers false)', async () => {
        await deployControllerAndPool(true, true, true, true, true, false, false);
      });

      it('sets the set circuit breakers permission', async () => {
        expect(await poolController.canSetCircuitBreakers()).to.be.false;
      });
    });

    context('with canChangeTokens set to false', () => {
      sharedBeforeEach('deploy controller (canChangeTokens false)', async () => {
        await deployControllerAndPool(true, true, true, true, true, false, true, false);
      });

      it('sets the change tokens permission', async () => {
        expect(await poolController.canChangeTokens()).to.be.false;
      });
    });

    context('with canChangeMgmtFees set to false', () => {
      sharedBeforeEach('deploy controller (canChangeMgmtFees false)', async () => {
        await deployControllerAndPool(true, true, true, true, true, false, false, false, false);
      });

      it('sets the set management fee permission', async () => {
        expect(await poolController.canChangeManagementFees()).to.be.false;
      });
    });
  });
});
