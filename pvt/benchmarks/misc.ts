import { ethers } from 'hardhat';
import { Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { StablePoolEncoder, toNormalizedWeights, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { MAX_UINT256, ZERO_ADDRESS, MAX_WEIGHTED_TOKENS } from '@balancer-labs/v2-helpers/src/constants';
import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { advanceTime, MONTH } from '@balancer-labs/v2-helpers/src/time';
import { range } from 'lodash';
import { parseFixed } from '@ethersproject/bignumber';

export async function setupEnvironment(): Promise<{
  vault: Vault;
  tokens: TokenList;
  trader: SignerWithAddress;
}> {
  const { admin, creator, trader } = await getSigners();

  const vault = await Vault.create({ admin });

  const tokens = await TokenList.create(
    Array.from({ length: MAX_WEIGHTED_TOKENS }).map((_, i) => `TKN${i}`),
    { sorted: true }
  );

  await tokens.asyncEach(async (token) => {
    // creator tokens are used to initialize pools, but tokens are only minted when required
    await token.approve(vault, MAX_UINT256, { from: creator });

    // trader tokens are used to trade and not have non-zero balances
    await token.mint(trader, parseFixed('200', 18));
    await token.approve(vault, MAX_UINT256, { from: trader });
  });

  // deposit internal balance for trader to make it non-zero
  const transfers = tokens.map((token) => ({
    kind: 0, // deposit
    asset: token.address,
    amount: parseFixed('100', 18),
    sender: trader.address,
    recipient: trader.address,
  }));

  await vault.instance.connect(trader).manageUserBalance(transfers);

  return { vault, tokens, trader };
}

export async function deployPool(vault: Vault, tokens: TokenList, poolName: PoolName): Promise<string> {
  const { creator } = await getSigners();

  const initialPoolBalance = bn(100e18);
  await tokens.asyncEach(async (token) => {
    await token.mint(creator, initialPoolBalance);
  });

  const swapFeePercentage = fp(0.02); // 2%

  let pool: Contract;
  let joinUserData: string;

  if (poolName == 'WeightedPool' || poolName == 'WeightedPool2Tokens' || poolName == 'ManagedPool') {
    const WEIGHTS = range(10000, 10000 + tokens.length);
    const weights = toNormalizedWeights(WEIGHTS.map(bn)); // Equal weights for all tokens
    const assetManagers = Array(weights.length).fill(ZERO_ADDRESS);

    let params;

    switch (poolName) {
      case 'ManagedPool': {
        params = [tokens.addresses, weights, assetManagers, swapFeePercentage];
        break;
      }
      case 'WeightedPool2Tokens': {
        params = [tokens.addresses, weights, swapFeePercentage, true];
        break;
      }
      default: {
        params = [tokens.addresses, weights, assetManagers, swapFeePercentage];
      }
    }

    pool = await deployPoolFromFactory(vault, poolName, {
      from: creator,
      parameters: params,
    });

    joinUserData = WeightedPoolEncoder.joinInit(tokens.map(() => initialPoolBalance));
  } else if (poolName == 'StablePool') {
    const amplificationParameter = bn(50);

    pool = await deployPoolFromFactory(vault, poolName, {
      from: creator,
      parameters: [tokens.addresses, amplificationParameter, swapFeePercentage],
    });

    joinUserData = StablePoolEncoder.joinInit(tokens.map(() => initialPoolBalance));
  } else {
    throw new Error(`Unhandled pool: ${poolName}`);
  }

  const poolId = await pool.getPoolId();

  await vault.instance.connect(creator).joinPool(poolId, creator.address, creator.address, {
    assets: tokens.addresses,
    maxAmountsIn: tokens.map(() => initialPoolBalance), // These end up being the actual join amounts
    fromInternalBalance: false,
    userData: joinUserData,
  });

  // Force test to skip pause window
  await advanceTime(MONTH * 5);

  return poolId;
}

export async function getWeightedPool(vault: Vault, tokens: TokenList, size: number, offset = 0): Promise<string> {
  return size === 2
    ? deployPool(vault, tokens.subset(size, offset), 'WeightedPool2Tokens')
    : size > 20
    ? deployPool(vault, tokens.subset(size, offset), 'ManagedPool')
    : deployPool(vault, tokens.subset(size, offset), 'WeightedPool');
}

export async function getStablePool(vault: Vault, tokens: TokenList, size: number, offset?: number): Promise<string> {
  return deployPool(vault, tokens.subset(size, offset), 'StablePool');
}

export function pickTokenAddresses(tokens: TokenList, size: number, offset?: number): string[] {
  return tokens.subset(size, offset).addresses;
}

export async function getSigners(): Promise<{
  admin: SignerWithAddress;
  creator: SignerWithAddress;
  trader: SignerWithAddress;
}> {
  const [, admin, creator, trader] = await ethers.getSigners();

  return { admin, creator, trader };
}

type PoolName = 'WeightedPool' | 'WeightedPool2Tokens' | 'StablePool' | 'ManagedPool';

async function deployPoolFromFactory(
  vault: Vault,
  poolName: PoolName,
  args: { from: SignerWithAddress; parameters: Array<unknown> }
): Promise<Contract> {
  const fullName = `${poolName == 'StablePool' ? 'v2-pool-stable' : 'v2-pool-weighted'}/${poolName}`;
  const libraries =
    poolName == 'WeightedPool2Tokens'
      ? { QueryProcessor: await (await deploy('v2-pool-utils/QueryProcessor')).address }
      : undefined;
  const factory = await deploy(`${fullName}Factory`, { args: [vault.address], libraries });
  // We could reuse this factory if we saved it across pool deployments

  const name = 'Balancer Pool Token';
  const symbol = 'BPT';
  const owner = ZERO_ADDRESS;
  let receipt: ContractReceipt;

  if (poolName == 'ManagedPool') {
    const swapEnabledOnStart = true;
    const managementSwapFeePercentage = 0;

    receipt = await (
      await factory
        .connect(args.from)
        .create(name, symbol, ...args.parameters, owner, swapEnabledOnStart, managementSwapFeePercentage)
    ).wait();
  } else {
    receipt = await (await factory.connect(args.from).create(name, symbol, ...args.parameters, owner)).wait();
  }

  const event = receipt.events?.find((e) => e.event == 'PoolCreated');
  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }

  return deployedAt(fullName, event.args?.pool);
}
