import { ethers } from 'hardhat';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePhantomPool from '@balancer-labs/v2-helpers/src/models/pools/stable-phantom/StablePhantomPool';

let lp: SignerWithAddress,
  owner: SignerWithAddress,
  recipient: SignerWithAddress,
  admin: SignerWithAddress,
  other: SignerWithAddress;

sharedBeforeEach('setup signers', async () => {
  [, lp, owner, recipient, admin, other] = await ethers.getSigners();
});

it('Should not fail with STABLE_INVARIANT_DIDNT_CONVERGE', async () => {
  const tokenData = [
    { symbol: 'bb-yv-USDC', name: 'bb-yv-USDC', decimals: 18, priceRate: fp(1), cacheDuration: 1 },
    {
      symbol: 'bb-yv-FRAX',
      name: 'bb-yv-FRAX',
      decimals: 18,
      priceRate: fp(1),
      cacheDuration: 1,
    },
    { symbol: 'UST', name: 'UST', decimals: 6, priceRate: fp(1), cacheDuration: 0 },
    {
      symbol: 'bb-yv-fUSDT',
      name: 'bb-yv-fUSDT',
      decimals: 18,
      priceRate: fp(1),
      cacheDuration: 1,
    },
  ];
  const tokenList = await TokenList.create(tokenData);
  tokenList.sort();

  const sortedTokenData = tokenList.tokens.map((token) => tokenData.find((item) => item.symbol === token.symbol)!);

  const rateProviders = await Promise.all(
    sortedTokenData.map(async (tokenData) => {
      const rateProvider = await deploy('v2-pool-utils/MockRateProvider');
      await rateProvider.mockRate(tokenData.priceRate);

      return rateProvider;
    })
  );

  const pool = await StablePhantomPool.create({
    tokens: tokenList,
    rateProviders,
    tokenRateCacheDurations: sortedTokenData.map((token) => token.cacheDuration),
    owner,
    admin,
    swapFeePercentage: fp(0.006),
    amplificationParameter: bn(500),
  });

  const bptIndex = await pool.getBptIndex();
  const poolTokens = await pool.getTokens();

  await pool.init({
    initialBalances: poolTokens.tokens.map((address, index) => {
      if (index === bptIndex) {
        return 0;
      }

      const token = pool.tokens.tokens.find((token) => token.address.toLowerCase() === address.toLowerCase());

      return token?.symbol === 'UST' ? bn(200_000e6) : fp(200_000);
    }),
  });

  const bpt = await Token.deployedAt(poolTokens.tokens[bptIndex]);

  const ust = tokenList.tokens.find((token) => token.symbol === 'UST')!;
  await tokenList.mint({ to: lp, amount: fp(500_000) });
  await tokenList.approve({ from: lp, to: pool.vault });

  await pool.swapGivenIn({
    in: ust,
    out: bpt,
    amount: bn(4_070_000e6),
    from: lp,
    recipient: lp,
  });

  let i = 0;
  try {
    for (; i < 20; i++) {
      for (const token of tokenList.tokens) {
        if (token.symbol !== 'UST') {
          await pool.swapGivenIn({
            in: ust,
            out: token,
            amount: bn(10_000e6),
            from: lp,
            recipient: lp,
          });
        }
      }
    }
  } catch (e) {
    const balances = await pool.getBalances();
    console.log(`reverted after ${i} loops`);
    console.log(
      `token balances:`,
      balances.map((balance) => balance.toString())
    );
  }

  await pool.swapGivenIn({
    in: bpt,
    out: ust,
    amount: fp(1),
    from: lp,
    recipient: lp,
  });
});
