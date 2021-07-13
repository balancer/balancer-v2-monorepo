import { defaultAbiCoder } from '@ethersproject/abi';
import { BigNumberish } from '@ethersproject/bignumber';

export enum WeightedPoolJoinKind {
  INIT = 0,
  EXACT_TOKENS_IN_FOR_BPT_OUT,
  TOKEN_IN_FOR_EXACT_BPT_OUT,
}

export type JoinWeightedPoolInit = {
  kind: WeightedPoolJoinKind.INIT;
  amountsIn: BigNumberish[];
};

export type JoinWeightedPoolExactTokensInForBPTOut = {
  kind: WeightedPoolJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT;
  amountsIn: BigNumberish[];
  minimumBPT: BigNumberish;
};

export type JoinWeightedPoolTokenInForExactBPTOut = {
  kind: WeightedPoolJoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT;
  bptAmountOut: BigNumberish;
  enterTokenIndex: number;
};

export function encodeJoinWeightedPool(
  joinData: JoinWeightedPoolInit | JoinWeightedPoolExactTokensInForBPTOut | JoinWeightedPoolTokenInForExactBPTOut
): string {
  if (joinData.kind == WeightedPoolJoinKind.INIT) {
    return defaultAbiCoder.encode(['uint256', 'uint256[]'], [WeightedPoolJoinKind.INIT, joinData.amountsIn]);
  }
  if (joinData.kind == WeightedPoolJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {
    return defaultAbiCoder.encode(
      ['uint256', 'uint256[]', 'uint256'],
      [WeightedPoolJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, joinData.amountsIn, joinData.minimumBPT]
    );
  }
  return defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint256'],
    [WeightedPoolJoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT, joinData.bptAmountOut, joinData.enterTokenIndex]
  );
}
