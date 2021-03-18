import { ethers } from 'hardhat';

import { BigNumberish } from './numbers';

const JOIN_STABLE_POOL_INIT_TAG = 0;
const JOIN_STABLE_POOL_EXACT_TOKENS_IN_FOR_BPT_OUT_TAG = 1;
const JOIN_STABLE_POOL_TOKEN_IN_FOR_EXACT_BPT_OUT_TAG = 2;

export type JoinStablePoolInit = {
  kind: 'Init';
  amountsIn: BigNumberish[];
};

export type JoinStablePoolExactTokensInForBPTOut = {
  kind: 'ExactTokensInForBPTOut';
  amountsIn: BigNumberish[];
  minimumBPT: BigNumberish;
};

export type JoinStablePoolTokenInForExactBPTOut = {
  kind: 'TokenInForExactBPTOut';
  bptAmountOut: BigNumberish;
  enterTokenIndex: number;
};

export function encodeJoinStablePool(
  joinData: JoinStablePoolInit | JoinStablePoolExactTokensInForBPTOut | JoinStablePoolTokenInForExactBPTOut
): string {
  if (joinData.kind == 'Init') {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256[]'],
      [JOIN_STABLE_POOL_INIT_TAG, joinData.amountsIn]
    );
  } else if (joinData.kind == 'ExactTokensInForBPTOut') {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256[]', 'uint256'],
      [JOIN_STABLE_POOL_EXACT_TOKENS_IN_FOR_BPT_OUT_TAG, joinData.amountsIn, joinData.minimumBPT]
    );
  } else {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256', 'uint256'],
      [JOIN_STABLE_POOL_TOKEN_IN_FOR_EXACT_BPT_OUT_TAG, joinData.bptAmountOut, joinData.enterTokenIndex]
    );
  }
}

const EXIT_STABLE_POOL_EXACT_BPT_IN_FOR_ONE_TOKEN_OUT_TAG = 0;
const EXIT_STABLE_POOL_EXACT_BPT_IN_FOR_ALL_TOKENS_OUT_TAG = 1;
const EXIT_STABLE_POOL_BPT_IN_FOR_EXACT_TOKENS_OUT_TAG = 2;

export type ExitStablePoolExactBPTInForOneTokenOut = {
  kind: 'ExactBPTInForOneTokenOut';
  bptAmountIn: BigNumberish;
  exitTokenIndex: number;
};

export type ExitStablePoolExactBPTInForAllTokensOut = {
  kind: 'ExactBPTInForAllTokensOut';
  bptAmountIn: BigNumberish;
};

export type ExitStablePoolBPTInForExactTokensOut = {
  kind: 'BPTInForExactTokensOut';
  amountsOut: BigNumberish[];
  maxBPTAmountIn: BigNumberish;
};

export function encodeExitStablePool(
  exitData:
    | ExitStablePoolExactBPTInForOneTokenOut
    | ExitStablePoolExactBPTInForAllTokensOut
    | ExitStablePoolBPTInForExactTokensOut
): string {
  if (exitData.kind == 'ExactBPTInForOneTokenOut') {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256', 'uint256'],
      [EXIT_STABLE_POOL_EXACT_BPT_IN_FOR_ONE_TOKEN_OUT_TAG, exitData.bptAmountIn, exitData.exitTokenIndex]
    );
  } else if (exitData.kind == 'ExactBPTInForAllTokensOut') {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256'],
      [EXIT_STABLE_POOL_EXACT_BPT_IN_FOR_ALL_TOKENS_OUT_TAG, exitData.bptAmountIn]
    );
  } else {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256[]', 'uint256'],
      [EXIT_STABLE_POOL_BPT_IN_FOR_EXACT_TOKENS_OUT_TAG, exitData.amountsOut, exitData.maxBPTAmountIn]
    );
  }
}
