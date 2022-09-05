import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { RawStablePoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/stable/types';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';

describe('ComposableStablePoolIntegration', () => {
  let lp: SignerWithAddress, owner: SignerWithAddress, admin: SignerWithAddress, other: SignerWithAddress;

  sharedBeforeEach('setup signers', async () => {
    [, lp, owner, admin, other] = await ethers.getSigners();
  });

  context('for a 2 token pool', () => {
    itPerformsIntegrationTests(2);
  });

  context('for a 3 token pool', () => {
    itPerformsIntegrationTests(3);
  });

  context('for a 4 token pool', () => {
    itPerformsIntegrationTests(4);
  });

  context('for a 5 token pool', () => {
    itPerformsIntegrationTests(5);
  });

  function itPerformsIntegrationTests(totalTokens: number) {
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

    describe('protocol fee minting vs value extraction', () => {
      let equalBalances: BigNumber[];
      let poolNested: StablePool;
      let otherToken: Token;

      sharedBeforeEach('deploy primary pool', async () => {
        await deployPool(totalTokens, { swapFeePercentage });
        await pool.vault.setSwapFeePercentage(protocolFeePercentage);

        // Init pool with equal balances so that each BPT accounts for approximately one underlying token.
        equalBalances = Array.from({ length: totalTokens + 1 }).map((_, i) => (i == bptIndex ? bn(0) : fp(100)));
        await pool.init({ recipient: lp.address, initialBalances: equalBalances });

        await pool.updateProtocolFeePercentageCache();
      });

      sharedBeforeEach('deploy nested pool', async () => {
        otherToken = await Token.create({ symbol: 'OTHER-TOKEN' });
        const tokensNested = new TokenList([pool.bpt, otherToken]).sort();
        const rateProvider: Contract = await deploy('v2-pool-utils/MockRateProvider');

        poolNested = await StablePool.create({
          tokens: tokensNested,
          rateProviders: tokensNested.map((token) => (token.address === pool.bpt.address ? pool : rateProvider)),
          tokenRateCacheDurations: [0, 0],
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

      it('a balanced downstream join should not impact swap amount out on the parent pool', async () => {
        // Accrue protocol fees in the downstream pool
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

        // Swap in the nested pool
        const firstSwap = await poolNested.swapGivenIn({
          in: pool.bpt,
          out: otherToken,
          amount: fp(1),
          from: lp,
          recipient: lp,
        });

        // Query the reverse swap in the nested pool
        const secondSwapQuery = await poolNested.querySwapGivenIn({
          in: otherToken,
          out: pool.bpt,
          amount: firstSwap.amountOut,
          from: lp,
          recipient: lp,
        });

        // Join the downstream pool proportionally, triggering minting protocol fee BPT, but otherwise not accruing any
        // further fees (and therefore not changing the value of the BPT).
        const { balances: unscaledBalances } = await pool.getTokens();
        const amountsIn = unscaledBalances.map((balance, i) => (i == bptIndex ? bn(0) : balance.div(100)));
        await pool.joinGivenIn({ from: other, amountsIn });

        // Perform the queried reverse swap in the nested pool
        const secondSwap = await poolNested.swapGivenIn({
          in: otherToken,
          out: pool.bpt,
          amount: firstSwap.amountOut,
          from: lp,
          recipient: lp,
        });

        // The query should match the swap, since the value of the underlying BPT did not change
        expect(secondSwapQuery).to.be.almostEqual(secondSwap.amountOut, 1e-12);
      });
    });
  }
});
