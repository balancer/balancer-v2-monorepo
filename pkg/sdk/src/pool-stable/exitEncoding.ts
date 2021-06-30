import { defaultAbiCoder } from '@ethersproject/abi';
import { BigNumberish } from '@ethersproject/bignumber';

export enum StablePoolExitKind {
  EXACT_BPT_IN_FOR_ONE_TOKEN_OUT = 0,
  EXACT_BPT_IN_FOR_TOKENS_OUT,
  BPT_IN_FOR_EXACT_TOKENS_OUT,
}

export type ExitStablePoolExactBPTInForOneTokenOut = {
  kind: StablePoolExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT;
  bptAmountIn: BigNumberish;
  exitTokenIndex: number;
};

export type ExitStablePoolExactBPTInForTokensOut = {
  kind: StablePoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT;
  bptAmountIn: BigNumberish;
};

export type ExitStablePoolBPTInForExactTokensOut = {
  kind: StablePoolExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT;
  amountsOut: BigNumberish[];
  maxBPTAmountIn: BigNumberish;
};

export function encodeExitStablePool(
  exitData:
    | ExitStablePoolExactBPTInForOneTokenOut
    | ExitStablePoolExactBPTInForTokensOut
    | ExitStablePoolBPTInForExactTokensOut
): string {
  if (exitData.kind == StablePoolExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT) {
    return defaultAbiCoder.encode(
      ['uint256', 'uint256', 'uint256'],
      [StablePoolExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, exitData.bptAmountIn, exitData.exitTokenIndex]
    );
  }
  if (exitData.kind == StablePoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT) {
    return defaultAbiCoder.encode(
      ['uint256', 'uint256'],
      [StablePoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, exitData.bptAmountIn]
    );
  }
  return defaultAbiCoder.encode(
    ['uint256', 'uint256[]', 'uint256'],
    [StablePoolExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT, exitData.amountsOut, exitData.maxBPTAmountIn]
  );
}
