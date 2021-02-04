import { ethers } from 'hardhat';

import { BigNumberish } from './numbers';

const JOIN_STABLE_POOL_INIT_TAG = 0;
const JOIN_STABLE_POOL_ALL_TOKENS_IN_FOR_EXACT_BPT_OUT_TAG = 1;

export type JoinStablePoolInit = {
  kind: 'Init';
  amountsIn: BigNumberish[];
};

export type JoinStablePoolAllTokensInForExactBPTOut = {
  kind: 'AllTokensInForExactBPTOut';
  bptAmountOut: BigNumberish;
};

export function encodeJoinStablePool(joinData: JoinStablePoolInit | JoinStablePoolAllTokensInForExactBPTOut): string {
  if (joinData.kind == 'Init') {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256[]'],
      [JOIN_STABLE_POOL_INIT_TAG, joinData.amountsIn]
    );
  } else {
    return ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256'],
      [JOIN_STABLE_POOL_ALL_TOKENS_IN_FOR_EXACT_BPT_OUT_TAG, joinData.bptAmountOut]
    );
  }
}

const EXIT_STABLE_POOL_EXACT_BPT_IN_FOR_ONE_TOKEN_OUT_TAG = 0;

export type ExitStablePoolExactBPTInForAllTokensOut = {
  kind: 'ExactBPTInForAllTokensOut';
  bptAmountIn: BigNumberish;
};

export function encodeExitStablePool(exitData: ExitStablePoolExactBPTInForAllTokensOut): string {
  return ethers.utils.defaultAbiCoder.encode(
    ['uint256', 'uint256'],
    [EXIT_STABLE_POOL_EXACT_BPT_IN_FOR_ONE_TOKEN_OUT_TAG, exitData.bptAmountIn]
  );
}
