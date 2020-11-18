import { TokenList } from '../../test/helpers/tokens';

export type Trade = {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amount?: number | string;
};

export type Swap = {
  poolId: string;
  tokenIn: { tokenIndex: number; amount: number };
  tokenOut: { tokenIndex: number; amount: number };
  userData: string;
};

export function getTokensSwapsAndAmounts(
  tokens: TokenList,
  trades: Array<Trade>
): [Array<string>, Array<Swap>, Array<number | string>] {
  const swaps: Array<Swap> = [];
  const amounts: Array<number | string> = [];

  const tokenAddresses = Array.from(
    new Set(
      trades.reduce(
        (acc: string[], trade) => acc.concat([tokens[trade.tokenIn].address, tokens[trade.tokenOut].address]),
        []
      )
    )
  );

  for (const trade of trades) {
    const tokenInAddress = tokens[trade.tokenIn].address;

    const inDiffIndex = tokenAddresses.indexOf(tokenInAddress);

    const tokenOutAddress = tokens[trade.tokenOut].address;
    const outDiffIndex = tokenAddresses.indexOf(tokenOutAddress);

    swaps.push({
      poolId: trade.poolId,
      tokenIn: { tokenIndex: inDiffIndex, amount: 0 },
      tokenOut: { tokenIndex: outDiffIndex, amount: 0 },
      userData: '0x',
    });

    amounts.push(trade.amount ?? 0);
  }

  return [tokenAddresses, swaps, amounts];
}

export type SwapIndexes = {
  tokenIndexIn: number;
  tokenIndexOut: number;
};

export function getSwapTokenIndexes(indexes: number[][]): Array<SwapIndexes> {
  const swapIndexes: Array<SwapIndexes> = [];
  for (const pair of indexes) {
    swapIndexes.push({
      tokenIndexIn: pair[0],
      tokenIndexOut: pair[1],
    });
  }
  return swapIndexes;
}

export type TradeV2 = {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amount?: number | string;
};

export type SwapV2 = {
  poolId: string;
  tokenInIndex: number;
  tokenOutIndex: number;
  amountIn: number | string;
  userData: string;
};

export type FundManagement = {
  sender: string;
  recipient: string;
  withdrawFromUserBalance: boolean;
  depositToUserBalance: boolean;
};

export function getTokensSwaps(tokens: TokenList, trades: Array<Trade>): [Array<string>, Array<SwapV2>] {
  const swaps: Array<SwapV2> = [];

  const tokenAddresses = Array.from(
    new Set(
      trades.reduce(
        (acc: string[], trade) => acc.concat([tokens[trade.tokenIn].address, tokens[trade.tokenOut].address]),
        []
      )
    )
  );

  for (const trade of trades) {
    const tokenInAddress = tokens[trade.tokenIn].address;

    const inDiffIndex = tokenAddresses.indexOf(tokenInAddress);

    const tokenOutAddress = tokens[trade.tokenOut].address;
    const outDiffIndex = tokenAddresses.indexOf(tokenOutAddress);

    swaps.push({
      poolId: trade.poolId,
      tokenInIndex: inDiffIndex,
      tokenOutIndex: outDiffIndex,
      amountIn: trade.amount?.toString() ?? 0,
      userData: '0x',
    });
  }

  return [tokenAddresses, swaps];
}
