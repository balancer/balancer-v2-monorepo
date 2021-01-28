import { pick } from 'lodash';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { fp, bn } from '../../helpers/numbers';
import { deploy } from '../../helpers/deploy';
import { MAX_UINT256 } from '../../helpers/constants';
import { encodeJoinStablePool } from '../../helpers/stablePoolEncoding';
import { encodeJoinWeightedPool } from '../../helpers/weightedPoolEncoding';
import { bn } from '../../helpers/numbers';
import { deployPoolFromFactory, PoolName } from '../../helpers/pools';
import { deploySortedTokens, mintTokens, TokenList } from '../../helpers/tokens';

export const tokenSymbols = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH'];

export async function setupEnvironment(): Promise<{
  vault: Contract;
  validator: Contract;
  tokens: TokenList;
  trader: SignerWithAddress;
}> {
  const { admin, creator, trader } = await getSigners();

  const authorizer = await deploy('Authorizer', { args: [admin.address] });
  const vault = await deploy('Vault', { args: [authorizer.address] });

  const validator = await deploy('OneToOneSwapValidator', { args: [] });

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
  await vault
    .connect(trader)
    .depositToInternalBalance(tokenAddresses, Array(tokenAddresses.length).fill(bn(1e18)), trader.address);

  return { vault, validator, tokens, trader };
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
    const weights = symbols.map(() => fp(1)); // Equal weights for all tokens

    pool = await deployPoolFromFactory(vault, admin, 'WeightedPool', {
      from: creator,
      parameters: [tokenAddresses, weights, swapFee],
    });

    joinUserData = encodeJoinWeightedPool({ kind: 'Init' });
  } else if (poolName == 'StablePool') {
    const amp = bn(30e18);

    pool = await deployPoolFromFactory(vault, admin, 'StablePool', {
      from: creator,
      parameters: [tokenAddresses, amp, swapFee],
    });

    joinUserData = encodeJoinStablePool({ kind: 'Init' });
  } else {
    throw new Error(`Unhandled pool: ${poolName}`);
  }

  const poolId = await pool.getPoolId();

  await vault.connect(creator).joinPool(
    poolId,
    creator.address,
    tokenAddresses,
    tokenAddresses.map(() => initialPoolBalance), // These end up being the actual join amounts
    false,
    joinUserData
  );

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
