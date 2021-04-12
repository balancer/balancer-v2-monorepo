import { pick } from 'lodash';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { fp, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/deploy';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { toNormalizedWeights } from '@balancer-labs/v2-helpers/src/weights';
import { encodeJoinStablePool } from '@balancer-labs/v2-helpers/src/stablePoolEncoding';
import { encodeJoinWeightedPool } from '@balancer-labs/v2-helpers/src/weightedPoolEncoding';
import { deployPoolFromFactory, PoolName } from '@balancer-labs/v2-helpers/src/pools';
import { deploySortedTokens, mintTokens, TokenList } from '@balancer-labs/v2-helpers/src/tokens';

export const tokenSymbols = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH'];

export async function setupEnvironment(): Promise<{
  vault: Contract;
  tokens: TokenList;
  trader: SignerWithAddress;
}> {
  const { admin, creator, trader } = await getSigners();

  const weth = await deploy('WETH', { args: [admin.address] });

  const authorizer = await deploy('Authorizer', { args: [admin.address] });

  const vault = await deploy('Vault', { args: [authorizer.address, weth.address, 0, 0] });

  const tokens = await deploySortedTokens(tokenSymbols, Array(tokenSymbols.length).fill(18));

  const symbols = Object.keys(tokens);
  const tokenAddresses = symbols.map((symbol) => tokens[symbol].address);

  for (const symbol in tokens) {
    // creator tokens are used to initialize pools, but tokens are only minted when required
    await tokens[symbol].connect(creator).approve(vault.address, MAX_UINT256);

    // trader tokens are used to trade and not have non-zero balances
    await mintTokens(tokens, symbol, trader, 200e18);
    await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);
  }

  // deposit internal balance for trader to make it non-zero
  const transfers = [];

  for (let idx = 0; idx < tokenAddresses.length; ++idx) {
    transfers.push({
      kind: 0, // deposit
      asset: tokenAddresses[idx],
      amount: bn(100e18),
      sender: trader.address,
      recipient: trader.address,
    });
  }

  await vault.connect(trader).manageUserBalance(transfers);

  return { vault, tokens, trader };
}

export async function deployPool(vault: Contract, tokens: TokenList, poolName: PoolName): Promise<string> {
  const { admin, creator } = await getSigners();

  const symbols = Object.keys(tokens);

  const initialPoolBalance = bn(100e18);
  for (const symbol of symbols) {
    await mintTokens(tokens, symbol, creator, initialPoolBalance);
  }

  const tokenAddresses = symbols.map((symbol) => tokens[symbol].address);
  const swapFee = fp(0.02); // 2%

  let pool: Contract;
  let joinUserData: string;

  if (poolName == 'WeightedPool') {
    const weights = toNormalizedWeights(symbols.map(() => fp(1))); // Equal weights for all tokens

    pool = await deployPoolFromFactory(vault, admin, 'WeightedPool', {
      from: creator,
      parameters: [tokenAddresses, weights, swapFee],
    });

    joinUserData = encodeJoinWeightedPool({ kind: 'Init', amountsIn: tokenAddresses.map(() => initialPoolBalance) });
  } else if (poolName == 'StablePool') {
    const amplificationParameter = bn(50e18);

    pool = await deployPoolFromFactory(vault, admin, 'StablePool', {
      from: creator,
      parameters: [tokenAddresses, amplificationParameter, swapFee],
    });

    joinUserData = encodeJoinStablePool({ kind: 'Init', amountsIn: tokenAddresses.map(() => initialPoolBalance) });
  } else {
    throw new Error(`Unhandled pool: ${poolName}`);
  }

  const poolId = await pool.getPoolId();

  await vault.connect(creator).joinPool(poolId, creator.address, creator.address, {
    assets: tokenAddresses,
    maxAmountsIn: tokenAddresses.map(() => initialPoolBalance), // These end up being the actual join amounts
    fromInternalBalance: false,
    userData: joinUserData,
  });

  return poolId;
}

export async function getWeightedPool(
  vault: Contract,
  tokens: TokenList,
  size: number,
  offset?: number
): Promise<string> {
  return deployPool(vault, pickTokens(tokens, size, offset), 'WeightedPool');
}

export async function getStablePool(
  vault: Contract,
  tokens: TokenList,
  size: number,
  offset?: number
): Promise<string> {
  return deployPool(vault, pickTokens(tokens, size, offset), 'StablePool');
}

function pickTokens(tokens: TokenList, size: number, offset?: number): TokenList {
  return pick(tokens, tokenSymbols.slice(offset ?? 0, size + (offset ?? 0)));
}

export async function getSigners(): Promise<{
  admin: SignerWithAddress;
  creator: SignerWithAddress;
  trader: SignerWithAddress;
}> {
  const [, admin, creator, trader] = await ethers.getSigners();

  return { admin, creator, trader };
}

export function printGas(gas: number | BigNumber): string {
  if (typeof gas !== 'number') {
    gas = gas.toNumber();
  }

  return `${(gas / 1000).toFixed(1)}k`;
}
