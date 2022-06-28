import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime, currentTimestamp, MONTH } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { toNormalizedWeights } from '@balancer-labs/balancer-js';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ManagedPoolParams } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';

describe('BaseManagedPoolFactory', function () {
  let tokens: TokenList;
  let factory: Contract;
  let vault: Vault;
  let admin: SignerWithAddress;
  let manager: SignerWithAddress;
  let assetManager: SignerWithAddress;
  let aumProtocolFeesCollector: string;

  const NAME = 'Balancer Pool Token';
  const SYMBOL = 'BPT';
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const POOL_MANAGEMENT_SWAP_FEE_PERCENTAGE = fp(0.5);
  const POOL_MANAGEMENT_AUM_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = toNormalizedWeights([fp(30), fp(70), fp(5), fp(5)]);

  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  let createTime: BigNumber;

  before('setup signers', async () => {
    [, admin, manager, assetManager] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy factory & tokens', async () => {
    vault = await Vault.create({ admin });

    factory = await deploy('BaseManagedPoolFactory', { args: [vault.address] });
    createTime = await currentTimestamp();

    tokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });

    aumProtocolFeesCollector = await factory.getAumProtocolFeesCollector();
  });

  it('factory has the AumProtocolFeesController', async () => {
    expect(aumProtocolFeesCollector).to.not.equal(ZERO_ADDRESS);
  });

  async function createPool(
    swapsEnabled = true,
    mustAllowlistLPs = false,
    protocolSwapFeePercentage = MAX_UINT256
  ): Promise<Contract> {
    const assetManagers: string[] = Array(tokens.length).fill(ZERO_ADDRESS);
    assetManagers[tokens.indexOf(tokens.DAI)] = assetManager.address;

    const newPoolParams: ManagedPoolParams = {
      name: NAME,
      symbol: SYMBOL,
      tokens: tokens.addresses,
      normalizedWeights: WEIGHTS,
      assetManagers: assetManagers,
      swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
      swapEnabledOnStart: swapsEnabled,
      mustAllowlistLPs: mustAllowlistLPs,
      protocolSwapFeePercentage: protocolSwapFeePercentage,
      managementSwapFeePercentage: POOL_MANAGEMENT_SWAP_FEE_PERCENTAGE,
      managementAumFeePercentage: POOL_MANAGEMENT_AUM_FEE_PERCENTAGE,
      aumProtocolFeesCollector: aumProtocolFeesCollector,
    };

    const receipt = await (await factory.connect(manager).create(newPoolParams, manager.address)).wait();

    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    return deployedAt('ManagedPool', event.args.pool);
  }

  describe('constructor arguments', () => {
    let pool: Contract;

    sharedBeforeEach(async () => {
      pool = await createPool();
    });

    it('sets the vault', async () => {
      expect(await pool.getVault()).to.equal(vault.address);
    });

    it('registers tokens in the vault', async () => {
      const poolId = await pool.getPoolId();
      const poolTokens = await vault.getPoolTokens(poolId);

      expect(poolTokens.tokens).to.have.members(tokens.addresses);
      expect(poolTokens.balances).to.be.zeros;
    });

    it('starts with no BPT', async () => {
      expect(await pool.totalSupply()).to.be.equal(0);
    });

    it('sets asset managers', async () => {
      await tokens.asyncEach(async (token) => {
        const poolId = await pool.getPoolId();
        const info = await vault.getPoolTokenInfo(poolId, token);
        if (token.address == tokens.DAI.address) {
          expect(info.assetManager).to.equal(assetManager.address);
        } else {
          expect(info.assetManager).to.equal(ZERO_ADDRESS);
        }
      });
    });

    it('sets swap fee', async () => {
      expect(await pool.getSwapFeePercentage()).to.equal(POOL_SWAP_FEE_PERCENTAGE);
    });

    it('sets management swap fee', async () => {
      expect(await pool.getManagementSwapFeePercentage()).to.equal(POOL_MANAGEMENT_SWAP_FEE_PERCENTAGE);
    });

    it('sets management aum fee', async () => {
      expect(await pool.getManagementAumFeePercentage()).to.equal(POOL_MANAGEMENT_AUM_FEE_PERCENTAGE);
    });

    it('sets the pool owner', async () => {
      // Would not do this! The owner for real pools should be a pool controller
      expect(await pool.getOwner()).to.equal(manager.address);
    });

    it('sets the name', async () => {
      expect(await pool.name()).to.equal('Balancer Pool Token');
    });

    it('sets the symbol', async () => {
      expect(await pool.symbol()).to.equal('BPT');
    });

    it('sets the decimals', async () => {
      expect(await pool.decimals()).to.equal(18);
    });
  });

  describe('temporarily pausable', () => {
    it('pools have the correct window end times', async () => {
      const pool = await createPool();
      const { pauseWindowEndTime, bufferPeriodEndTime } = await pool.getPausedState();

      expect(pauseWindowEndTime).to.equal(createTime.add(BASE_PAUSE_WINDOW_DURATION));
      expect(bufferPeriodEndTime).to.equal(createTime.add(BASE_PAUSE_WINDOW_DURATION + BASE_BUFFER_PERIOD_DURATION));
    });

    it('multiple pools have the same window end times', async () => {
      const firstPool = await createPool();
      await advanceTime(BASE_PAUSE_WINDOW_DURATION / 3);
      const secondPool = await createPool();

      const { firstPauseWindowEndTime, firstBufferPeriodEndTime } = await firstPool.getPausedState();
      const { secondPauseWindowEndTime, secondBufferPeriodEndTime } = await secondPool.getPausedState();

      expect(firstPauseWindowEndTime).to.equal(secondPauseWindowEndTime);
      expect(firstBufferPeriodEndTime).to.equal(secondBufferPeriodEndTime);
    });

    it('pools created after the pause window end date have no buffer period', async () => {
      await advanceTime(BASE_PAUSE_WINDOW_DURATION + 1);

      const pool = await createPool();
      const { pauseWindowEndTime, bufferPeriodEndTime } = await pool.getPausedState();
      const now = await currentTimestamp();

      expect(pauseWindowEndTime).to.equal(now);
      expect(bufferPeriodEndTime).to.equal(now);
    });
  });

  describe('initial state', () => {
    it('pool created with swaps enabled', async () => {
      const pool = await createPool();

      expect(await pool.getSwapEnabled()).to.be.true;
    });

    it('pool created with swaps disabled', async () => {
      const pool = await createPool(false);

      expect(await pool.getSwapEnabled()).to.be.false;
    });

    it('pool created with allowlist LPs', async () => {
      const pool = await createPool(true, true);

      expect(await pool.getMustAllowlistLPs()).to.be.true;
    });

    it('pool created with allowlist LPs disabled', async () => {
      const pool = await createPool(true, false);

      expect(await pool.getMustAllowlistLPs()).to.be.false;
    });

    it('pool with delegated protocol fees', async () => {
      const pool = await createPool(true, false);

      expect(await pool.getProtocolFeeDelegation()).to.be.true;
    });

    it('pool created with a fixed protocol fee', async () => {
      const pool = await createPool(true, false, fp(0.1));

      expect(await pool.getProtocolFeeDelegation()).to.be.false;
    });
  });
});
