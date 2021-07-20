import { Signer } from '@ethersproject/abstract-signer';
import { BigNumber, BigNumberish } from '@ethersproject/bignumber';
import { AddressZero, Zero } from '@ethersproject/constants';
import { ContractTransaction, PayableOverrides } from '@ethersproject/contracts';
import { Provider } from '@ethersproject/providers';
import invariant from 'tiny-invariant';
import { Vault, Vault__factory, WETH, WETH__factory } from '@balancer-labs/typechain';
import { BatchSwapStep, FundManagement, SingleSwap, SwapKind } from '../types';

/**
 * Converts a batch swap which interacts with only a single pool to an equivalent simple swap
 * @param swap - a SingleSwap object describing the pool to perform the swap against.
 * @returns an equivalent batch swap
 */
export const convertSingleToBatchSwap = (
  swap: SingleSwap,
  limit: BigNumberish
): { kind: SwapKind; swaps: BatchSwapStep[]; assets: string[]; limits: BigNumber[] } => {
  const assets = [swap.assetIn, swap.assetOut];
  const swaps = [
    {
      poolId: swap.poolId,
      assetInIndex: assets.indexOf(swap.assetIn),
      assetOutIndex: assets.indexOf(swap.assetOut),
      amount: swap.amount,
      userData: swap.userData,
    },
  ];
  const limits = swap.kind === SwapKind.GivenIn ? [BigNumber.from(limit), Zero] : [Zero, BigNumber.from(limit).mul(-1)];
  return { kind: swap.kind, swaps, assets, limits };
};

/**
 * Converts a batch swap which interacts with only a single pool to an equivalent simple swap
 * @param swaps - a SingleSwap object describing the pool to perform the swap against.
 * @param funds - a FundManagement object describing where funds are drawn from and then sent after the trade.
 * @param limit - an array of the maximum allowable inflows to the vault for each token. Negative values describe minimum outflows.
 * @param deadline - the unix timestamp after which this trade is no longer valid
 * @returns an equivalent SingleSwap object
 */
export const convertBatchToSingleSwap = (
  kind: SwapKind,
  swaps: BatchSwapStep[],
  assets: string[],
  limits: BigNumberish[]
): { swap: SingleSwap; limit: BigNumber } => {
  invariant(swaps.length === 1, 'BatchSwap not convertable to SingleSwap');
  invariant(assets.length === 2, 'BatchSwap not convertable to SingleSwap');
  invariant(limits.length === 2, 'BatchSwap not convertable to SingleSwap');
  const { poolId, assetInIndex, assetOutIndex, amount, userData } = swaps[0];

  const swap = {
    poolId,
    kind,
    assetIn: assets[assetInIndex],
    assetOut: assets[assetOutIndex],
    amount,
    userData,
  };
  const limit =
    swap.kind === SwapKind.GivenIn
      ? BigNumber.from(limits[assetInIndex])
      : BigNumber.from(limits[assetOutIndex]).mul(-1);
  return { swap, limit };
};

export class Swapper {
  private readonly vault: Vault;
  private weth: WETH | null = null;

  constructor(vaultAddress: string, provider: Signer | Provider) {
    this.vault = Vault__factory.connect(vaultAddress, provider);
  }

  /**
   * Performs a simple swap which interacts with a single Balancer pool.
   * @param swap - a SingleSwap object describing the pool to perform the swap against.
   * @param funds - a FundManagement object describing where funds are drawn from and then sent after the trade.
   * @param limit - an array of the maximum allowable inflows to the vault for each token. Negative values describe minimum outflows.
   * @param deadline - the unix timestamp after which this trade is no longer valid
   * @returns a promise containing the sent transaction
   */
  swap = (
    swap: SingleSwap,
    funds: FundManagement,
    limit: BigNumberish,
    deadline: BigNumberish,
    overrides: PayableOverrides & { from?: string | Promise<string> } = {}
  ): Promise<ContractTransaction> => {
    if (swap.assetIn === AddressZero) {
      overrides.value = swap.amount;
    }
    return this.vault.swap(swap, funds, limit, deadline, overrides);
  };

  /**
   * Performs a batch swap which interacts multiple Balancer pools.
   *
   * @dev batchSwaps which only interact with a single pool are automatically
   * converted to an equivalent simple swap to save gas.
   *
   * @param kind - a SwapKind enum describing which out of the trades input and output are fixed.
   * @param swaps - an array of BatchSwapSteps describing which pool to interact with on each hop
   * @param assets - an array of the token addresses involved in this batchswap
   * @param funds - a FundManagement object describing where funds are drawn from and then sent after the trade.
   * @param limits - an array of the maximum allowable inflows to the vault for each token. Negative values describe minimum outflows.
   * @param deadline - the unix timestamp after which this trade is no longer valid
   * @returns a promise containing the sent transaction
   */
  batchSwap = (
    kind: SwapKind,
    swaps: BatchSwapStep[],
    assets: string[],
    funds: FundManagement,
    limits: BigNumberish[],
    deadline: BigNumberish,
    overrides: PayableOverrides & { from?: string | Promise<string> } = {}
  ): Promise<ContractTransaction> => {
    // If we can perform the same swap with a SingleSwap then do so
    // This will save the user some gas
    if (swaps.length === 1) {
      const { swap, limit } = convertBatchToSingleSwap(kind, swaps, assets, limits);
      return this.swap(swap, funds, limit, deadline, overrides);
    }

    if (assets.includes(AddressZero)) {
      // If swap uses ETH as an input then attach a value corresponding to the limit
      const ethLimit = BigNumber.from(limits[assets.indexOf(AddressZero)]);
      overrides.value = ethLimit.gt(0) ? ethLimit : 0;
    }
    return this.vault.batchSwap(kind, swaps, assets, funds, limits, deadline, overrides);
  };

  private getWETH = async (): Promise<WETH> => {
    if (this.weth !== null) {
      return this.weth;
    }
    this.weth = WETH__factory.connect(await this.vault.WETH(), this.vault.provider);
    return this.weth;
  };

  wrap = async (amount: BigNumberish): Promise<ContractTransaction> => {
    return (await this.getWETH()).deposit({ value: amount });
  };

  unwrap = async (amount: BigNumberish): Promise<ContractTransaction> => {
    return (await this.getWETH()).withdraw(amount);
  };
}
