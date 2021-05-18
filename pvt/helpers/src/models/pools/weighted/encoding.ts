import { ethers } from 'hardhat';

import { BigNumberish } from '../../../numbers';

const JOIN_WEIGHTED_POOL_INIT_TAG = 0;
const JOIN_WEIGHTED_POOL_EXACT_TOKENS_IN_FOR_BPT_OUT_TAG = 1;
const JOIN_WEIGHTED_POOL_TOKEN_IN_FOR_EXACT_BPT_OUT_TAG = 2;

export type JoinWeightedPoolInit = {
  kind: 'Init';
  amountsIn: BigNumberish[];
};

export type JoinWeightedPoolExactTokensInForBPTOut = {
  kind: 'ExactTokensInForBPTOut';
  amountsIn: BigNumberish[];
  minimumBPT: BigNumberish;
};

export type JoinWeightedPoolTokenInForExactBPTOut = {
  kind: 'TokenInForExactBPTOut';
  bptAmountOut: BigNumberish;
  enterTokenIndex: number;
};

export function encodeJoinWeightedPool(
  joinData: JoinWeightedPoolInit | JoinWeightedPoolExactTokensInForBPTOut | JoinWeightedPoolTokenInForExactBPTOut
): string {
  if (joinData.kind == 'Init') {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256[]'],
      [JOIN_WEIGHTED_POOL_INIT_TAG, joinData.amountsIn]
    );
  } else if (joinData.kind == 'ExactTokensInForBPTOut') {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256[]', 'uint256'],
      [JOIN_WEIGHTED_POOL_EXACT_TOKENS_IN_FOR_BPT_OUT_TAG, joinData.amountsIn, joinData.minimumBPT]
    );
  } else {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256', 'uint256'],
      [JOIN_WEIGHTED_POOL_TOKEN_IN_FOR_EXACT_BPT_OUT_TAG, joinData.bptAmountOut, joinData.enterTokenIndex]
    );
  }
}

const EXIT_WEIGHTED_POOL_EXACT_BPT_IN_FOR_ONE_TOKEN_OUT_TAG = 0;
const EXIT_WEIGHTED_POOL_EXACT_BPT_IN_FOR_TOKENS_OUT_TAG = 1;
const EXIT_WEIGHTED_POOL_BPT_IN_FOR_EXACT_TOKENS_OUT_TAG = 2;

export type ExitWeightedPoolExactBPTInForOneTokenOut = {
  kind: 'ExactBPTInForOneTokenOut';
  bptAmountIn: BigNumberish;
  exitTokenIndex: number;
};

export type ExitWeightedPoolExactBPTInForTokensOut = {
  kind: 'ExactBPTInForTokensOut';
  bptAmountIn: BigNumberish;
};

export type ExitWeightedPoolBPTInForExactTokensOut = {
  kind: 'BPTInForExactTokensOut';
  amountsOut: BigNumberish[];
  maxBPTAmountIn: BigNumberish;
};

export function encodeExitWeightedPool(
  exitData:
    | ExitWeightedPoolExactBPTInForOneTokenOut
    | ExitWeightedPoolExactBPTInForTokensOut
    | ExitWeightedPoolBPTInForExactTokensOut
): string {
  if (exitData.kind == 'ExactBPTInForOneTokenOut') {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256', 'uint256'],
      [EXIT_WEIGHTED_POOL_EXACT_BPT_IN_FOR_ONE_TOKEN_OUT_TAG, exitData.bptAmountIn, exitData.exitTokenIndex]
    );
  } else if (exitData.kind == 'ExactBPTInForTokensOut') {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256'],
      [EXIT_WEIGHTED_POOL_EXACT_BPT_IN_FOR_TOKENS_OUT_TAG, exitData.bptAmountIn]
    );
  } else {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256[]', 'uint256'],
      [EXIT_WEIGHTED_POOL_BPT_IN_FOR_EXACT_TOKENS_OUT_TAG, exitData.amountsOut, exitData.maxBPTAmountIn]
    );
  }
}
