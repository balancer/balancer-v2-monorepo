import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { FundManagement, SingleSwap } from '@balancer-labs/balancer-js';
import { values, wrap } from 'lodash';

interface testingToken {
  mainTokenName: string;
  wrappedTokenName: string;
  underlyingDecimals: number;
}

describe('CompoundLinearPool', function () {
  let vault: Vault;
  let poolFactory: Contract;
  let trader: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;
  let funds: FundManagement;
  const testingTokens: testingToken[] = [
    { mainTokenName: 'SUSHI', wrappedTokenName: 'cSUSHI', underlyingDecimals: 18 },
    { mainTokenName: 'WBTC', wrappedTokenName: 'cWBTC', underlyingDecimals: 8 },
    { mainTokenName: 'USDT', wrappedTokenName: 'cUSDT', underlyingDecimals: 6 },
    { mainTokenName: 'MADEUPTOKEN', wrappedTokenName: 'cMADEUPTOKEN', underlyingDecimals: 4 },
  ];

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  before('setup', async () => {
    [, lp, trader, owner] = await ethers.getSigners();

    funds = {
      sender: lp.address,
      fromInternalBalance: false,
      toInternalBalance: false,
      recipient: lp.address,
    };
  });

  sharedBeforeEach('deploy pool factory', async () => {
    vault = await Vault.create();
    const queries = await deploy('v2-standalone-utils/BalancerQueries', { args: [vault.address] });
    poolFactory = await deploy('CompoundLinearPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address, queries.address],
    });
  });

  async function deployPool(mainTokenAddress: string, wrappedTokenAddress: string) {
    const tx = await poolFactory.create(
      'Balancer Pool Token',
      'BPT',
      mainTokenAddress,
      wrappedTokenAddress,
      fp(1_000_000),
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    return LinearPool.deployedAt(event.args.pool);
  }

  for (let i = 0; i <= testingTokens.length - 1; i++) {
    describe(`Pool with ${testingTokens[i].underlyingDecimals} decimals tests`, () => {
      let mainToken: Token;
      let wrappedToken: Token;
      let tokens: TokenList;
      let mockLendingPool: Contract;
      let boostedPool: LinearPool;

      sharedBeforeEach('setup tokens, vault and linear pool', async () => {
        mainToken = await Token.create({
          symbol: testingTokens[i].mainTokenName,
          name: testingTokens[i].mainTokenName,
          decimals: testingTokens[i].underlyingDecimals,
        });
        const wrappedTokenInstance = await deploy('MockCToken', {
          args: [testingTokens[i].wrappedTokenName, testingTokens[i].wrappedTokenName, 8, mainToken.address],
        });
        wrappedToken = await Token.deployedAt(wrappedTokenInstance.address);

        tokens = new TokenList([mainToken, wrappedToken]).sort();
        mockLendingPool = wrappedTokenInstance;

        await tokens.mint({ to: [lp, trader], amount: fp(100) });

        boostedPool = await deployPool(mainToken.address, wrappedToken.address);
      });

      describe('asset managers', () => {
        it('sets the same asset manager for main and wrapped token', async () => {
          const BoostedPoolId = await boostedPool.getPoolId();

          const { assetManager: firstAssetManager } = await vault.getPoolTokenInfo(BoostedPoolId, tokens.first);
          const { assetManager: secondAssetManager } = await vault.getPoolTokenInfo(BoostedPoolId, tokens.second);

          expect(firstAssetManager).to.equal(secondAssetManager);
        });

        it('sets the no asset manager for the BPT', async () => {
          const BoostedPoolId = await boostedPool.getPoolId();
          const { assetManager } = await vault.instance.getPoolTokenInfo(BoostedPoolId, boostedPool.address);
          expect(assetManager).to.equal(ZERO_ADDRESS);
        });
      });

      describe('getWrappedTokenRate', () => {
        it('returns the expected value for 1:1', async () => {
          // Exchange rates are returned as uint256 scaled by 10**(18-8 + underlying token decimal)
          // First test will be a 1:1 exchange rate (1*10^(18-8+decimal))
          const scaledValue = 18 - 8 + boostedPool.mainToken.decimals;
          const mockExchange = bn(10 ** scaledValue);
          await mockLendingPool.setExchangeRateStored(mockExchange);
          expect(await boostedPool.getWrappedTokenRate()).to.be.eq(fp(1));

        });

        it('returns the expected value for 2:1', async () => {
          // We now double the reserve's normalised income to change the exchange rate to 2:1
          const scaledValue = 18 - 8 + boostedPool.mainToken.decimals;
          const doubleMockExchange = bn(2 * 10 ** scaledValue);
          await mockLendingPool.setExchangeRateStored(doubleMockExchange);
          expect(await boostedPool.getWrappedTokenRate()).to.be.eq(fp(2));
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
  }
});
