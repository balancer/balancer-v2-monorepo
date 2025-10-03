import { defaultAbiCoder } from '@ethersproject/abi';
import { BigNumberish } from '@ethersproject/bignumber';

export enum StablePoolJoinKind {
  INIT = 0,
  EXACT_TOKENS_IN_FOR_BPT_OUT,
  TOKEN_IN_FOR_EXACT_BPT_OUT,
  ALL_TOKENS_IN_FOR_EXACT_BPT_OUT,
}

export enum StablePoolExitKind {
  EXACT_BPT_IN_FOR_ONE_TOKEN_OUT = 0,
  BPT_IN_FOR_EXACT_TOKENS_OUT,
  EXACT_BPT_IN_FOR_ALL_TOKENS_OUT,
}

export class StablePoolEncoder {
  /**
   * Cannot be constructed.
   */
  private constructor() {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
  }

  /**
   * Encodes the userData parameter for providing the initial liquidity to a StablePool
   * @param initialBalances - the amounts of tokens to send to the pool to form the initial balances
   */
  static joinInit = (amountsIn: BigNumberish[]): string =>
    defaultAbiCoder.encode(['uint256', 'uint256[]'], [StablePoolJoinKind.INIT, amountsIn]);

  /**
   * Encodes the userData parameter for joining a StablePool with exact token inputs
   * @param amountsIn - the amounts of each token to deposit in the pool as liquidity
   * @param minimumBPT - the minimum acceptable BPT to receive in return for deposited tokens
   */
  static joinExactTokensInForBPTOut = (amountsIn: BigNumberish[], minimumBPT: BigNumberish): string =>
    defaultAbiCoder.encode(
      ['uint256', 'uint256[]', 'uint256'],
      [StablePoolJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, amountsIn, minimumBPT]
    );

  /**
   * Encodes the userData parameter for joining a StablePool to receive an exact amount of BPT
   * @param bptAmountOut - the amount of BPT to be minted
   * @param enterTokenIndex - the index of the token to be provided as liquidity
   */
  static joinTokenInForExactBPTOut = (bptAmountOut: BigNumberish, enterTokenIndex: number): string =>
    defaultAbiCoder.encode(
      ['uint256', 'uint256', 'uint256'],
      [StablePoolJoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT, bptAmountOut, enterTokenIndex]
    );

  /**
   * Encodes the userData parameter for joining a StablePool proportionally
   * @param bptAmountOut - the amount of BPT to be minted
   */
  static joinAllTokensInForExactBptOut = (bptAmountOut: BigNumberish): string =>
    defaultAbiCoder.encode(['uint256', 'uint256'], [StablePoolJoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT, bptAmountOut]);

  /**
   * Encodes the userData parameter for exiting a StablePool by removing a single token in return for an exact amount of BPT
   * @param bptAmountIn - the amount of BPT to be burned
   * @param exitTokenIndex - the index of the token to be removed from the pool
   */
  static exitExactBPTInForOneTokenOut = (bptAmountIn: BigNumberish, exitTokenIndex: number): string =>
    defaultAbiCoder.encode(
      ['uint256', 'uint256', 'uint256'],
      [StablePoolExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, bptAmountIn, exitTokenIndex]
    );

  /**
   * Encodes the userData parameter for exiting a StablePool by removing exact amounts of tokens
   * @param amountsOut - the amounts of each token to be withdrawn from the pool
   * @param maxBPTAmountIn - the minimum acceptable BPT to burn in return for withdrawn tokens
   */
  static exitBPTInForExactTokensOut = (amountsOut: BigNumberish[], maxBPTAmountIn: BigNumberish): string =>
    defaultAbiCoder.encode(
      ['uint256', 'uint256[]', 'uint256'],
      [StablePoolExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT, amountsOut, maxBPTAmountIn]
    );

  /**
   * Encodes the userData parameter for exiting a StablePool proportionally
   * @param bptAmountIn - the amount of BPT to burn in exchange for withdrawn tokens
   */
  static exitExactBptInForTokensOut = (bptAmountIn: BigNumberish): string =>
    defaultAbiCoder.encode(['uint256', 'uint256'], [StablePoolExitKind.EXACT_BPT_IN_FOR_ALL_TOKENS_OUT, bptAmountIn]);
}
