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

import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { SwapKind } from '@balancer-labs/balancer-js';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';

enum RevertType {
  DoNotRevert,
  NonMalicious,
  MaliciousSwapQuery,
  MaliciousJoinExitQuery,
}

describe('AaveLinearPool', function () {
  let vault: Vault;
  let pool: LinearPool, tokens: TokenList, mainToken: Token, wrappedToken: Token;
  let poolFactory: Contract;
  let mockLendingPool: Contract;
  let trader: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const AAVE_PROTOCOL_ID = 0;

  const BASE_PAUSE_WINDOW_DURATION = MONTH * 3;
  const BASE_BUFFER_PERIOD_DURATION = MONTH;

  before('setup', async () => {
    [, lp, trader, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    mockLendingPool = await deploy('MockAaveLendingPool');

    mainToken = await Token.create('DAI');
    const wrappedTokenInstance = await deploy('MockStaticAToken', {
      args: ['cDAI', 'cDAI', 18, mainToken.address, mockLendingPool.address],
    });
    wrappedToken = await Token.deployedAt(wrappedTokenInstance.address);

    tokens = new TokenList([mainToken, wrappedToken]).sort();

    await tokens.mint({ to: [lp, trader], amount: fp(100) });
  });

  sharedBeforeEach('deploy pool factory', async () => {
    vault = await Vault.create();
    const queries = await deploy('v2-standalone-utils/BalancerQueries', { args: [vault.address] });
    poolFactory = await deploy('AaveLinearPoolFactory', {
      args: [
        vault.address,
        vault.getFeesProvider().address,
        queries.address,
        'factoryVersion',
        'poolVersion',
        BASE_PAUSE_WINDOW_DURATION,
        BASE_BUFFER_PERIOD_DURATION,
      ],
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
      owner.address,
      AAVE_PROTOCOL_ID
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    pool = await LinearPool.deployedAt(event.args.pool);
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
          owner.address,
          AAVE_PROTOCOL_ID
        )
      ).to.be.revertedWith('TOKENS_MISMATCH');
    });
  });

  describe('asset managers', () => {
    it('sets the same asset manager for main and wrapped token', async () => {
      const poolId = await pool.getPoolId();

      const { assetManager: firstAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.first);
      const { assetManager: secondAssetManager } = await vault.getPoolTokenInfo(poolId, tokens.second);

      expect(firstAssetManager).to.not.equal(ZERO_ADDRESS);
      expect(firstAssetManager).to.equal(secondAssetManager);
    });

    it('sets the no asset manager for the BPT', async () => {
      const poolId = await pool.getPoolId();
      const { assetManager } = await vault.instance.getPoolTokenInfo(poolId, pool.address);
      expect(assetManager).to.equal(ZERO_ADDRESS);
    });
  });

  describe('getWrappedTokenRate', () => {
    context('under normal operation', () => {
      it('returns the expected value', async () => {
        // Reserve's normalised income is stored with 27 decimals (i.e. a 'ray' value)
        // 1e27 implies a 1:1 exchange rate between main and wrapped token
        await mockLendingPool.setReserveNormalizedIncome(bn(1e27));
        expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1));

        // We now double the reserve's normalised income to change the exchange rate to 2:1
        await mockLendingPool.setReserveNormalizedIncome(bn(2e27));
        expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2));
      });
    });

    context('when Aave reverts maliciously to impersonate a swap query', () => {
      sharedBeforeEach('make Aave lending pool start reverting', async () => {
        await mockLendingPool.setRevertType(RevertType.MaliciousSwapQuery);
      });

      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await expect(pool.getWrappedTokenRate()).to.be.revertedWith('MALICIOUS_QUERY_REVERT');
      });
    });

    context('when Aave reverts maliciously to impersonate a join/exit query', () => {
      sharedBeforeEach('make Aave lending pool start reverting', async () => {
        await mockLendingPool.setRevertType(RevertType.MaliciousJoinExitQuery);
      });

      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await expect(pool.getWrappedTokenRate()).to.be.revertedWith('MALICIOUS_QUERY_REVERT');
      });
    });
  });

  describe('rebalancing', () => {
    context('when Aave reverts maliciously to impersonate a swap query', () => {
      let rebalancer: Contract;
      sharedBeforeEach('provide initial liquidity to pool', async () => {
        const poolId = await pool.getPoolId();

        await tokens.approve({ to: vault, amount: fp(100), from: lp });
        await vault.instance.connect(lp).swap(
          {
            poolId,
            kind: SwapKind.GivenIn,
            assetIn: mainToken.address,
            assetOut: pool.address,
            amount: fp(10),
            userData: '0x',
          },
          { sender: lp.address, fromInternalBalance: false, recipient: lp.address, toInternalBalance: false },
          0,
          MAX_UINT256
        );
      });

      sharedBeforeEach('deploy and initialize pool', async () => {
        const poolId = await pool.getPoolId();
        const { assetManager } = await vault.getPoolTokenInfo(poolId, tokens.first);
        rebalancer = await deployedAt('AaveLinearPoolRebalancer', assetManager);
      });

      sharedBeforeEach('make Aave lending pool start reverting', async () => {
        await mockLendingPool.setRevertType(RevertType.MaliciousSwapQuery);
      });

      it('reverts with MALICIOUS_QUERY_REVERT', async () => {
        await expect(rebalancer.rebalance(trader.address)).to.be.revertedWith('MALICIOUS_QUERY_REVERT');
      });
    });
  });
});
