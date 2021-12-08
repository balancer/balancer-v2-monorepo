import { BigNumberish } from '../../numbers';
import { BatchSwapStep } from '@balancer-labs/balancer-js';
import TokenList from '../tokens/TokenList';
import Token from '../tokens/Token';

export type Trade = {
  poolId: string;
  tokenIn: Token;
  tokenOut: Token;
  amount?: number | string;
};

export type AssetManagerTransfer = {
  token: string;
  amount: BigNumberish;
};

export function getTokensSwaps(tokens: TokenList, trades: Array<Trade>): [Array<string>, Array<BatchSwapStep>] {
  const swaps: Array<BatchSwapStep> = [];

  const tokenAddresses = Array.from(
    new Set(trades.reduce((acc: string[], trade) => acc.concat([trade.tokenIn.address, trade.tokenOut.address]), []))
  );

  for (const trade of trades) {
    const assetInIndex = tokens.indexOf(trade.tokenIn);
    const assetOutIndex = tokens.indexOf(trade.tokenOut);

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
