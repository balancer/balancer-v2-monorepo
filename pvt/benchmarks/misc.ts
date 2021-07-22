import { pick } from 'lodash';
import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { StablePoolEncoder, toNormalizedWeights, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { deploySortedTokens, mintTokens, TokenList } from '@balancer-labs/v2-helpers/src/tokens';
import { advanceTime, MONTH } from '@balancer-labs/v2-helpers/src/time';

export const tokenSymbols = [
  'AAA',
  'BBB',
  'CCC',
  'DDD',
  'EEE',
  'FFF',
  'GGG',
  'HHH',
  'III',
  'JJJ',
  'KKK',
  'LLL',
  'MMM',
  'NNN',
  'OOO',
  'PPP',
  'QQQ',
  'RRR',
  'SSS',
  'TTT',
];

export async function setupEnvironment(): Promise<{
  vault: Contract;
  tokens: TokenList;
  trader: SignerWithAddress;
}> {
  const { admin, creator, trader } = await getSigners();

  const weth = await deploy('v2-standalone-utils/TestWETH', { args: [admin.address] });

  const authorizer = await deploy('v2-vault/Authorizer', { args: [admin.address] });

  const vault = await deploy('v2-vault/Vault', { args: [authorizer.address, weth.address, 0, 0] });

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
  const { creator } = await getSigners();

  const symbols = Object.keys(tokens);

  const initialPoolBalance = bn(100e18);
  for (const symbol of symbols) {
    await mintTokens(tokens, symbol, creator, initialPoolBalance);
  }

  const tokenAddresses = symbols.map((symbol) => tokens[symbol].address);
  const swapFeePercentage = fp(0.02); // 2%

  let pool: Contract;
  let joinUserData: string;

  if (poolName == 'WeightedPool' || poolName == 'WeightedPool2Tokens') {
    const weights = toNormalizedWeights(symbols.map(() => fp(1))); // Equal weights for all tokens
    const assetManagers = Array(weights.length).fill(ZERO_ADDRESS);

    const params =
      poolName == 'WeightedPool2Tokens'
        ? [tokenAddresses, weights, swapFeePercentage, true]
        : [tokenAddresses, weights, assetManagers, swapFeePercentage];
    pool = await deployPoolFromFactory(vault, poolName, {
      from: creator,
      parameters: params,
    });

    joinUserData = WeightedPoolEncoder.joinInit(tokenAddresses.map(() => initialPoolBalance));
  } else if (poolName == 'StablePool') {
    const amplificationParameter = bn(50);

    pool = await deployPoolFromFactory(vault, poolName, {
      from: creator,
      parameters: [tokenAddresses, amplificationParameter, swapFeePercentage],
    });

    joinUserData = StablePoolEncoder.joinInit(tokenAddresses.map(() => initialPoolBalance));
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

  // Force test to skip pause window
  await advanceTime(MONTH * 5);

  return poolId;
}

export async function getWeightedPool(
  vault: Contract,
  tokens: TokenList,
  size: number,
  offset?: number
): Promise<string> {
  return size === 2
    ? deployPool(vault, pickTokens(tokens, size, offset), 'WeightedPool2Tokens')
    : deployPool(vault, pickTokens(tokens, size, offset), 'WeightedPool');
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

export function pickTokenAddresses(tokens: TokenList, size: number, offset?: number): string[] {
  return tokenSymbols.slice(offset ?? 0, size + (offset ?? 0)).map((symbol) => tokens[symbol].address);
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

type PoolName = 'WeightedPool' | 'WeightedPool2Tokens' | 'StablePool';

async function deployPoolFromFactory(
  vault: Contract,
  poolName: PoolName,
  args: { from: SignerWithAddress; parameters: Array<unknown> }
): Promise<Contract> {
  const fullName = `${poolName == 'StablePool' ? 'v2-pool-stable' : 'v2-pool-weighted'}/${poolName}`;
  const factory = await deploy(`${fullName}Factory`, { args: [vault.address] });
  // We could reuse this factory if we saved it across pool deployments

  const name = 'Balancer Pool Token';
  const symbol = 'BPT';
  const owner = ZERO_ADDRESS;

  const receipt: ContractReceipt = await (
    await factory.connect(args.from).create(name, symbol, ...args.parameters, owner)
  ).wait();

  const event = receipt.events?.find((e) => e.event == 'PoolCreated');
  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }

  return deployedAt(fullName, event.args?.pool);
}
