import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('AaveLinearPool', function () {
  let vault: Vault;
  let pool: LinearPool, tokens: TokenList, mainToken: Token, wrappedToken: Token;
  let poolFactory: Contract;
  let mockLendingPool: Contract;
  let trader: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  before('setup', async () => {
    [, lp, trader, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    mainToken = await Token.create('DAI');
    const wrappedTokenInstance = await deploy('MockStaticAToken', { args: ['cDAI', 'cDAI', 18, mainToken.address] });
    wrappedToken = await Token.deployedAt(wrappedTokenInstance.address);

    tokens = new TokenList([mainToken, wrappedToken]).sort();
    mockLendingPool = wrappedTokenInstance;

    await tokens.mint({ to: [lp, trader], amount: fp(100) });
  });

  sharedBeforeEach('deploy pool factory', async () => {
    vault = await Vault.create();
    const queries = await deploy('v2-standalone-utils/BalancerQueries', { args: [vault.address] });
    poolFactory = await deploy('AaveLinearPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address, queries.address],
    });
  });

  sharedBeforeEach('deploy and initialize pool', async () => {
    const tx = await poolFactory.create(
      'Balancer Pool Token',
      'BPT',
      mainToken.address,
      wrappedToken.address,
      bn(0),
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    pool = await LinearPool.deployedAt(event.args.pool);
  });

  describe('asset managers', () => {
    it('sets the same asset manager for main and wrapped token', async () => {
      const poolId = await pool.getPoolId();

      const { assetManager: firstAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.first);
      const { assetManager: secondAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.second);

      expect(firstAssetManager).to.equal(secondAssetManager);
    });

    it('sets the no asset manager for the BPT', async () => {
      const poolId = await pool.getPoolId();
      const { assetManager } = await vault.instance.getPoolTokenInfo(poolId, pool.address);
      expect(assetManager).to.equal(ZERO_ADDRESS);
    });
  });

  describe('getWrappedTokenRate', () => {
    it('returns the expected value', async () => {
      // Reserve's normalised income is stored with 27 decimals (i.e. a 'ray' value)
      // 1e27 implies a 1:1 exchange rate between main and wrapped token
      await mockLendingPool.setReserveNormalizedIncome(bn(1e27));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1));

      // We now double the reserve's normalised income to change the exchange rate to 2:1
      await mockLendingPool.setReserveNormalizedIncome(bn(2e27));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2));
    });

    it('returns expected value for 1:1 exchange', async () => {
      // Exchange rate is 1:1, scaled to 1e18 regardless of token decimals
      await mockLendingPool.setReserveNormalizedIncome(bn(1e18));
      expect(await pool.getWrappedTokenRate()).to.be.eq(FP_ONE);

      // Deposit one asset and check decimals on assets/shares
      await wrappedYieldTokenInstance.deposit(bn(1e6), trader.address);
      expect(await wrappedYieldTokenInstance.totalSupply()).to.be.eq(bn(1e12));
      expect(await wrappedYieldTokenInstance.totalAssets()).to.be.eq(bn(1e6));

      // Redeem one share and check zero asset/share balances
      await wrappedYieldTokenInstance.redeem(bn(1e12), owner.address, trader.address);
      expect(await wrappedYieldTokenInstance.totalSupply()).to.be.eq(0);
      expect(await wrappedYieldTokenInstance.totalAssets()).to.be.eq(0);
    });

    it('returns expected value for 2:1 exchange', async () => {
      // Double the exchange rate to 2:1
      await wrappedYieldTokenInstance.setRate(bn(2e18));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2));

      // At this rate we get half as many shares
      await wrappedYieldTokenInstance.deposit(bn(1e6), trader.address);
      expect(await wrappedYieldTokenInstance.totalSupply()).to.be.eq(bn(5e11));
      await wrappedYieldTokenInstance.redeem(bn(5e11), owner.address, trader.address);
      expect(await wrappedYieldTokenInstance.totalAssets()).to.be.eq(0);
    });

    it('returns expected value for 1:2 exchange', async () => {
      // Halve the exchange rate to 1:2
      await wrappedYieldTokenInstance.setRate(bn(5e17));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(0.5));

      // At this rate we get twice as many shares
      await wrappedYieldTokenInstance.deposit(bn(1e6), trader.address);
      expect(await wrappedYieldTokenInstance.totalSupply()).to.be.eq(bn(2e12));
      await wrappedYieldTokenInstance.redeem(bn(2e12), owner.address, trader.address);
      expect(await wrappedYieldTokenInstance.totalAssets()).to.be.eq(0);
    });

    it('returns expected value for 1.25:1 exchange', async () => {
      // Set the exchange rate to 1.25:1
      await wrappedYieldTokenInstance.setRate(bn(125e16));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.25));

      // At this rate we get 20% fewer shares
      await wrappedYieldTokenInstance.deposit(bn(1e6), trader.address);
      expect(await wrappedYieldTokenInstance.totalSupply()).to.be.eq(bn(8e11));
      await wrappedYieldTokenInstance.redeem(bn(8e11), owner.address, trader.address);
      expect(await wrappedYieldTokenInstance.totalAssets()).to.be.eq(0);
    });
  });

  describe('constructor', () => {
    it('reverts if the mainToken is not the ASSET of the wrappedToken', async () => {
      const otherToken = await Token.create('USDC');

      await expect(
        poolFactory.create(
          'Balancer Pool Token',
          'BPT',
          otherToken.address,
          wrappedToken.address,
          bn(0),
          POOL_SWAP_FEE_PERCENTAGE,
          owner.address
        )
      ).to.be.revertedWith('TOKENS_MISMATCH');
    });
  });
});
