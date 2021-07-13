import { TokenList } from '../../tokens';
import { BigNumberish } from '../../numbers';
import { BatchSwapStep } from '@balancer-labs/balancer-js';

export type Trade = {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amount?: number | string;
};

export type AssetManagerTransfer = {
  token: string;
  amount: BigNumberish;
};

export function getTokensSwaps(tokens: TokenList, trades: Array<Trade>): [Array<string>, Array<BatchSwapStep>] {
  const swaps: Array<BatchSwapStep> = [];

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
    const assetInIndex = tokenAddresses.indexOf(tokenInAddress);

    const tokenOutAddress = tokens[trade.tokenOut].address;
    const assetOutIndex = tokenAddresses.indexOf(tokenOutAddress);

    swaps.push({
      poolId: trade.poolId,
      assetInIndex,
      assetOutIndex,
      amount: trade.amount?.toString() ?? 0,
      userData: '0x',
    });
  }

  return [tokenAddresses, swaps];
}
