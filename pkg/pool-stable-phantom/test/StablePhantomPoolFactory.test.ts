import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { advanceTime, currentTimestamp, MONTH } from '@balancer-labs/v2-helpers/src/time';

describe('StablePhantomPoolFactory', function () {
  let vault: Vault, tokens: TokenList, factory: Contract;
  let rateProviders: string[], owner: SignerWithAddress;

  const NAME = 'Balancer Stable Phantom Pool Token';
  const SYMBOL = 'BSPPT';
  const AMP = 400;
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const PRICE_RATE_CACHE_DURATION = MONTH;
  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;
  const PROTOCOL_FEE_EXEMPT_TOKEN_IDX = 2; // not including BPT

  let createTime: BigNumber;
  let protocolFeeExemptFlags: boolean[];

  before('setup signers', async () => {
    [, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy factory & tokens', async () => {
    vault = await Vault.create();
    factory = await deploy('StablePhantomPoolFactory', { args: [vault.address] });
    createTime = await currentTimestamp();

    tokens = await TokenList.create(['baDAI', 'baUSDC', 'baUSDT'], { sorted: true });
    rateProviders = Array(tokens.length).fill(ZERO_ADDRESS);
    protocolFeeExemptFlags = Array(tokens.length).fill(false);
    rateProviders[0] = (await deploy('v2-pool-utils/MockRateProvider')).address;
    rateProviders[1] = (await deploy('v2-pool-utils/MockRateProvider')).address;
    rateProviders[2] = (await deploy('v2-pool-utils/MockRateProvider')).address;
    protocolFeeExemptFlags[PROTOCOL_FEE_EXEMPT_TOKEN_IDX] = true;
  });

  async function createPool(): Promise<Contract> {
    const receipt = await factory.create(
      NAME,
      SYMBOL,
      tokens.addresses,
      AMP,
      rateProviders,
      Array(tokens.length).fill(PRICE_RATE_CACHE_DURATION),
      protocolFeeExemptFlags,
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address
    );

    const event = expectEvent.inReceipt(await receipt.wait(), 'PoolCreated');
    return deployedAt('StablePhantomPool', event.args.pool);
  }

  describe('constructor arguments', () => {
    let pool: Contract;

    sharedBeforeEach('create pool', async () => {
      pool = await createPool();
    });

    it('sets the vault', async () => {
      expect(await pool.getVault()).to.equal(vault.address);
    });

    it('registers tokens in the vault', async () => {
      const poolId = await pool.getPoolId();
      const poolTokens = await vault.getPoolTokens(poolId);

      expect(poolTokens.tokens).to.have.lengthOf(4);
      expect(poolTokens.tokens).to.include(tokens.addresses[0]);
      expect(poolTokens.tokens).to.include(tokens.addresses[1]);
      expect(poolTokens.tokens).to.include(tokens.addresses[2]);
      expect(poolTokens.tokens).to.include(pool.address);
      expect(poolTokens.balances).to.be.zeros;
    });

    it('starts with no BPT', async () => {
      expect(await pool.totalSupply()).to.be.equal(0);
    });

    it('sets no asset managers', async () => {
      const poolId = await pool.getPoolId();
      await tokens.asyncEach(async (token) => {
        const info = await vault.getPoolTokenInfo(poolId, token);
        expect(info.assetManager).to.equal(ZERO_ADDRESS);
      });
    });

    it('sets swap fee', async () => {
      expect(await pool.getSwapFeePercentage()).to.equal(POOL_SWAP_FEE_PERCENTAGE);
    });

    it('sets the owner ', async () => {
      expect(await pool.getOwner()).to.equal(owner.address);
    });

    it('sets the name', async () => {
      expect(await pool.name()).to.equal('Balancer Stable Phantom Pool Token');
    });

    it('sets the symbol', async () => {
      expect(await pool.symbol()).to.equal('BSPPT');
    });

    it('sets the decimals', async () => {
      expect(await pool.decimals()).to.equal(18);
    });

    it('sets the amp', async () => {
      const { value, isUpdating, precision } = await pool.getAmplificationParameter();
      expect(value).to.be.equal(AMP * 1e3);
      expect(isUpdating).to.be.false;
      expect(precision).to.be.equal(1e3);
    });

    it('sets the rate providers', async () => {
      const providers = await pool.getRateProviders();

      expect(providers).to.have.lengthOf(4);
      expect(providers).to.include(rateProviders[0]);
      expect(providers).to.include(rateProviders[1]);
      expect(providers).to.include(rateProviders[2]);
      expect(providers).to.include(ZERO_ADDRESS);
    });

    it('sets the cache rate duration', async () => {
      const firstTokenCache = await pool.getTokenRateCache(tokens.first.address);
      expect(firstTokenCache.duration).to.equal(PRICE_RATE_CACHE_DURATION);
    });

    it('sets the protocol fee flags', async () => {
      const expectedFlags = Array(tokens.length).fill(false);
      expectedFlags[PROTOCOL_FEE_EXEMPT_TOKEN_IDX] = true;

      const flags = await pool.getProtocolFeeExemptTokenFlags();
      expect(flags).to.deep.equal(expectedFlags);
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
});
