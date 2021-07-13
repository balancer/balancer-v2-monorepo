import { defaultAbiCoder } from '@ethersproject/abi';
import { BigNumberish } from '@ethersproject/bignumber';

export enum StablePoolJoinKind {
  INIT = 0,
  EXACT_TOKENS_IN_FOR_BPT_OUT,
  TOKEN_IN_FOR_EXACT_BPT_OUT,
}

export type JoinStablePoolInit = {
  kind: StablePoolJoinKind.INIT;
  amountsIn: BigNumberish[];
};

export type JoinStablePoolExactTokensInForBPTOut = {
  kind: StablePoolJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT;
  amountsIn: BigNumberish[];
  minimumBPT: BigNumberish;
};

export type JoinStablePoolTokenInForExactBPTOut = {
  kind: StablePoolJoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT;
  bptAmountOut: BigNumberish;
  enterTokenIndex: number;
};

export function encodeJoinStablePool(
  joinData: JoinStablePoolInit | JoinStablePoolExactTokensInForBPTOut | JoinStablePoolTokenInForExactBPTOut
): string {
  if (joinData.kind == StablePoolJoinKind.INIT) {
    return defaultAbiCoder.encode(['uint256', 'uint256[]'], [StablePoolJoinKind.INIT, joinData.amountsIn]);
  }
  if (joinData.kind == StablePoolJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {
    return defaultAbiCoder.encode(
      ['uint256', 'uint256[]', 'uint256'],
      [StablePoolJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, joinData.amountsIn, joinData.minimumBPT]
    );
  }
  return defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint256'],
    [StablePoolJoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT, joinData.bptAmountOut, joinData.enterTokenIndex]
  );
}
