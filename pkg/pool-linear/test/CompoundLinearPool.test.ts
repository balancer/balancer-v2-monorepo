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

describe('CompoundLinearPool', function () {
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
    mainToken = await Token.create('WBTC');
    const wrappedTokenInstance = await deploy('MockCToken', {
      args: ['cWBTC', 'cWBTC', 8, mainToken.address],
    });

    wrappedToken = await Token.deployedAt(wrappedTokenInstance.address);
    tokens = new TokenList([mainToken, wrappedToken]).sort();
    mockLendingPool = wrappedTokenInstance;
    await tokens.mint({ to: [lp, trader], amount: fp(100) });
  });

  sharedBeforeEach('deploy pool factory', async () => {
    vault = await Vault.create();
    const queries = await deploy('v2-standalone-utils/BalancerQueries', { args: [vault.address] });
    poolFactory = await deploy('CompoundLinearPoolFactory', {
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
      // Exchange rates are returned as uint256 scaled by 10**(18-8 + underlying token decimal)
      // First test will be a 1:1 exchange rate (1*10^(18-8+decimal))
      const scaledValue = 18 - 8 + pool.mainToken.decimals;

      const mockExchange = bn(10 ** scaledValue);
      await mockLendingPool.setExchangeRateCurrent(mockExchange);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1));

      // We now double the reserve's normalised income to change the exchange rate to 2:1
      const doubleMockExchange = bn(2 * 10 ** scaledValue);
      await mockLendingPool.setExchangeRateCurrent(doubleMockExchange);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2));
    });
  });

  describe('constructor', () => {
    it('reverts if the mainToken is not the ASSET of the wrappedToken', async () => {
      const otherToken = await Token.create('DAI');

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
