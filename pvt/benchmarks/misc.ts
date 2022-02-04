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
import { advanceTime, MONTH, DAY } from '@balancer-labs/v2-helpers/src/time';
import { range } from 'lodash';
import {
  BasePoolRights,
  ManagedPoolParams,
  ManagedPoolRights,
} from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';

const name = 'Balancer Pool Token';
const symbol = 'BPT';

export async function setupEnvironment(): Promise<{
  vault: Vault;
  tokens: TokenList;
  trader: SignerWithAddress;
  others: SignerWithAddress[];
}> {
  const { admin, creator, trader, others } = await getSigners();

  const vault = await Vault.create({ admin });

  const tokens = await TokenList.create(
    Array.from({ length: MAX_WEIGHTED_TOKENS }).map((_, i) => `TKN${i}`),
    { sorted: true }
  );

  await tokens.asyncEach(async (token) => {
    // creator tokens are used to initialize pools, but tokens are only minted when required
    await token.approve(vault, MAX_UINT256, { from: creator });

    // trader tokens are used to trade and not have non-zero balances
    await token.mint(trader, fp(200));
    await token.approve(vault, MAX_UINT256, { from: trader });
  });

  // deposit internal balance for trader to make it non-zero
  const transfers = tokens.map((token) => ({
    kind: 0, // deposit
    asset: token.address,
    amount: fp(100),
    sender: trader.address,
    recipient: trader.address,
  }));

  await vault.instance.connect(trader).manageUserBalance(transfers);

  return { vault, tokens, trader, others };
}

export async function deployPool(vault: Vault, tokens: TokenList, poolName: PoolName): Promise<string> {
  const { creator } = await getSigners();

  const initialPoolBalance = bn(100e18);
  await tokens.asyncEach(async (token) => {
    await token.mint(creator, initialPoolBalance);
  });

  const swapFeePercentage = fp(0.02); // 2%
  const managementFee = fp(0.5); // 50%

  let pool: Contract;
  let joinUserData: string;

  if (poolName == 'WeightedPool' || poolName == 'OracleWeightedPool' || poolName == 'ManagedPool') {
    const WEIGHTS = range(10000, 10000 + tokens.length);
    const weights = toNormalizedWeights(WEIGHTS.map(bn)); // Equal weights for all tokens
    const assetManagers = Array(weights.length).fill(ZERO_ADDRESS);
    let params;

    switch (poolName) {
      case 'ManagedPool': {
        const newPoolParams: ManagedPoolParams = {
          vault: vault.address,
          name: name,
          symbol: symbol,
          tokens: tokens.addresses,
          normalizedWeights: weights,
          assetManagers: Array(tokens.length).fill(ZERO_ADDRESS),
          swapFeePercentage: swapFeePercentage,
          pauseWindowDuration: MONTH * 3,
          bufferPeriodDuration: MONTH,
          owner: creator.address,
          swapEnabledOnStart: true,
          mustAllowlistLPs: false,
          managementSwapFeePercentage: managementFee,
        };

        const basePoolRights: BasePoolRights = {
          canTransferOwnership: true,
          canChangeSwapFee: true,
          canUpdateMetadata: true,
        };

        const managedPoolRights: ManagedPoolRights = {
          canChangeWeights: true,
          canDisableSwaps: true,
          canSetMustAllowlistLPs: true,
          canSetCircuitBreakers: true,
          canChangeTokens: true,
          canChangeMgmtSwapFee: true,
        };
        params = [newPoolParams, basePoolRights, managedPoolRights, DAY];
        break;
      }
      case 'OracleWeightedPool': {
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
    ? deployPool(vault, tokens.subset(size, offset), 'OracleWeightedPool')
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
  others: SignerWithAddress[];
}> {
  const [, admin, creator, trader, ...others] = await ethers.getSigners();

  return { admin, creator, trader, others };
}

type PoolName = 'WeightedPool' | 'OracleWeightedPool' | 'StablePool' | 'ManagedPool';

async function deployPoolFromFactory(
  vault: Vault,
  poolName: PoolName,
  args: { from: SignerWithAddress; parameters: Array<unknown> }
): Promise<Contract> {
  const fullName = `${poolName == 'StablePool' ? 'v2-pool-stable' : 'v2-pool-weighted'}/${poolName}`;
  const libraries =
    poolName == 'OracleWeightedPool'
      ? { QueryProcessor: await (await deploy('v2-pool-utils/QueryProcessor')).address }
      : undefined;
  let factory: Contract;
  if (poolName == 'ManagedPool') {
    const baseFactory = await deploy('v2-pool-weighted/BaseManagedPoolFactory', { args: [vault.address] });
    factory = await deploy(`${fullName}Factory`, { args: [baseFactory.address] });
  } else {
    factory = await deploy(`${fullName}Factory`, { args: [vault.address], libraries });
  }

  // We could reuse this factory if we saved it across pool deployments

  let receipt: ContractReceipt;
  let event;

  if (poolName == 'ManagedPool') {
    receipt = await (await factory.connect(args.from).create(...args.parameters)).wait();
    event = receipt.events?.find((e) => e.event == 'ManagedPoolCreated');
  } else {
    receipt = await (await factory.connect(args.from).create(name, symbol, ...args.parameters, ZERO_ADDRESS)).wait();
    event = receipt.events?.find((e) => e.event == 'PoolCreated');
  }

  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }

  return deployedAt(fullName, event.args?.pool);
}
