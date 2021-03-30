// helpers for handling the allPools.json file in this dir
import { BigNumber, utils } from 'ethers';
import { flatMap } from 'lodash';

export interface Pool {
  id: string;
  finalized: boolean;
  publicSwap: boolean;
  liquidity: number;
  swapFee: BigNumber;
  totalWeight: BigNumber;
  tokens: Token[];
  tokensList: string[];
}

interface Token {
  address: string;
  symbol: string;
  name: string;
  balance: BigNumber;
  decimals: number;
  denormWeight: BigNumber;
}

interface TokenJSON {
  address: string;
  balance: string;
  decimals: number;
  denormWeight: string;
  name: string;
  symbol: string;
}

interface PoolJSON {
  id: string;
  finalized: boolean;
  publicSwap: boolean;
  liquidity: string;
  swapFee: string;
  totalWeight: string;
  tokens: TokenJSON[];
  tokensList: string[];
}

interface allPoolsJSON {
  pools: PoolJSON[];
}

// Convert all pools to BigNumber/scaled format
export function formatPools(allPools: allPoolsJSON): Pool[] {
  const formattedPools: Pool[] = [];
  for (let i = 0; i < allPools.pools.length; i++) {
    if (allPools.pools[i].tokens.length < 2) {
      continue;
    }

    const tokens: Token[] = [];
    const pool: Pool = {
      id: allPools.pools[i].id,
      finalized: allPools.pools[i].finalized,
      publicSwap: allPools.pools[i].publicSwap,
      liquidity: Number(allPools.pools[i].liquidity),
      swapFee: utils.parseUnits(allPools.pools[i].swapFee, 18),
      totalWeight: utils.parseUnits(allPools.pools[i].totalWeight, 18),
      tokens: tokens,
      tokensList: allPools.pools[i].tokensList,
    };

    // For each token in pool convert weights/decimals and scale balances
    pool.tokens = allPools.pools[i].tokens.map((t) => ({
      balance: utils.parseUnits(t.balance, Number(t.decimals)),
      decimals: Number(t.decimals),
      denormWeight: utils.parseUnits(t.denormWeight, 18),
      symbol: t.symbol,
      name: t.name,
      address: t.address,
    }));

    formattedPools.push(pool);
  }

  return formattedPools;
}

// Find array of token symbols, decimals and total balances for pools of interest
export function getTokenInfoForDeploy(pools: Pool[]): [Array<string>, Array<number>, Array<BigNumber>] {
  const symbols: Array<string> = [];
  const decimals: Array<number> = [];
  const balanceArray: Array<BigNumber> = [];
  const balances: { [sym: string]: BigNumber } = {};
  const tokensBySymbol: { [sym: string]: Token } = {};

  const tokens: Token[] = flatMap(pools, (p: Pool) => p.tokens);

  // for each pool check tokens, if not exists add to list
  tokens.forEach((token: Token) => {
    const tokenSymbol = token.symbol;
    if (!tokensBySymbol[tokenSymbol]) tokensBySymbol[tokenSymbol] = token;

    if (!balances[tokenSymbol]) balances[tokenSymbol] = token.balance;
    else {
      if (token.address != tokensBySymbol[tokenSymbol].address) {
        throw 'multiple tokens with same symbol';
      }
      balances[tokenSymbol] = balances[tokenSymbol].add(token.balance);
    }
  });

  for (const sym in tokensBySymbol) {
    symbols.push(sym);
    decimals.push(tokensBySymbol[sym].decimals);
    balanceArray.push(balances[sym]);
  }

  return [symbols, decimals, balanceArray];
}
