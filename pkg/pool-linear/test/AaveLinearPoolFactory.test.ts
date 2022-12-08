import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { fp, FP_ZERO } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT112 } from '@balancer-labs/v2-helpers/src/constants';
import { advanceTime, currentTimestamp, MONTH } from '@balancer-labs/v2-helpers/src/time';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describe('AaveLinearPoolFactory', function () {
  let vault: Vault, tokens: TokenList, factory: Contract;
  let creationTime: BigNumber, admin: SignerWithAddress, owner: SignerWithAddress;
  let factoryVersion: string, poolVersion: string;

  const NAME = 'Balancer Linear Pool Token';
  const SYMBOL = 'LPT';
  const UPPER_TARGET = fp(2000);
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  const AAVE_PROTOCOL_ID = 0;
  const BEEFY_PROTOCOL_ID = 1;
  const STURDY_PROTOCOL_ID = 2;

  const AAVE_PROTOCOL_NAME = 'AAVE';
  const BEEFY_PROTOCOL_NAME = 'Beefy';
  const STURDY_PROTOCOL_NAME = 'Sturdy';

  before('setup signers', async () => {
    [, admin, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy factory & tokens', async () => {
    vault = await Vault.create({ admin });
    const queries = await deploy('v2-standalone-utils/BalancerQueries', { args: [vault.address] });
    factoryVersion = JSON.stringify({
      name: 'AaveLinearPoolFactory',
      version: '3',
      deployment: 'test-deployment',
    });
    poolVersion = JSON.stringify({
      name: 'AaveLinearPool',
      version: '1',
      deployment: 'test-deployment',
    });
    factory = await deploy('AaveLinearPoolFactory', {
      args: [
        vault.address,
        vault.getFeesProvider().address,
        queries.address,
        factoryVersion,
        poolVersion,
        BASE_PAUSE_WINDOW_DURATION,
        BASE_BUFFER_PERIOD_DURATION,
      ],
    });
    creationTime = await currentTimestamp();

    const mockLendingPool = await deploy('MockAaveLendingPool');

    const mainToken = await Token.create('DAI');
    const wrappedTokenInstance = await deploy('MockStaticAToken', {
      args: ['cDAI', 'cDAI', 18, mainToken.address, mockLendingPool.address],
    });
    const wrappedToken = await Token.deployedAt(wrappedTokenInstance.address);

    tokens = new TokenList([mainToken, wrappedToken]).sort();
  });

  async function createPool(): Promise<Contract> {
    const tx = await factory.create(
      NAME,
      SYMBOL,
      tokens.DAI.address,
      tokens.CDAI.address,
      UPPER_TARGET,
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address,
      AAVE_PROTOCOL_ID
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');
    expectEvent.inReceipt(receipt, 'AaveLinearPoolCreated', {
      pool: event.args.pool,
      protocolId: AAVE_PROTOCOL_ID,
    });

    return deployedAt('AaveLinearPool', event.args.pool);
  }

  describe('constructor arguments', () => {
    let pool: Contract;

    sharedBeforeEach('create pool', async () => {
      pool = await createPool();
    });

    it('sets the vault', async () => {
      expect(await pool.getVault()).to.equal(vault.address);
    });

    it('checks the factory version', async () => {
      expect(await factory.version()).to.equal(factoryVersion);
    });

    it('checks the pool version', async () => {
      expect(await pool.version()).to.equal(poolVersion);
    });

    it('checks the pool version in the factory', async () => {
      expect(await factory.getPoolVersion()).to.equal(poolVersion);
    });

    it('registers tokens in the vault', async () => {
      const poolId = await pool.getPoolId();
      const poolTokens = await vault.getPoolTokens(poolId);

      expect(poolTokens.tokens).to.have.lengthOf(3);
      expect(poolTokens.tokens).to.include(tokens.DAI.address);
      expect(poolTokens.tokens).to.include(tokens.CDAI.address);
      expect(poolTokens.tokens).to.include(pool.address);

      poolTokens.tokens.forEach((token, i) => {
        expect(poolTokens.balances[i]).to.be.eq(token === pool.address ? MAX_UINT112 : 0);
      });
    });

    it('starts with all the BPT minted', async () => {
      expect(await pool.totalSupply()).to.be.equal(MAX_UINT112);
    });

    it('sets a rebalancer as the asset manager', async () => {
      const poolId = await pool.getPoolId();
      // We only check the first token, but this will be the asset manager for both main and wrapped
      const { assetManager } = await vault.getPoolTokenInfo(poolId, tokens.first);

      const rebalancer = await deployedAt('AaveLinearPoolRebalancer', assetManager);

      expect(await rebalancer.getPool()).to.equal(pool.address);
    });

    it('sets swap fee', async () => {
      expect(await pool.getSwapFeePercentage()).to.equal(POOL_SWAP_FEE_PERCENTAGE);
    });

    it('sets the owner ', async () => {
      expect(await pool.getOwner()).to.equal(owner.address);
    });

    it('sets the name', async () => {
      expect(await pool.name()).to.equal(NAME);
    });

    it('sets the symbol', async () => {
      expect(await pool.symbol()).to.equal(SYMBOL);
    });

    it('sets the decimals', async () => {
      expect(await pool.decimals()).to.equal(18);
    });

    it('sets main token', async () => {
      expect(await pool.getMainToken()).to.equal(tokens.DAI.address);
    });

    it('sets wrapped token', async () => {
      expect(await pool.getWrappedToken()).to.equal(tokens.CDAI.address);
    });

    it('sets the targets', async () => {
      const targets = await pool.getTargets();
      expect(targets.lowerTarget).to.be.equal(FP_ZERO);
      expect(targets.upperTarget).to.be.equal(UPPER_TARGET);
    });
  });

  describe('with a created pool', () => {
    let pool: Contract;

    sharedBeforeEach('create pool', async () => {
      pool = await createPool();
    });

    it('returns the address of the last pool created by the factory', async () => {
      expect(await factory.getLastCreatedPool()).to.equal(pool.address);
    });
  });

  describe('temporarily pausable', () => {
    it('pools have the correct window end times', async () => {
      const pool = await createPool();
      const { pauseWindowEndTime, bufferPeriodEndTime } = await pool.getPausedState();

      expect(pauseWindowEndTime).to.equal(creationTime.add(BASE_PAUSE_WINDOW_DURATION));
      expect(bufferPeriodEndTime).to.equal(creationTime.add(BASE_PAUSE_WINDOW_DURATION + BASE_BUFFER_PERIOD_DURATION));
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

  describe('protocol id', () => {
    it('should not allow adding protocols without permission', async () => {
      await expect(factory.registerProtocolId(AAVE_PROTOCOL_ID, 'AAVE')).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    context('with no registered protocols', () => {
      it('should revert when asking for an unregistered protocol name', async () => {
        await expect(factory.getProtocolName(AAVE_PROTOCOL_ID)).to.be.revertedWith('Protocol ID not registered');
      });
    });

    context('with registered protocols', () => {
      sharedBeforeEach('grant permissions', async () => {
        const action = await actionId(factory, 'registerProtocolId');
        await vault.authorizer.connect(admin).grantPermissions([action], admin.address, [factory.address]);
      });

      sharedBeforeEach('register some protocols', async () => {
        await factory.connect(admin).registerProtocolId(AAVE_PROTOCOL_ID, AAVE_PROTOCOL_NAME);
        await factory.connect(admin).registerProtocolId(BEEFY_PROTOCOL_ID, BEEFY_PROTOCOL_NAME);
        await factory.connect(admin).registerProtocolId(STURDY_PROTOCOL_ID, STURDY_PROTOCOL_NAME);
      });

      it('protocol ID registration should emit an event', async () => {
        const OTHER_PROTOCOL_ID = 57;
        const OTHER_PROTOCOL_NAME = 'Protocol 57';

        const tx = await factory.connect(admin).registerProtocolId(OTHER_PROTOCOL_ID, OTHER_PROTOCOL_NAME);
        expectEvent.inReceipt(await tx.wait(), 'AaveLinearPoolProtocolIdRegistered', {
          protocolId: OTHER_PROTOCOL_ID,
          name: OTHER_PROTOCOL_NAME,
        });
      });

      it('should register protocols', async () => {
        expect(await factory.getProtocolName(AAVE_PROTOCOL_ID)).to.equal(AAVE_PROTOCOL_NAME);
        expect(await factory.getProtocolName(BEEFY_PROTOCOL_ID)).to.equal(BEEFY_PROTOCOL_NAME);
        expect(await factory.getProtocolName(STURDY_PROTOCOL_ID)).to.equal(STURDY_PROTOCOL_NAME);
      });

      it('should fail when a protocol is already registered', async () => {
        await expect(
          factory.connect(admin).registerProtocolId(STURDY_PROTOCOL_ID, 'Random protocol')
        ).to.be.revertedWith('Protocol ID already registered');
      });
    });
  });
});
