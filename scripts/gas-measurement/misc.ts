import { deploy } from '../helpers/deploy';
import { ethers } from 'hardhat';
import { deployTokens, mintTokens, TokenList } from '../../test/helpers/tokens';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256 } from '../../test/helpers/constants';
import { deployPoolFromFactory, PoolName } from '../helpers/pools';
import { toFixedPoint } from '../helpers/fixedPoint';
import { pick } from 'lodash';

export const tokenSymbols = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH'];

export async function setupEnvironment(): Promise<{
  vault: Contract;
  validator: Contract;
  tokens: TokenList;
  trader: SignerWithAddress;
}> {
  const { admin, trader, creator } = await getSigners();

  const authorizer = await deploy('Authorizer', { args: [admin.address] });
  const vault = await deploy('Vault', { args: [authorizer.address] });

  const validator = await deploy('OneToOneSwapValidator', { args: [] });

  const tokens = await deployTokens(tokenSymbols, Array(tokenSymbols.length).fill(18));

  for (const symbol in tokens) {
    // creator tokens are used to add liquidity to pools, but minted when required
    await tokens[symbol].connect(creator).approve(vault.address, MAX_UINT256);

    // trader tokens are used to trade and not have non-zero balances
    await mintTokens(tokens, symbol, trader, 200e18);
    await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);

    // deposit internal balance for trader to make it non-zero
    await vault.connect(trader).depositToInternalBalance(tokens[symbol].address, (1e18).toString(), trader.address);
  }

  return { vault, validator, tokens, trader };
}

export async function deployPool(vault: Contract, tokens: TokenList, poolName: PoolName): Promise<string> {
  const { admin, creator } = await getSigners();

  const symbols = Object.keys(tokens);

  const tokenBalance = (100e18).toString();
  for (const symbol of symbols) {
    await mintTokens(tokens, symbol, creator, tokenBalance);
  }

  const initialBPT = (100e18).toString();
  const tokenAddresses = symbols.map((symbol) => tokens[symbol].address);
  const initialBalances = symbols.map(() => tokenBalance);

  const swapFee = toFixedPoint(0.02); // 2%

  let pool: Contract;

  if (poolName == 'WeightedPool') {
    const weights = symbols.map(() => toFixedPoint(1)); // Equal weights for all tokens

    pool = await deployPoolFromFactory(vault, admin, 'WeightedPool', {
      from: creator,
      parameters: [initialBPT, tokenAddresses, initialBalances, weights, swapFee],
    });
  } else if (poolName == 'StablePool') {
    const amp = (30e18).toString();

    pool = await deployPoolFromFactory(vault, admin, 'StablePool', {
      from: creator,
      parameters: [initialBPT, tokenAddresses, initialBalances, amp, swapFee],
    });
  } else {
    throw new Error(`Unhandled pool: ${poolName}`);
  }

  return pool.getPoolId();
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

async function getSigners(): Promise<{
  admin: SignerWithAddress;
  trader: SignerWithAddress;
  creator: SignerWithAddress;
}> {
  const [, admin, trader, creator] = await ethers.getSigners();

  return { admin, trader, creator };
}

export function printGas(gas: number | BigNumber): string {
  if (typeof gas !== 'number') {
    gas = gas.toNumber();
  }

  return `${(gas / 1000).toFixed(1)}k`;
}
