import { defaultAbiCoder } from '@ethersproject/abi';
import { BigNumberish } from '@ethersproject/bignumber';

export enum WeightedPoolExitKind {
  EXACT_BPT_IN_FOR_ONE_TOKEN_OUT = 0,
  EXACT_BPT_IN_FOR_TOKENS_OUT,
  BPT_IN_FOR_EXACT_TOKENS_OUT,
}

export type ExitWeightedPoolExactBPTInForOneTokenOut = {
  kind: WeightedPoolExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT;
  bptAmountIn: BigNumberish;
  exitTokenIndex: number;
};

export type ExitWeightedPoolExactBPTInForTokensOut = {
  kind: WeightedPoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT;
  bptAmountIn: BigNumberish;
};

export type ExitWeightedPoolBPTInForExactTokensOut = {
  kind: WeightedPoolExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT;
  amountsOut: BigNumberish[];
  maxBPTAmountIn: BigNumberish;
};

export function encodeExitWeightedPool(
  exitData:
    | ExitWeightedPoolExactBPTInForOneTokenOut
    | ExitWeightedPoolExactBPTInForTokensOut
    | ExitWeightedPoolBPTInForExactTokensOut
): string {
  if (exitData.kind == WeightedPoolExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT) {
    return defaultAbiCoder.encode(
      ['uint256', 'uint256', 'uint256'],
      [WeightedPoolExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, exitData.bptAmountIn, exitData.exitTokenIndex]
    );
  }
  if (exitData.kind == WeightedPoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT) {
    return defaultAbiCoder.encode(
      ['uint256', 'uint256'],
      [WeightedPoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, exitData.bptAmountIn]
    );
  }
  return defaultAbiCoder.encode(
    ['uint256', 'uint256[]', 'uint256'],
    [WeightedPoolExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT, exitData.amountsOut, exitData.maxBPTAmountIn]
  );
}
