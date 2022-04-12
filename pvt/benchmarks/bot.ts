import { FundManagement } from '@balancer-labs/balancer-js/src/types';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { ethers } from 'hardhat';
import { fp, decimal, bn, printGas } from '@balancer-labs/v2-helpers/src/numbers';
import { calcOutGivenIn } from '@balancer-labs/v2-helpers/src/models/pools/weighted/math';
import * as expectEvent from '../helpers/src/test/expectEvent';
import { deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { kebabCase, range } from 'lodash';
import { PoolBalanceOpKind } from '@balancer-labs/balancer-js';
import { getUnpackedSettings } from 'http2';
import { BigNumber } from '@ethersproject/bignumber';
import fetch from 'node-fetch';
import { Contract } from '@ethersproject/contracts';
import { exit } from 'process';

// rDAI, WBTC, WETH
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const BAL = '0xba100000625a3754423978a60c9317c58a424e3d';
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';
const WBTC = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'; // 8 decimals
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // 6 decimals
const RAI = '0x03ab458634910aad20ef5f1c8ee96f1d6ac54919';
const UNI = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984';
const YFI = '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e';
const BED = '0x61d5dc44849c9c87b0856a2a311536205c96c7fd';
const UMA = '0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828';
const GRT = '0xc944e90c64b2c07662a292be6244bdf05cda44a7';
const AAVE = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';
const LINK = '0x514910771af9ca656af840dff83e8264ecf986ca';
const GNO = '0x6810e776880c02933d47db1b9fc05908e5386b96';
const RGT = '0xD291E7a03283640FDc51b121aC401383A46cC623';
const MKR = '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7'; // 6 decimals
const BANK = '0x2d94aa3e47d9d5024503ca8491fce9a2fb4da198';
const WDGLD = '0x123151402076fc819b7564510989e475c9cd93ca'; // 8 decimals
const ENJ = '0xf629cbd94d3791c9250152bd8dfbdf380e2a3b9c';
const NMR = '0x1776e1f26f98b1a5df9cd347953a26dd3cb46671';
const renBTC = '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d';
const sBTC = '0xfe18be6b3bd88a2d2a7f928d00292e7a9963cfc6';
const PAR = '0x68037790A0229e9Ce6EaA8A99ea92964106C4703';
const sEUR = '0xd71ecff9342a5ced620049e616c5035f1db98620';
const EURs = '0xdb25f211ab05b1c97d595516f45794528a807ad8'; // 2 decimals
const PERP = '0xbC396689893D065F41bc2C6EcbeE5e0085233447';

const VAULT = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
const WEIGHTED_POOL_FACTORY = '0x8E9aa87E45e92bad84D5F8DD1bff34Fb92637dE9';
const ORACLE_FACTORY = '0xA5bf2ddF098bb0Ef6d120C98217dD6B141c74EE0';
const STABLE_POOL_FACTORY = '0xc66Ba2B6595D3613CCab350C886aCE23866EDe24';
const LBP_FACTORY_KOVAN = '0xdAE7e32ADc5d490a43cCba1f0c736033F2b4eFca';
const GAUNTLET = '0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B';
const KOVAN_INVESTMENT_POOL_FACTORY = '0xb08E16cFc07C684dAA2f93C70323BAdb2A6CBFd2';

const SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-v2';

// const MAX = hre.ethers.constants.MaxUint256;
type PricePool = {
  tokenAddress: string;
  poolId: string;
};

type TokenName = {
  address: string;
  name: string;
};

const NAMES = new Map([
  [WETH, 'WETH'],
  [UMA, 'UMA'],
  [PAR, 'PAR'],
  [GRT, 'GRT'],
  [PERP, 'PERP'],
]);

// Initialize poolIds of price determinants
// i.e., token we have a low-slippage USDC price for
// token -> poolId

const UNIVERSE: PricePool[] = [
  { tokenAddress: WETH, poolId: '0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019' },
  { tokenAddress: UMA, poolId: '0xf5aaf7ee8c39b651cebf5f1f50c10631e78e0ef9000200000000000000000069' },
  { tokenAddress: PAR, poolId: '0x5d6e3d7632d6719e04ca162be652164bec1eaa6b000200000000000000000048' },
  { tokenAddress: GRT, poolId: '0x14462305d211c12a736986f4e8216e28c5ea7ab4000200000000000000000068' },
  { tokenAddress: PERP, poolId: '0xfa22ec1c02f121083bf04fbbcaad019f490d7a3000020000000000000000002a' },
];

// Helper functions

type SubgraphToken = {
  address: string;
  balance: string;
  symbol: string;
  decimals: number;
  weight: string;
};

interface SubgraphPoolBase {
  id: string;
  symbol: string;
  address: string;
  swapFee: string;
  tokens: SubgraphToken[];
  tokensList: string[];
}

async function fetchSubgraphPools(subgraphUrl: string): Promise<SubgraphPoolBase[]> {
  // can filter for publicSwap too??
  const query = `
    {
      pools(where:{poolType:"Weighted"}) {
        id
        symbol
        address
        swapFee
        tokens {
          address
          balance
          symbol
          decimals
          weight
        }
        tokensList
      }
    }
  `;

  console.log(`fetchSubgraphPools: ${subgraphUrl}`);
  const response = await fetch(subgraphUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
    }),
  });

  const { data } = await response.json();

  return data.pools ?? [];
}

async function calcAmountOut(
  vault: Contract,
  trader: SignerWithAddress,
  poolId: string,
  tokenIn: string,
  tokenInDecimals: number,
  tokenOut: string,
  tokenOutDecimals: number,
  amountIn: BigNumber
): Promise<BigNumber> {
  console.log(`IN! with ${poolId}`);
  const poolAddress = poolId.substring(0, 42);
  console.log(poolAddress);

  const pool = await deployedAt('v2-pool-weighted/WeightedPool', poolAddress);
  console.log('Got pool!');
  const weights = await pool.getNormalizedWeights();
  console.log(weights);

  const { tokens, balances } = await vault.connect(trader).getPoolTokens(poolId);
  console.log(tokens);

  const inIdx = tokens.indexOf(tokenIn);
  const inScale = 10 ** (18 - tokenInDecimals);
  const outIdx = tokens.indexOf(tokenOut);
  const outScale = 10 ** (18 - tokenOutDecimals);

  const amountOut = calcOutGivenIn(
    balances[inIdx].mul(inScale),
    weights[inIdx],
    balances[outIdx].mul(outScale),
    weights[outIdx],
    amountIn
  );
  return bn(amountOut);
}

async function main() {
  console.log('Starting');

  const [, , trader] = await ethers.getSigners();
  //const [, , , , , trader] = await ethers.getSigners();
  // Pick the account you want to deploy from
  // hardhat.config.ts defines the MNEMONIC seed
  const me = trader.address;

  // Identify the account
  console.log(`Using account: ${me}`);

  const pools = await fetchSubgraphPools(SUBGRAPH_URL);
  const originPools: SubgraphPoolBase[] = [];
  const destPools: SubgraphPoolBase[] = [];
  const counterParties = new Set();

  // key is the pool symbol; value is the set of symbol strings
  const poolToTokens = new Map();
  const tokenToPools = new Map();
  const destPoolSet = new Set();
  const poolToId = new Map();
  const tokenDecimals = new Map();
  const tokenAddresses = new Map();

  for (const idx in range(pools.length)) {
    const pool = pools[idx];
    const allTokens = new Set();

    for (const idy in range(pool.tokens.length)) {
      const symbol = pool.tokens[idy].symbol;
      allTokens.add(symbol);
      tokenAddresses.set(symbol, pool.tokens[idy].address);
      tokenDecimals.set(symbol, pool.tokens[idy].decimals);

      if (symbol == 'USDC') {
        originPools.push(pool);
      } else {
        counterParties.add(symbol);
      }
    }

    poolToTokens.set(pool.symbol, allTokens);
    poolToId.set(pool.symbol, pool.id);
  }

  // Invert poolToTokens
  poolToTokens.forEach((value, key) => {
    for (const token of value.values()) {
      if (tokenToPools.has(token)) {
        tokenToPools.set(token, tokenToPools.get(token).add(key));
      } else {
        const firstPool = new Set();
        firstPool.add(key);

        tokenToPools.set(token, firstPool);
      }
    }
  });

  //console.log(tokenToPools);
  //console.log(poolToTokens);

  for (const idx in range(pools.length)) {
    const pool = pools[idx];

    // Dest pools need to have a counter party token and either USDC/DAI/USDT

    let hasStable = false;
    let hasCounterParty = false;

    for (const idy in range(pool.tokens.length)) {
      const symbol = pool.tokens[idy].symbol;

      if (counterParties.has(symbol)) {
        hasCounterParty = true;
      }

      if (symbol == 'USDC' || symbol == 'DAI' || symbol == 'USDT') {
        hasStable = true;
      }
    }

    if (hasCounterParty && hasStable) {
      destPools.push(pool);
      destPoolSet.add(pool.symbol);
    }
  }

  console.log(`${originPools.length} origin pools:`);
  originPools.map((pool) => {
    let s = `${pool.symbol}: `;
    pool.tokens.map((token) => {
      s += `${token.symbol} `;
    });
    console.log(s);
  });

  console.log(`${destPools.length} dest pools:`);
  destPools.map((pool) => {
    let s = `${pool.symbol}: `;
    pool.tokens.map((token) => {
      s += `${token.symbol} `;
    });
    console.log(s);
  });

  // Now find all paths
  // pool 1, pool 2, tokenOut

  const paths = [];

  // Iterate over all the source pools - those are pool 1
  for (const idx in range(originPools.length)) {
    const pool1 = originPools[idx];
    // The counterparty tokens are the set in the pool - USDC
    const counterPartyTokens = poolToTokens.get(pool1.symbol);
    counterPartyTokens.delete('USDC');

    // For each counterparty token
    for (const token of counterPartyTokens.values()) {
      // find all pools that contain that token
      for (const pool2 of tokenToPools.get(token).values()) {
        // that are also destination pools
        if (destPoolSet.has(pool2)) {
          // pool 2 is the destPool - there could be multiple paths, if there are multiple stable coins

          if (poolToTokens.get(pool2).has('USDC')) {
            paths.push({ pool1: pool1.symbol, pool2: pool2, intermediateToken: token, tokenOut: 'USDC' });
            //console.log(`Path: ${pool1.symbol} -> ${pool2}, USDC`);
          }
          if (poolToTokens.get(pool2).has('DAI')) {
            paths.push({ pool1: pool1.symbol, pool2: pool2, intermediateToken: token, tokenOut: 'DAI' });
            //console.log(`Path: ${pool1.symbol} -> ${pool2}, DAI`);
          }
          if (poolToTokens.get(pool2).has('USDT')) {
            paths.push({ pool1: pool1.symbol, pool2: pool2, intermediateToken: token, tokenOut: 'USDT' });
            //console.log(`Path: ${pool1.symbol} -> ${pool2}, USDT`);
          }
        }
      }
    }
  }

  // Now check for profitability
  //console.log(paths);

  const vault = await deployedAt('v2-vault/Vault', VAULT);
  const usdcAddress = tokenAddresses.get('USDC');
  const usdcUpscale = bn(1e12);
  const usdcDownscale = bn(1e6);

  for (const i in range(paths.length)) {
    const path = paths[i];
    console.log(path);

    const interTokenAddress = tokenAddresses.get(path.intermediateToken);
    const interDecimals = tokenDecimals.get(path.intermediateToken);
    const outDecimals = tokenDecimals.get(path.tokenOut);

    let poolId = poolToId.get(path.pool1);
    let poolAddress = poolId.substring(0, 42);

    let pool = await deployedAt('v2-pool-weighted/WeightedPool', poolAddress);
    let weights = await pool.getNormalizedWeights();
    let { tokens, balances } = await vault.connect(trader).getPoolTokens(poolId);
    let compareTokens = tokens.map((token: string) => token.toLowerCase());

    let inIdx = compareTokens.indexOf(usdcAddress);
    let inScale = usdcUpscale;
    let outIdx = compareTokens.indexOf(interTokenAddress);
    let outScale = 10 ** (18 - interDecimals);

    const amountOut = calcOutGivenIn(
      balances[inIdx].mul(inScale),
      weights[inIdx],
      balances[outIdx].mul(outScale),
      weights[outIdx],
      bn(1000e6)
    );
    const scaledAmountOut = amountOut.div(usdcDownscale.toString());
    console.log(`1000 USDC = ${scaledAmountOut.toString()} ${path.intermediateToken}`);

    // 2nd hop
    poolId = poolToId.get(path.pool2);
    poolAddress = poolId.substring(0, 42);
    pool = await deployedAt('v2-pool-weighted/WeightedPool', poolAddress);
    weights = await pool.getNormalizedWeights();
    [tokens, balances] = await vault.connect(trader).getPoolTokens(poolId);
    compareTokens = tokens.map((token: string) => token.toLowerCase());

    inIdx = compareTokens.indexOf(interTokenAddress);
    inScale = bn(10 ** (18 - interDecimals));
    outIdx = compareTokens.indexOf(tokenAddresses.get(path.tokenOut));
    outScale = 10 ** (18 - outDecimals);

    const finalAmountOut = calcOutGivenIn(
      balances[inIdx].mul(inScale),
      weights[inIdx],
      balances[outIdx].mul(outScale),
      weights[outIdx],
      bn(amountOut)
    );
    const scaledFinalAmountOut = finalAmountOut.div(usdcDownscale.toString());
    console.log(`Final amount out = ${scaledFinalAmountOut.toString()} ${path.tokenOut}`);

    const numericResult = scaledFinalAmountOut.toNumber();
    const percent = ((numericResult - 1000.0) / 1000.0) * 100;

    if (scaledFinalAmountOut.toNumber() > 1000) {
      if (percent >= 3) {
        console.log('Opportunity!');
        console.log(poolToId.get(path.pool1));
        console.log(poolToId.get(path.pool2));
        break;
      } else {
        console.log('Not enough profit');
      }
    } else {
      console.log('Loses money');
    }
  }

  /*paths.map(async (path) => {
    console.log(path);

    const interToken = path.intermediateToken;

    const poolAddress = poolToId.get(path.pool1).substring(0, 42);
    console.log(poolAddress);
  
    const pool = await deployedAt('v2-pool-weighted/WeightedPool', poolAddress);
    console.log('Got pool!');
    const weights = await pool.getNormalizedWeights();
    console.log(weights);
  
    //const amountOut = await calcAmountOut(vault, trader, poolToId.get(path.pool1), 'USDC', 6, interToken, tokenDecimals.get(interToken), bn(1000e6));
    //console.log(amountOut.toString());
    
    //console.log(`calcOutGivenIn(${poolToAddress.get(path.pool1)}, USDC, 6, ${interToken}, ${tokenDecimals.get(interToken)}, 1000)`);
    //console.log(`calcOutGivenIn(${poolToAddress.get(path.pool2)}, ${interToken}, ${tokenDecimals.get(interToken)}, ${path.tokenOut}, ${tokenDecimals.get(path.tokenOut)}, x)`);
  });*/

  // need a calcOutGivenIn(poolAddress, tokenIn, tokenInDecimals, tokenOut, tokenOutDecimals)
  // calcOutGivenIn(pool1.address, 'USDC', 6, intermediateToken, )
  // Execute if profitable

  const usdcScalingFactor = bn(1e12);
  const unscaledPurchaseAmount = bn(1000e6);

  /*for (let idx in range(UNIVERSE.length)) {
    //const poolAddress = UNIVERSE[idx].poolId.substring(0, 42);
    //const pool = await deployedAt('v2-pool-weighted/WeightedPool', poolAddress);

    const { tokens, balances, } = await vault.connect(trader).getPoolTokens(UNIVERSE[idx].poolId);
    const poolAddress = UNIVERSE[idx].poolId.substring(0, 42);
    const pool = await deployedAt('v2-pool-weighted/WeightedPool', poolAddress);
    const weights = await pool.getNormalizedWeights();

    const tokenSymbol = NAMES.get(UNIVERSE[idx].tokenAddress);

    console.log(poolAddress);
    //console.log(tokens);

    const weightsStr = weights.map((weight: BigNumber) => {
      return weight.toString();
    });
    //console.log(`Weights: ${weightsStr}`);
    const balancesStr = balances.map((balance: BigNumber) => {
      return balance.toString();
    });
    //console.log(`Balances: ${balancesStr}`);

    const inIdx = tokens[0].toLowerCase() == USDC ? 0 : 1;
    const outIdx = inIdx == 0 ? 1 : 0;

    const inScale = tokens[inIdx].toLowerCase() == USDC ? usdcScalingFactor : 1;
    const outScale = tokens[outIdx].toLowerCase() == USDC ? usdcScalingFactor : 1;
 
    /*console.log(inIdx);
    console.log(outIdx);
    console.log(balances[inIdx].mul(inScale).toString());
    console.log(balances[outIdx].mul(outScale).toString());

    const amountOut = calcOutGivenIn(balances[inIdx].mul(inScale),
                                     weights[inIdx],
                                     balances[outIdx].mul(outScale),
                                     weights[outIdx],
                                     unscaledPurchaseAmount);
    const price = 1.0 / amountOut.div(unscaledPurchaseAmount.toString()).toNumber();
    console.log(`${tokenSymbol} costs ${price}`);
    tokenPrices.set(tokenSymbol, price);
  }*/
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
