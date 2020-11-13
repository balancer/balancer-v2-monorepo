import { TokenList } from '../../test/helpers/tokens';
import { Contract } from 'ethers';

export type Trade = {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amount?: number | string;
};

export type Swap = {
  poolId: string;
  tokenIn: { tokenDiffIndex: number; amount: number };
  tokenOut: { tokenDiffIndex: number; amount: number };
  userData: string;
};

export function getTokensSwapsAndAmounts(
  tokens: TokenList,
  trades: Array<Trade>
): [Array<string>, Array<Swap>, Array<number | string>] {
  const tokenAddresses = Object.values(tokens).map((tokenContract: Contract) => tokenContract.address);
  const swaps: Array<Swap> = [];
  const amounts: Array<number | string> = [];

  for (const trade of trades) {
    const tokenInAddress = tokens[trade.tokenIn].address;

    const inDiffIndex = tokenAddresses.indexOf(tokenInAddress);

    const tokenOutAddress = tokens[trade.tokenOut].address;
    const outDiffIndex = tokenAddresses.indexOf(tokenOutAddress);

    swaps.push({
      poolId: trade.poolId,
      tokenIn: { tokenDiffIndex: inDiffIndex, amount: 0 },
      tokenOut: { tokenDiffIndex: outDiffIndex, amount: 0 },
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
