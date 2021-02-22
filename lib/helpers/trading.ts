import { TokenList } from './tokens';
import { BigNumberish } from './numbers';

export type Trade = {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amount?: number | string;
};

export type Swap = {
  poolId: string;
  tokenInIndex: number;
  tokenOutIndex: number;
  amount: BigNumberish;
  userData: string;
};

export type SwapIn = {
  poolId: string;
  tokenInIndex: number;
  tokenOutIndex: number;
  amountIn: BigNumberish;
  userData: string;
};

export type SwapOut = {
  poolId: string;
  tokenInIndex: number;
  tokenOutIndex: number;
  amountOut: BigNumberish;
  userData: string;
};

export type FundManagement = {
  sender: string;
  recipient: string;
  fromInternalBalance: boolean;
  toInternalBalance: boolean;
};

export type OneToOneValidatorData = {
  overallTokenIn: string;
  overallTokenOut: string;
  maximumAmountIn: BigNumberish;
  minimumAmountOut: BigNumberish;
  deadline: BigNumberish;
};

export type AssetManagerTransfer = {
  token: string;
  amount: BigNumberish;
};

export function getTokensSwaps(tokens: TokenList, trades: Array<Trade>): [Array<string>, Array<Swap>] {
  const swaps: Array<Swap> = [];

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
    const tokenInIndex = tokenAddresses.indexOf(tokenInAddress);

    const tokenOutAddress = tokens[trade.tokenOut].address;
    const tokenOutIndex = tokenAddresses.indexOf(tokenOutAddress);

    swaps.push({
      poolId: trade.poolId,
      tokenInIndex,
      tokenOutIndex,
      amount: trade.amount?.toString() ?? 0,
      userData: '0x',
    });
  }

  return [tokenAddresses, swaps];
}

export function toSwapIn(swaps: Array<Swap>): Array<SwapIn> {
  return swaps.map((swap) => {
    return {
      poolId: swap.poolId,
      tokenInIndex: swap.tokenInIndex,
      tokenOutIndex: swap.tokenOutIndex,
      amountIn: swap.amount,
      userData: swap.userData,
    };
  });
}

export function toSwapOut(swaps: Array<Swap>): Array<SwapOut> {
  return swaps.map((swap) => {
    return {
      poolId: swap.poolId,
      tokenInIndex: swap.tokenInIndex,
      tokenOutIndex: swap.tokenOutIndex,
      amountOut: swap.amount,
      userData: swap.userData,
    };
  });
}
