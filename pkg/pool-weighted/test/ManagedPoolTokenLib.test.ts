import { expect } from 'chai';
import { Contract, BigNumber, Wallet } from 'ethers';
import { hexlify, randomBytes } from 'ethers/lib/utils';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { BigNumberish, bn, fp, negate } from '@balancer-labs/v2-helpers/src/numbers';
import { random, range } from 'lodash';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { toNormalizedWeights } from '@balancer-labs/balancer-js';
import { ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';

describe('ManagedPoolTokenLib', () => {
  let lib: Contract;

  const MAX_RELATIVE_ERROR = 0.0005;
  const TEST_RUNS = 10;

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

  describe('initialize token', () => {
    const DECIMAL_DIFF_OFFSET = 128;
    const DECIMAL_DIFF_WIDTH = 5;

    async function assertTokenState(
      scalingFactorGetter: (word: string) => Promise<BigNumber>,
      weightsGetter: (word: string, denormWeightSum: BigNumberish) => Promise<[BigNumber, BigNumber]>,
      setter: (token: string, normalizedWeight: BigNumberish, denormWeightSum: BigNumberish) => Promise<string>,
      token: Token,
      normalizedWeight: BigNumberish,
      denormWeightSum: BigNumberish,
      offset: number,
      bits: number
    ) {
      const result = await setter(token.address, normalizedWeight, denormWeightSum);
      // Must not have affected unexpected bits.
      checkMaskedWord(result, ZERO_BYTES32, offset, bits);

      // Scaling factor set correctly.
      const expectedDecimalsDiff = 18 - token.decimals;
      const expectedScalingFactor = fp(1).mul(bn(10).pow(expectedDecimalsDiff));
      expect(await scalingFactorGetter(result)).to.equal(expectedScalingFactor);

      // Weights set correctly.
      const [startWeight, endWeight] = await weightsGetter(result, denormWeightSum);
      expect(startWeight).to.equalWithError(normalizedWeight, MAX_RELATIVE_ERROR);
      expect(endWeight).to.equalWithError(normalizedWeight, MAX_RELATIVE_ERROR);
    }

    context('when the token has 18 decimals or fewer', () => {
      it('stores the token scaling factor and weight correctly', async () => {
        for (let i = 0; i < TEST_RUNS; i++) {
          const token = await Token.create({ decimals: random(0, 18) });
          const normalizedWeight = fp(random(0.01, 0.99));
          const denormWeightSum = fp(random(1.0, 5.0));

          await assertTokenState(
            lib.getTokenScalingFactor,
            lib.getTokenStartAndEndWeights,
            lib.initializeTokenState,
            token,
            normalizedWeight,
            denormWeightSum,
            0,
            DECIMAL_DIFF_OFFSET + DECIMAL_DIFF_WIDTH
          );
        }
      });
    });

    context('when the token has more than 18 decimals', () => {
      it('reverts', async () => {
        const badToken = await Token.create({ decimals: 19 });
        const normalizedWeight = fp(random(0.01, 0.99));
        const denormWeightSum = fp(random(1.0, 5.0));
        await expect(lib.initializeTokenState(badToken.address, normalizedWeight, denormWeightSum)).to.be.revertedWith(
          'SUB_OVERFLOW'
        );
      });
    });
  });

  describe('find minimum weight', () => {
    it('returns the smallest weight passed', async () => {
      for (let i = 0; i < TEST_RUNS; i++) {
        const numTokens = random(2, 40);
        const tokenAddresses = await Promise.all(range(numTokens).map(() => Wallet.createRandom().getAddress()));
        const tokenWeights = toNormalizedWeights(tokenAddresses.map(() => fp(random(1.0, 20.0))));
        const denormWeightSum = fp(random(1.0, 5.0));

        const expectedSmallestWeight = tokenWeights.reduce((min, value) => (min.lte(value) ? min : value));

        const smallestWeight = await lib.callStatic.getMinimumTokenEndWeight(
          tokenAddresses,
          tokenWeights,
          denormWeightSum
        );

        // We don't expect to return exactly the expected smallest weight as `getMinimumTokenEndWeight` involves
        // denormalization and normalization of the token weights so rounding errors are introduced.
        expect(smallestWeight).to.be.almostEqual(expectedSmallestWeight, MAX_RELATIVE_ERROR);
      }
    });
  });
});
