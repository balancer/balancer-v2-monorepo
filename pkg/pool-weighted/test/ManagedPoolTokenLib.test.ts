import { expect } from 'chai';
import { Contract, BigNumber } from 'ethers';
import { hexlify, randomBytes } from 'ethers/lib/utils';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { BigNumberish, bn, fp, negate } from '@balancer-labs/v2-helpers/src/numbers';
import { random } from 'lodash';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';

describe('ManagedPoolTokenLib', () => {
  let lib: Contract;

  const MAX_RELATIVE_ERROR = 0.0005;
  const TEST_RUNS = 100;

  before('deploy lib', async () => {
    lib = await deploy('MockManagedPoolTokenLib');
  });

  function checkMaskedWord(result: string, word: string, offset: number, bits: number): void {
    // Mask to keep all bits outside of the length of bits `bits` at offset `offset`.
    const mask = negate(bn(1).shl(bits).sub(1).shl(offset));

    // All masked bits should match the original word.
    const clearedResult = mask.and(result);
    const clearedWord = mask.and(word);
    expect(clearedResult).to.equal(clearedWord);
  }

  describe('token scaling factor', () => {
    const DECIMAL_DIFF_OFFSET = 128;
    const DECIMAL_DIFF_WIDTH = 5;

    async function assertTokenScalingFactor(
      getter: (word: string) => Promise<BigNumber>,
      setter: (word: string, value: string) => Promise<string>,
      word: string,
      token: Token,
      offset: number,
      bits: number
    ) {
      const result = await setter(word, token.address);
      // Must not have affected unexpected bits.
      checkMaskedWord(result, word, offset, bits);

      // We must be able to restore the original value
      const expectedDecimalsDiff = 18 - token.decimals;
      const expectedScalingFactor = fp(1).mul(bn(10).pow(expectedDecimalsDiff));
      expect(await getter(result)).to.equal(expectedScalingFactor);
    }

    context('when the token has 18 decimals or fewer', () => {
      it('stores the token scaling factor correctly', async () => {
        for (let decimals = 0; decimals < 18; decimals++) {
          const word = hexlify(randomBytes(32));
          const token = await Token.create({ decimals });

          await assertTokenScalingFactor(
            lib.getTokenScalingFactor,
            lib.setTokenScalingFactor,
            word,
            token,
            DECIMAL_DIFF_OFFSET,
            DECIMAL_DIFF_WIDTH
          );
        }
      });
    });

    context('when the token has more than 18 decimals', () => {
      it('reverts', async () => {
        const word = hexlify(randomBytes(32));
        const badToken = await Token.create({ decimals: 19 });
        await expect(lib.setTokenScalingFactor(word, badToken.address)).to.be.revertedWith('SUB_OVERFLOW');
      });
    });
  });

  describe('token weight', () => {
    const START_DENORM_WEIGHT_OFFSET = 0;
    const DENORM_WEIGHT_WIDTH = 128;

    async function assertTokenWeight(
      interpolatedGetter: (
        word: string,
        pctProgress: BigNumberish,
        denormWeightSum: BigNumberish
      ) => Promise<BigNumber>,
      endpointsGetter: (word: string, denormWeightSum: BigNumberish) => Promise<[BigNumber, BigNumber]>,
      setter: (
        word: string,
        normalizedStartWeight: BigNumberish,
        normalizedEndWeight: BigNumberish,
        denormWeightSum: BigNumberish
      ) => Promise<string>,
      word: string,
      normalizedStartWeight: BigNumberish,
      normalizedEndWeight: BigNumberish,
      denormWeightSum: BigNumberish,
      offset: number,
      bits: number
    ) {
      const result = await setter(word, normalizedStartWeight, normalizedEndWeight, denormWeightSum);
      // Must not have affected unexpected bits.
      checkMaskedWord(result, word, offset, bits);

      expect(await interpolatedGetter(result, fp(0), denormWeightSum)).to.equalWithError(
        normalizedStartWeight,
        MAX_RELATIVE_ERROR
      );
      expect(await interpolatedGetter(result, fp(0.5), denormWeightSum)).to.equalWithError(
        bn(normalizedStartWeight).add(normalizedEndWeight).div(2),
        MAX_RELATIVE_ERROR
      );
      expect(await interpolatedGetter(result, fp(1), denormWeightSum)).to.equalWithError(
        normalizedEndWeight,
        MAX_RELATIVE_ERROR
      );

      const [startWeight, endWeight] = await endpointsGetter(result, denormWeightSum);
      expect(startWeight).to.equalWithError(normalizedStartWeight, MAX_RELATIVE_ERROR);
      expect(endWeight).to.equalWithError(normalizedEndWeight, MAX_RELATIVE_ERROR);
    }

    it('stores the token weight correctly', async () => {
      for (let i = 0; i < TEST_RUNS; i++) {
        const word = hexlify(randomBytes(32));
        const normalizedStartWeight = fp(random(0.01, 0.99));
        const normalizedEndWeight = fp(random(0.01, 0.99));
        const denormWeightSum = fp(random(1.0, 5.0));

        await assertTokenWeight(
          lib.getTokenWeight,
          lib.getTokenStartAndEndWeights,
          lib.setTokenWeight,
          word,
          normalizedStartWeight,
          normalizedEndWeight,
          denormWeightSum,
          START_DENORM_WEIGHT_OFFSET,
          DENORM_WEIGHT_WIDTH
        );
      }
    });
  });
});
