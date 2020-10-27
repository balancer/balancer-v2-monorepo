import { TokenList } from '../../test/helpers/tokens';

export type Trade = {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amount?: number;
};

export type Diff = { token: string; vaultDelta: number; amountIn: number };
export type Swap = {
  poolId: string;
  tokenA: { tokenDiffIndex: number; delta: number };
  tokenB: { tokenDiffIndex: number; delta: number };
};

export function getDiffsSwapsAndAmounts(
  tokens: TokenList,
  trades: Array<Trade>
): [Array<Diff>, Array<Swap>, Array<number>] {
  const diffs: Array<Diff> = [];
  const swaps: Array<Swap> = [];
  const amounts: Array<number> = [];

  for (const trade of trades) {
    const tokenInAddress = tokens[trade.tokenIn].address;

    let inDiffIndex = diffs.findIndex((diff) => diff.token == tokenInAddress);
    if (inDiffIndex == -1) {
      diffs.push({ token: tokenInAddress, vaultDelta: 0, amountIn: 0 });
      inDiffIndex = diffs.length - 1;
    }

    const tokenOutAddress = tokens[trade.tokenOut].address;
    let outDiffIndex = diffs.findIndex((diff) => diff.token == tokenOutAddress);
    if (outDiffIndex == -1) {
      diffs.push({ token: tokenOutAddress, vaultDelta: 0, amountIn: 0 });
      outDiffIndex = diffs.length - 1;
    }

    swaps.push({
      poolId: trade.poolId,
      tokenA: { tokenDiffIndex: inDiffIndex, delta: 0 },
      tokenB: { tokenDiffIndex: outDiffIndex, delta: 0 },
    });

    amounts.push(trade.amount ?? 0);
  }

  return [diffs, swaps, amounts];
}
