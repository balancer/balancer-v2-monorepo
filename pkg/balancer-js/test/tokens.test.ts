import { AddressZero } from '@ethersproject/constants';
import { expect } from 'chai';

import { AssetHelpers } from '../src';

describe('sortTokens', () => {
  const ETH = AddressZero;
  const WETH = '0x000000000000000000000000000000000000000F';
  const assetHelpers = new AssetHelpers(WETH);

  const UNSORTED_TOKENS = [
    '0x0000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000004',
    '0x0000000000000000000000000000000000000003',
  ];

  const SORTED_TOKENS = [
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000003',
    '0x0000000000000000000000000000000000000004',
  ];

  context('when provided only tokens', () => {
    context('when provided only ERC20s', () => {
      it('sorts the tokens in ascending order', () => {
        const [sortedTokens] = assetHelpers.sortTokens(UNSORTED_TOKENS);
        expect(sortedTokens).to.be.deep.eq(SORTED_TOKENS);

        const UNSORTED_TOKENS_WITH_WETH = [WETH, ...UNSORTED_TOKENS];
        const SORTED_TOKENS_WITH_WETH = [...SORTED_TOKENS, WETH];
        const [sortedTokensWithWeth] = assetHelpers.sortTokens(UNSORTED_TOKENS_WITH_WETH);
        expect(sortedTokensWithWeth).to.be.deep.eq(SORTED_TOKENS_WITH_WETH);
      });
    });

    context('when provided a mix of ERC20s and ETH', () => {
      const UNSORTED_TOKENS_WITH_ETH = [ETH, ...UNSORTED_TOKENS];
      const SORTED_TOKENS_WITH_ETH = [...SORTED_TOKENS, ETH];

      it('sorts ETH as if it were WETH', () => {
        const [sortedTokens] = assetHelpers.sortTokens(UNSORTED_TOKENS_WITH_ETH);
        expect(sortedTokens).to.be.deep.eq(SORTED_TOKENS_WITH_ETH);
      });
    });
  });

  context('when provided additional arrays', () => {
    const UNSORTED_NUMBERS = [1, 2, 3, 4];
    const UNSORTED_LETTERS = ['a', 'b', 'c', 'd'];

    it('sorts the tokens in ascending order', () => {
      const [sortedTokens] = assetHelpers.sortTokens(UNSORTED_TOKENS, UNSORTED_NUMBERS, UNSORTED_LETTERS);
      expect(sortedTokens).to.be.deep.eq(SORTED_TOKENS);
    });

    it('maintains relative ordering with tokens array', () => {
      const [sortedTokens, sortedNumbers, sortedLetters] = assetHelpers.sortTokens(
        UNSORTED_TOKENS,
        UNSORTED_NUMBERS,
        UNSORTED_LETTERS
      ) as [string[], number[], string[]];

      // Find the index of each token in the unsorted array and check that other values are mapped to the same position
      sortedTokens.forEach((token, index) => {
        const unsortedIndex = UNSORTED_TOKENS.indexOf(token);
        expect(sortedNumbers[index]).to.be.eq(UNSORTED_NUMBERS[unsortedIndex]);
        expect(sortedLetters[index]).to.be.eq(UNSORTED_LETTERS[unsortedIndex]);
      });
    });
  });
});
