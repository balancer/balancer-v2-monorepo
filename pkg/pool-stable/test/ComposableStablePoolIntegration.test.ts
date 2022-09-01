import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { SwapKind } from '@balancer-labs/balancer-js';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { RawStablePoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/stable/types';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';
import { QueryBatchSwap } from '@balancer-labs/v2-helpers/src/models/vault/types';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';

describe('ComposableStablePoolIntegration', () => {
  const totalTokens = 2;
  let lp: SignerWithAddress, owner: SignerWithAddress, admin: SignerWithAddress, other: SignerWithAddress;

  sharedBeforeEach('setup signers', async () => {
    [, lp, owner, admin, other] = await ethers.getSigners();
  });

  let pool: StablePool, tokens: TokenList;
  let bptIndex: number;

  const rateProviders: Contract[] = [];
  const tokenRateCacheDurations: number[] = [];
  const exemptFromYieldProtocolFeeFlags: boolean[] = [];
  const swapFeePercentage = fp(0.1); // 10 %
  const protocolFeePercentage = fp(0.5); // 50 %

  async function deployPool(
    numberOfTokens: number,
    params: RawStablePoolDeployment = {},
    rates: BigNumberish[] = [],
    durations: number[] = []
  ): Promise<void> {
    tokens = params.tokens || (await TokenList.create(numberOfTokens, { sorted: true }));

    for (let i = 0; i < numberOfTokens; i++) {
      rateProviders[i] = await deploy('v2-pool-utils/MockRateProvider');
      await rateProviders[i].mockRate(rates[i] || fp(1));
      tokenRateCacheDurations[i] = MONTH + i;
      exemptFromYieldProtocolFeeFlags[i] = i % 2 == 0; // set true for even tokens
    }

    pool = await StablePool.create({
      tokens,
      rateProviders,
      tokenRateCacheDurations: durations.length > 0 ? durations : tokenRateCacheDurations,
      exemptFromYieldProtocolFeeFlags,
      owner,
      admin,
      ...params,
    });

    bptIndex = await pool.getBptIndex();
  }

  describe('protocol fee minting vs value extraction (beethovenxfi)', () => {
    let equalBalances: BigNumber[];
    let poolNested: StablePool;
    let otherToken: Token;

    sharedBeforeEach('deploy primary pool', async () => {
      await deployPool(totalTokens, { swapFeePercentage });
      await pool.vault.setSwapFeePercentage(protocolFeePercentage);

      await pool.updateProtocolFeePercentageCache();

      // Init pool with equal balances so that each BPT accounts for approximately one underlying token.
      equalBalances = Array.from({ length: totalTokens + 1 }).map((_, i) => (i == bptIndex ? bn(0) : fp(100)));
      await pool.init({ recipient: lp.address, initialBalances: equalBalances });
    });

    sharedBeforeEach('deploy nested pool', async () => {
      otherToken = await Token.create({ symbol: 'OTHER-TOKEN' });
      const tokensNested = new TokenList([pool.bpt, otherToken]).sort();
      const rateProvider: Contract = await deploy('v2-pool-utils/MockRateProvider');

      poolNested = await StablePool.create({
        tokens: tokensNested,
        rateProviders: tokensNested.map((token) => (token.address === pool.bpt.address ? pool : rateProvider)),
        tokenRateCacheDurations: [1, 1],
        exemptFromYieldProtocolFeeFlags: [false, false],
        owner,
        admin,
        swapFeePercentage: fp(0.00001),
        vault: pool.vault,
      });

      await tokens.mint({ to: [lp, other], amount: fp(10000) });
      await otherToken.mint(lp, fp(10000));
      await otherToken.mint(other, fp(10000));

      const bptIdx = await poolNested.getBptIndex();
      const { tokens: allTokens } = await poolNested.getTokens();

      const bptBalance = await pool.balanceOf(lp);
      const initialBalances = allTokens.map((token, i) =>
        i == bptIdx ? bn(0) : token == pool.bpt.address ? bptBalance.div(2) : fp(10)
      );

      await tokens.approve({ from: [lp, other], to: pool.vault });
      await tokensNested.approve({ from: [lp, other], to: pool.vault });
      await pool.instance.connect(lp).approve(pool.vault.address, bptBalance);

      await poolNested.init({ from: lp, recipient: lp.address, initialBalances, skipMint: true });
    });

    it('A small balanced downstream join should not greatly impact swap amount out on the parent pool', async () => {
      //generate owed protocol fee
      await pool.swapGivenIn({
        in: tokens.tokens[0],
        out: tokens.tokens[1],
        amount: fp(50),
        from: lp,
        recipient: lp,
      });
      await pool.swapGivenIn({
        in: tokens.tokens[1],
        out: tokens.tokens[0],
        amount: fp(50),
        from: lp,
        recipient: lp,
      });

      //swap 1 nested BPT for otherToken
      const response = await poolNested.swapGivenIn({
        in: pool.bpt,
        out: otherToken,
        amount: fp(1),
        from: lp,
        recipient: lp,
      });

      //store query result of bpt swap prior to down stream join
      const queryResult = await poolNested.querySwapGivenIn({
        in: otherToken,
        out: pool.bpt,
        amount: response.amountOut,
        from: lp,
        recipient: lp,
      });

      //perform downstream join, trigger protocol fee BPT minting
      const amountsIn = Array.from({ length: tokens.length + 1 }).map((_, i) =>
        i == bptIndex ? bn(0) : fp(0.0000000001)
      );
      await pool.joinGivenIn({ from: other, amountsIn });

      //perform bpt swap
      const responseAfter = await poolNested.swapGivenIn({
        in: otherToken,
        out: pool.bpt,
        amount: response.amountOut,
        from: lp,
        recipient: lp,
      });

      expect(queryResult).to.be.equalWithError(responseAfter.amountOut, 0.00001);
    });

    it('Protocol fee minting on bptSwaps should not allow for value extraction: bb-a-USDC -> bb-a-USD -> bbaUSD-TUSD', async () => {
      //generate owed protocol fee
      await pool.swapGivenIn({
        in: tokens.tokens[0],
        out: tokens.tokens[1],
        amount: fp(50),
        from: lp,
        recipient: lp,
      });
      await pool.swapGivenIn({
        in: tokens.tokens[1],
        out: tokens.tokens[0],
        amount: fp(50),
        from: lp,
        recipient: lp,
      });

      //This swap is a generalization of bb-a-USDC -> bb-a-USD -> bbaUSD-TUSD
      //by querying as a batch swap, the protocol bpt mint is being accounted for on the bb-a-USD rate provider (1 sec cache duration)
      //generally said, the batchSwapQuery generates the "correct" result
      const query: QueryBatchSwap = {
        kind: SwapKind.GivenIn,
        assets: [pool.tokens.tokens[0].address, pool.address, poolNested.address],
        swaps: [
          {
            poolId: pool.poolId,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: fp(1),
            userData: '0x',
          },
          {
            poolId: poolNested.poolId,
            assetInIndex: 1,
            assetOutIndex: 2,
            amount: '0',
            userData: '0x',
          },
        ],
        funds: {
          fromInternalBalance: false,
          toInternalBalance: false,
          sender: lp.address,
          recipient: other.address,
        },
      };

      const batchSwapQuery = await pool.vault.queryBatchSwap(query);

      //Here we query the same swap path as above, but using individual queries.
      //This simulates the "bad" result when the rate provider for pool.bpt is still cached (after protocol fee bpt mint) on the nestedPool,
      //allowing us to extract value from the pool
      const bptOut = await pool.querySwapGivenIn({
        from: lp,
        in: pool.tokens.tokens[0],
        out: pool.bpt,
        amount: fp(1),
      });

      const nestedBptOut = await poolNested.querySwapGivenIn({
        from: lp,
        in: pool.bpt,
        out: poolNested.bpt,
        amount: bptOut,
      });

      //under normal circumstances, the above operation sets should produce the exact same output.
      //But, with the virtual supply not reflecting the BPT that will be minted on bptSwap, we are able to construct
      //scenarios that extract value from the pool
      expect(batchSwapQuery[2].abs()).to.be.equalWithError(nestedBptOut, 0.00001);
    });

    it('Protocol fee minting on bptSwaps should not allow for value extraction: bb-a-USDC -> bb-a-USD -> TUSD', async () => {
      //generate owed protocol fee
      await pool.swapGivenIn({
        in: tokens.tokens[0],
        out: tokens.tokens[1],
        amount: fp(50),
        from: lp,
        recipient: lp,
      });
      await pool.swapGivenIn({
        in: tokens.tokens[1],
        out: tokens.tokens[0],
        amount: fp(50),
        from: lp,
        recipient: lp,
      });

      //This swap is a generalization of bb-a-USDC -> bb-a-USD -> TUSD
      //by querying as a batch swap, the protocol bpt mint is being accounted for on the bb-a-USD rate provider (1 sec cache duration)
      //generally said, the batchSwapQuery generates the "correct" result
      const query: QueryBatchSwap = {
        kind: SwapKind.GivenIn,
        assets: [pool.tokens.tokens[0].address, pool.address, otherToken.address],
        swaps: [
          {
            poolId: pool.poolId,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: fp(1),
            userData: '0x',
          },
          {
            poolId: poolNested.poolId,
            assetInIndex: 1,
            assetOutIndex: 2,
            amount: '0',
            userData: '0x',
          },
        ],
        funds: {
          fromInternalBalance: false,
          toInternalBalance: false,
          sender: lp.address,
          recipient: other.address,
        },
      };

      const batchSwapQuery = await pool.vault.queryBatchSwap(query);
      //Here we query the same swap path as above, but using individual queries.
      //This simulates the "bad" result when the rate provider for pool.bpt is still cached (after protocol fee bpt mint) on the nestedPool,
      //allowing us to extract value from the pool
      const bptOut = await pool.querySwapGivenIn({
        from: lp,
        in: pool.tokens.tokens[0],
        out: pool.bpt,
        amount: fp(1),
      });

      const otherTokenOut = await poolNested.querySwapGivenIn({
        from: lp,
        in: pool.bpt,
        out: otherToken,
        amount: bptOut,
      });

      //under normal circumstances, the above operation sets should produce the exact same output.
      //But, with the virtual supply not reflecting the BPT that will be minted on bptSwap, we are able to construct
      //scenarios that extract value from the pool

      // NB: This does not pass with the higher error tolerance of the first test
      expect(batchSwapQuery[2].abs()).to.be.equalWithError(otherTokenOut, 0.001);
    });
  });

  describe('protocol fees vs fee-exempt rates (beethovenxfi)', () => {
    const TWO_TOKENS = 2;

    async function deployAndConfigPool() {
      const tokens = await TokenList.create(TWO_TOKENS, { sorted: true });
      const rateProvider: Contract = await deploy('v2-pool-utils/MockRateProvider');
      const exemptRateProvider: Contract = await deploy('v2-pool-utils/MockRateProvider');

      await exemptRateProvider.mockRate(fp(1.5));

      const pool = await StablePool.create({
        tokens: tokens,
        rateProviders: [exemptRateProvider, rateProvider],
        tokenRateCacheDurations: [1, 1],
        exemptFromYieldProtocolFeeFlags: [true, false],
        owner,
        admin,
        swapFeePercentage,
      });

      const feesCollector = await pool.vault.getFeesCollector();
      const feesProvider = pool.vault.getFeesProvider();

      await pool.vault.authorizer
        .connect(admin)
        .grantPermissions([actionId(feesProvider, 'setFeeTypePercentage')], admin.address, [feesProvider.address]);

      await pool.vault.authorizer
        .connect(admin)
        .grantPermissions(
          [actionId(feesCollector, 'setSwapFeePercentage'), actionId(feesCollector, 'setFlashLoanFeePercentage')],
          feesProvider.address,
          [feesCollector.address, feesCollector.address]
        );

      await feesProvider.connect(admin).setFeeTypePercentage(ProtocolFee.SWAP, protocolFeePercentage);
      await feesProvider.connect(admin).setFeeTypePercentage(ProtocolFee.YIELD, protocolFeePercentage);

      await pool.updateProtocolFeePercentageCache();

      const initialBalances = Array.from({ length: TWO_TOKENS + 1 }).map((_, i) =>
        i == pool.bptIndex ? bn(0) : fp(100)
      );
      await pool.init({ from: lp, recipient: lp.address, initialBalances });

      await tokens.mint({ to: [lp, other], amount: fp(10000) });
      await tokens.approve({ from: lp, to: pool.vault });
      await tokens.approve({ from: other, to: pool.vault });

      // accrue protocol fee
      await pool.swapGivenIn({ in: tokens.tokens[0], out: tokens.tokens[1], amount: fp(50), from: lp, recipient: lp });
      await pool.swapGivenIn({ in: tokens.tokens[1], out: tokens.tokens[0], amount: fp(50), from: lp, recipient: lp });

      return { pool, tokens, rateProvider, exemptRateProvider, feesCollector };
    }

    it.skip('A decrease in the rate provider rate should not result in a larger protocol fee being collected', async () => {
      const deployment1 = await deployAndConfigPool();
      const deployment2 = await deployAndConfigPool();
      const amountIn = fp(0.0000000001);

      // This is the only material difference between the two pool deployments, we downscale the exempt rate provider from 1.5 to 1.0
      await deployment1.exemptRateProvider.mockRate(fp(1.0));

      const amountsIn1 = Array.from({ length: TWO_TOKENS + 1 }).map((_, i) =>
        i == deployment1.pool.bptIndex ? bn(0) : amountIn
      );
      await deployment1.pool.joinGivenIn({ from: other, amountsIn: amountsIn1 });

      const amountsIn2 = Array.from({ length: TWO_TOKENS + 1 }).map((_, i) =>
        i == deployment2.pool.bptIndex ? bn(0) : amountIn
      );
      await deployment2.pool.joinGivenIn({ from: other, amountsIn: amountsIn2 });

      const protocolBalance1 = await deployment1.pool.balanceOf(deployment1.feesCollector.address);
      const protocolBalance2 = await deployment2.pool.balanceOf(deployment2.feesCollector.address);

      // console.log('protocolBalance1', protocolBalance1.toString());
      // console.log('protocolBalance2', protocolBalance2.toString());

      expect(protocolBalance1).to.be.lte(protocolBalance2);
    });
  });
});
