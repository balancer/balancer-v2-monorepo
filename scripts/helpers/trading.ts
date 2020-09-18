import { TokenList } from '../../test/helpers/tokens';

export type Trade = {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
};

type Diff = { token: string; vaultDelta: number };
type Swap = {
  poolId: string;
  tokenA: { tokenDiffIndex: number; balance: number };
  tokenB: { tokenDiffIndex: number; balance: number };
};

export function getDiffsAndSwaps(tokens: TokenList, trades: Array<Trade>): [Array<Diff>, Array<Swap>] {
  const diffs: Array<Diff> = [];
  const swaps: Array<Swap> = [];

  for (const trade of trades) {
    const tokenInAddress = tokens[trade.tokenIn].address;

    let inDiffIndex = diffs.findIndex((diff) => diff.token == tokenInAddress);
    if (inDiffIndex == -1) {
      diffs.push({ token: tokenInAddress, vaultDelta: 0 });
      inDiffIndex = diffs.length - 1;
    }

    const tokenOutAddress = tokens[trade.tokenOut].address;
    let outDiffIndex = diffs.findIndex((diff) => diff.token == tokenOutAddress);
    if (outDiffIndex == -1) {
      diffs.push({ token: tokenOutAddress, vaultDelta: 0 });
      outDiffIndex = diffs.length - 1;
    }

    swaps.push({
      poolId: trade.poolId,
      tokenA: { tokenDiffIndex: inDiffIndex, balance: 0 },
      tokenB: { tokenDiffIndex: outDiffIndex, balance: 0 },
    });
  }

  return [diffs, swaps];
}
