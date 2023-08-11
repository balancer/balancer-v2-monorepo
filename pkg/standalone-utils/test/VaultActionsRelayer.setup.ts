import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { BigNumber, Contract } from 'ethers';
import { MAX_INT256, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import { Dictionary } from 'lodash';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { SwapKind } from '@balancer-labs/balancer-js';

export enum PoolKind {
  WEIGHTED = 0,
  LEGACY_STABLE,
  COMPOSABLE_STABLE,
  COMPOSABLE_STABLE_V2,
}

export type OutputReference = {
  index: number;
  key: BigNumber;
};

export async function setupRelayerEnvironment(): Promise<{
  user: SignerWithAddress;
  admin: SignerWithAddress;
  other: SignerWithAddress;
  vault: Vault;
  relayer: Contract;
  relayerLibrary: Contract;
}> {
  const [, admin, user, other] = await ethers.getSigners();

  // Deploy Balancer Vault
  const vault = await Vault.create({ admin });

  // Deploy Relayer
  const relayerLibrary = await deploy('MockBatchRelayerLibrary', {
    args: [vault.address, ZERO_ADDRESS, ZERO_ADDRESS, false],
  });
  const relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());

  // Authorize Relayer for all actions
  const relayerActionIds = await Promise.all(
    ['swap', 'batchSwap', 'joinPool', 'exitPool', 'setRelayerApproval', 'manageUserBalance'].map((action) =>
      actionId(vault.instance, action)
    )
  );

  await Promise.all(relayerActionIds.map((action) => vault.grantPermissionGlobally(action, relayer)));

  // Approve relayer by sender
  await vault.setRelayerApproval(user, relayer, true);

  return { user, admin, other, vault, relayer, relayerLibrary };
}

export async function encodeJoinPool(
  vault: Vault,
  relayerLibrary: Contract,
  params: {
    poolId: string;
    userData: string;
    outputReference?: BigNumberish;
    sender: Account;
    recipient: Account;
    poolKind: number;
  }
): Promise<string> {
  const { tokens } = await vault.getPoolTokens(params.poolId);

  return relayerLibrary.interface.encodeFunctionData('joinPool', [
    params.poolId,
    params.poolKind,
    TypesConverter.toAddress(params.sender),
    TypesConverter.toAddress(params.recipient),
    {
      assets: tokens,
      maxAmountsIn: new Array(tokens.length).fill(MAX_UINT256),
      userData: params.userData,
      fromInternalBalance: false,
    },
    0,
    params.outputReference ?? 0,
  ]);
}

export async function encodeExitPool(
  vault: Vault,
  relayerLibrary: Contract,
  tokens: TokenList,
  params: {
    poolId: string;
    userData: string;
    toInternalBalance: boolean;
    outputReferences?: Dictionary<BigNumberish>;
    sender: Account;
    recipient: Account;
    poolKind: number;
  }
): Promise<string> {
  const { tokens: poolTokens } = await vault.getPoolTokens(params.poolId);
  const outputReferences = Object.entries(params.outputReferences ?? {}).map(([symbol, key]) => ({
    index: poolTokens.findIndex((tokenAddress) => tokenAddress === tokens.findBySymbol(symbol).address),
    key,
  }));

  return relayerLibrary.interface.encodeFunctionData('exitPool', [
    params.poolId,
    params.poolKind,
    TypesConverter.toAddress(params.sender),
    TypesConverter.toAddress(params.recipient),
    {
      assets: poolTokens,
      minAmountsOut: new Array(poolTokens.length).fill(0),
      userData: params.userData,
      toInternalBalance: params.toInternalBalance,
    },
    outputReferences,
  ]);
}

export function encodeSwap(
  relayerLibrary: Contract,
  params: {
    poolId: string;
    tokenIn: Token;
    tokenOut: Token;
    amount: BigNumberish;
    fromInternalBalance?: boolean;
    outputReference?: BigNumberish;
    sender: Account;
    recipient: Account;
  }
): string {
  return relayerLibrary.interface.encodeFunctionData('swap', [
    {
      poolId: params.poolId,
      kind: SwapKind.GivenIn,
      assetIn: params.tokenIn.address,
      assetOut: params.tokenOut.address,
      amount: params.amount,
      userData: '0x',
    },
    {
      sender: TypesConverter.toAddress(params.sender),
      recipient: TypesConverter.toAddress(params.recipient),
      fromInternalBalance: params.fromInternalBalance ?? false,
      toInternalBalance: false,
    },
    0,
    MAX_UINT256,
    0,
    params.outputReference ?? 0,
  ]);
}

export function encodeBatchSwap(params: {
  relayerLibrary: Contract;
  tokens: TokenList;
  swaps: Array<{
    poolId: string;
    tokenIn: Token;
    tokenOut: Token;
    amount: BigNumberish;
  }>;
  outputReferences?: Dictionary<BigNumberish>;
  sender: Account;
  recipient?: Account;
  useInternalBalance?: boolean;
}): string {
  const outputReferences = Object.entries(params.outputReferences ?? {}).map(([symbol, key]) => ({
    index: params.tokens.findIndexBySymbol(symbol),
    key,
  }));

  if (params.useInternalBalance == undefined) {
    params.useInternalBalance = false;
  }

  return params.relayerLibrary.interface.encodeFunctionData('batchSwap', [
    SwapKind.GivenIn,
    params.swaps.map((swap) => ({
      poolId: swap.poolId,
      assetInIndex: params.tokens.indexOf(swap.tokenIn),
      assetOutIndex: params.tokens.indexOf(swap.tokenOut),
      amount: swap.amount,
      userData: '0x',
    })),
    params.tokens.addresses,
    {
      sender: TypesConverter.toAddress(params.sender),
      recipient: params.recipient ?? TypesConverter.toAddress(recipient),
      fromInternalBalance: params.useInternalBalance,
      toInternalBalance: params.useInternalBalance,
    },
    new Array(params.tokens.length).fill(MAX_INT256),
    MAX_UINT256,
    0,
    outputReferences,
  ]);
}
export function getJoinExitAmounts(poolTokens: TokenList, tokenAmounts: Dictionary<BigNumberish>): Array<BigNumberish> {
  return poolTokens.map((token) => tokenAmounts[token.symbol] ?? 0);
}

function encodeApprove(relayerLibrary: Contract, token: Token, amount: BigNumberish): string {
  return relayerLibrary.interface.encodeFunctionData('approveVault', [token.address, amount]);
}

export async function approveVaultForRelayer(relayerLibrary: Contract, user: SignerWithAddress, tokens: TokenList) {
  const relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());

  return await relayer
    .connect(user)
    .multicall(tokens.map((token) => encodeApprove(relayerLibrary, token, MAX_UINT256)));
}
