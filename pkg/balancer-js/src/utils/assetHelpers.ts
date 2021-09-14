import { getAddress } from '@ethersproject/address';
import { AddressZero } from '@ethersproject/constants';
import invariant from 'tiny-invariant';

const cmpTokens = (tokenA: string, tokenB: string): number => (tokenA.toLowerCase() > tokenB.toLowerCase() ? 1 : -1);

const transposeMatrix = (matrix: unknown[][]): unknown[][] =>
  matrix[0].map((_, columnIndex) => matrix.map((row) => row[columnIndex]));

export class AssetHelpers {
  public readonly ETH: string = AddressZero;
  public readonly WETH: string;

  constructor(wethAddress: string) {
    this.WETH = getAddress(wethAddress);
  }

  static isEqual = (addressA: string, addressB: string): boolean => getAddress(addressA) === getAddress(addressB);

  /**
   * Tests whether `token` is ETH (represented by `0x0000...0000`).
   *
   * @param token - the address of the asset to be checked
   */
  isETH = (token: string): boolean => AssetHelpers.isEqual(token, this.ETH);

  /**
   * Tests whether `token` is WETH.
   *
   * @param token - the address of the asset to be checked
   */
  isWETH = (token: string): boolean => AssetHelpers.isEqual(token, this.WETH);

  /**
   * Converts an asset to the equivalent ERC20 address.
   *
   * For ERC20s this will return the passed address but passing ETH (`0x0000...0000`) will return the WETH address
   * @param token - the address of the asset to be translated to an equivalent ERC20
   * @returns the address of translated ERC20 asset
   */
  translateToERC20 = (token: string): string => (this.isETH(token) ? this.WETH : token);

  /**
   * Sorts an array of token addresses into ascending order to match the format expected by the Vault.
   *
   * Passing additional arrays will result in each being sorted to maintain relative ordering to token addresses.
   *
   * The zero address (representing ETH) is sorted as if it were the WETH address.
   * This matches the behaviour expected by the Vault when receiving an array of addresses.
   *
   * @param tokens - an array of token addresses to be sorted in ascending order
   * @param others - a set of arrays to be sorted in the same order as the tokens, e.g. token weights or asset manager addresses
   * @returns an array of the form `[tokens, ...others]` where each subarray has been sorted to maintain its ordering relative to `tokens`
   *
   * @example
   * const [tokens] = sortTokens([tokenB, tokenC, tokenA])
   * const [tokens, weights] = sortTokens([tokenB, tokenC, tokenA], [weightB, weightC, weightA])
   * // where tokens = [tokenA, tokenB, tokenC], weights = [weightA, weightB, weightC]
   */
  sortTokens(tokens: string[], ...others: unknown[][]): [string[], ...unknown[][]] {
    others.forEach((array) => invariant(tokens.length === array.length, 'array length mismatch'));

    // We want to sort ETH as if were WETH so we translate to ERC20s
    const erc20Tokens = tokens.map(this.translateToERC20);

    const transpose = transposeMatrix([erc20Tokens, ...others]) as [string, ...unknown[]][];
    const sortedTranspose = transpose.sort(([tokenA], [tokenB]) => cmpTokens(tokenA, tokenB));
    const [sortedErc20s, ...sortedOthers] = transposeMatrix(sortedTranspose) as [string[], ...unknown[][]];

    // If one of the tokens was ETH, we need to translate back from WETH
    const sortedTokens = tokens.includes(this.ETH)
      ? sortedErc20s.map((token) => (this.isWETH(token) ? this.ETH : token))
      : sortedErc20s;
    return [sortedTokens, ...sortedOthers];
  }
}
