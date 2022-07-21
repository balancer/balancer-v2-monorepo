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
  const aumFee = 0;

  let pool: Contract;
  let joinUserData: string;

  if (poolName == 'WeightedPool' || poolName == 'ManagedPool') {
    const WEIGHTS = range(10000, 10000 + tokens.length);
    const weights = toNormalizedWeights(WEIGHTS.map(bn)); // Equal weights for all tokens
    const assetManagers = Array(weights.length).fill(ZERO_ADDRESS);
    let params;

    const aumProtocolFeesCollector = await deploy('v2-standalone-utils/AumProtocolFeesCollector', {
      args: [vault.address],
    });

    switch (poolName) {
      case 'ManagedPool': {
        const newPoolParams: ManagedPoolParams = {
          name: name,
          symbol: symbol,
          tokens: tokens.addresses,
          normalizedWeights: weights,
          assetManagers: Array(tokens.length).fill(ZERO_ADDRESS),
          swapFeePercentage: swapFeePercentage,
          swapEnabledOnStart: true,
          mustAllowlistLPs: false,
          protocolSwapFeePercentage: MAX_UINT256,
          managementSwapFeePercentage: managementFee,
          managementAumFeePercentage: aumFee,
          aumProtocolFeesCollector: aumProtocolFeesCollector.address,
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
          canChangeMgmtFees: true,
        };

        params = [newPoolParams, basePoolRights, managedPoolRights, DAY, creator.address];
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
  } else if (poolName == 'StablePhantomPool') {
    const amplificationParameter = bn(50);

    const rateProviders = Array(tokens.length).fill(ZERO_ADDRESS);
    const cacheDurations = Array(tokens.length).fill(0);
    const protocolFeeFlags = Array(tokens.length).fill(false);

    pool = await deployPoolFromFactory(vault, poolName, {
      from: creator,
      parameters: [
        tokens.addresses,
        amplificationParameter,
        rateProviders,
        cacheDurations,
        protocolFeeFlags,
        swapFeePercentage,
      ],
    });
  } else {
    throw new Error(`Unhandled pool: ${poolName}`);
  }

  const poolId = await pool.getPoolId();
  const { tokens: allTokens } = await vault.getPoolTokens(poolId);
  const initialBalances = allTokens.map((t) => (t == pool.address ? 0 : initialPoolBalance));
  joinUserData = StablePoolEncoder.joinInit(initialBalances);

  await vault.instance.connect(creator).joinPool(poolId, creator.address, creator.address, {
    assets: allTokens,
    maxAmountsIn: Array(allTokens.length).fill(MAX_UINT256), // These end up being the actual join amounts
    fromInternalBalance: false,
    userData: joinUserData,
  });

  // Force test to skip pause window
  await advanceTime(MONTH * 5);

  return poolId;
}

export async function getWeightedPool(vault: Vault, tokens: TokenList, size: number, offset = 0): Promise<string> {
  return size > 20
    ? deployPool(vault, tokens.subset(size, offset), 'ManagedPool')
    : deployPool(vault, tokens.subset(size, offset), 'WeightedPool');
}

export async function getStablePool(vault: Vault, tokens: TokenList, size: number, offset?: number): Promise<string> {
  return deployPool(vault, tokens.subset(size, offset), 'StablePhantomPool');
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

type PoolName = 'WeightedPool' | 'StablePhantomPool' | 'ManagedPool';

async function deployPoolFromFactory(
  vault: Vault,
  poolName: PoolName,
  args: { from: SignerWithAddress; parameters: Array<unknown> }
): Promise<Contract> {
  const fullName = `${poolName == 'StablePhantomPool' ? 'v2-pool-stable-phantom' : 'v2-pool-weighted'}/${poolName}`;
  let factory: Contract;
  if (poolName == 'ManagedPool') {
    const baseFactory = await deploy('v2-pool-weighted/BaseManagedPoolFactory', { args: [vault.address] });
    factory = await deploy(`${fullName}Factory`, { args: [baseFactory.address] });
  } else {
    factory = await deploy(`${fullName}Factory`, { args: [vault.address] });
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
