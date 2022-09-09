import { expect } from 'chai';
import { Contract, BigNumber } from 'ethers';
import { hexlify, randomBytes } from 'ethers/lib/utils';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { bn, BigNumberish, negate, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { random } from 'lodash';
import { MAX_UINT32 } from '@balancer-labs/v2-helpers/src/constants';
import { currentTimestamp } from '@balancer-labs/v2-helpers/src/time';

describe('ManagedPoolStorageLib', () => {
  let lib: Contract;

  const MAX_RELATIVE_ERROR = 0.0005;
  const TEST_RUNS = 100;

  before('deploy lib', async () => {
    lib = await deploy('MockManagedPoolStorageLib');
  });

  function checkMaskedWord(result: string, word: string, offset: number, bits: number): void {
    // Mask to keep all bits outside of the length of bits `bits` at offset `offset`.
    const mask = negate(bn(1).shl(bits).sub(1).shl(offset));

    // All masked bits should match the original word.
    const clearedResult = mask.and(result);
    const clearedWord = mask.and(word);
    expect(clearedResult).to.equal(clearedWord);
  }

  async function assertBool(
    getter: (word: string) => Promise<BigNumber>,
    setter: (word: string, value: boolean) => Promise<string>,
    word: string,
    value: boolean,
    offset: number
  ) {
    const result = await setter(word, value);
    // Must not have affected unexpected bits.
    checkMaskedWord(result, word, offset, 1);

    // We must be able to restore the original value
    expect(await getter(result)).to.equal(value);
  }

  function expectedProgress(now: BigNumber, startTime: BigNumberish, endTime: BigNumberish): BigNumber {
    if (now.lt(startTime)) {
      return bn(0);
    } else if (now.gte(endTime)) {
      return fp(1);
    } else {
      return now.sub(startTime).mul(fp(1)).div(bn(endTime).sub(startTime));
    }
  }

  describe('swaps enabled', () => {
    const SWAP_ENABLED_OFFSET = 254;

    it('stores the swaps enabled flag correctly', async () => {
      for (let i = 0; i < TEST_RUNS; i++) {
        const word = hexlify(randomBytes(32));

        await assertBool(lib.getSwapsEnabled, lib.setSwapsEnabled, word, true, SWAP_ENABLED_OFFSET);
        await assertBool(lib.getSwapsEnabled, lib.setSwapsEnabled, word, false, SWAP_ENABLED_OFFSET);
      }
    });
  });

  describe('lp allowlist', () => {
    const MUST_ALLOWLIST_LPS_OFFSET = 255;

    it('stores the lp allowlist flag correctly', async () => {
      for (let i = 0; i < TEST_RUNS; i++) {
        const word = hexlify(randomBytes(32));

        await assertBool(lib.getLPAllowlistEnabled, lib.setLPAllowlistEnabled, word, true, MUST_ALLOWLIST_LPS_OFFSET);
        await assertBool(lib.getLPAllowlistEnabled, lib.setLPAllowlistEnabled, word, false, MUST_ALLOWLIST_LPS_OFFSET);
      }
    });
  });

  describe('weight change progress', () => {
    const WEIGHT_START_TIME_OFFSET = 0;
    const TOTAL_WEIGHT_FIELDS_WIDTH = 64;

    async function assertSetWeightChange(
      getter: (word: string) => Promise<BigNumber>,
      setter: (word: string, startTime: BigNumberish, endTime: BigNumberish) => Promise<string>,
      word: string,
      startTime: BigNumberish,
      endTime: BigNumberish
    ) {
      const result = await setter(word, startTime, endTime);
      // Must not have affected unexpected bits.
      checkMaskedWord(result, word, WEIGHT_START_TIME_OFFSET, TOTAL_WEIGHT_FIELDS_WIDTH);

      const now = await currentTimestamp();

      expect(await getter(result)).to.equalWithError(expectedProgress(now, startTime, endTime), MAX_RELATIVE_ERROR);
    }

    it('stores the weight change timestamps correctly', async () => {
      for (let i = 0; i < TEST_RUNS; i++) {
        const word = hexlify(randomBytes(32));
        const startTime = bn(random(MAX_UINT32.toNumber()));
        const endTime = bn(random(startTime.toNumber(), MAX_UINT32.toNumber()));

        await assertSetWeightChange(
          lib.getGradualWeightChangeProgress,
          lib.setWeightChangeData,
          word,
          startTime,
          endTime
        );
      }
    });
  });

  describe('swap fee', () => {
    const SWAP_FEE_START_TIME_OFFSET = 64;
    const TOTAL_SWAP_FEE_FIELDS_WIDTH = 190;

    const MAX_RELATIVE_ERROR = 0.0005;

    function getSwapFee(
      now: BigNumber,
      startTime: BigNumberish,
      endTime: BigNumberish,
      startSwapFeePercentage: BigNumberish,
      endSwapFeePercentage: BigNumberish
    ): BigNumber {
      const pct = expectedProgress(now, startTime, endTime);
      if (bn(startSwapFeePercentage).lt(endSwapFeePercentage)) {
        // Swap fee is increasing
        const expectedSwapFee = bn(startSwapFeePercentage).add(
          bn(endSwapFeePercentage).sub(startSwapFeePercentage).mul(pct).div(fp(1))
        );
        return expectedSwapFee;
      } else {
        // Swap fee is decreasing (or not changing)
        const expectedSwapFee = bn(startSwapFeePercentage).sub(
          bn(startSwapFeePercentage).sub(endSwapFeePercentage).mul(pct).div(fp(1))
        );
        return expectedSwapFee;
      }
    }

    async function assertSetSwapFee(
      getter: (word: string) => Promise<BigNumber>,
      setter: (
        word: string,
        startTime: BigNumberish,
        endTime: BigNumberish,
        startSwapFeePercentage: BigNumberish,
        endSwapFeePercentage: BigNumberish
      ) => Promise<string>,
      word: string,
      startTime: BigNumberish,
      endTime: BigNumberish,
      startSwapFeePercentage: BigNumberish,
      endSwapFeePercentage: BigNumberish
    ) {
      const result = await setter(word, startTime, endTime, startSwapFeePercentage, endSwapFeePercentage);
      // Must not have affected unexpected bits.
      checkMaskedWord(result, word, SWAP_FEE_START_TIME_OFFSET, TOTAL_SWAP_FEE_FIELDS_WIDTH);

      const now = await currentTimestamp();
      const expectedSwapFee = getSwapFee(now, startTime, endTime, startSwapFeePercentage, endSwapFeePercentage);
      expect(await getter(result)).to.equalWithError(expectedSwapFee, MAX_RELATIVE_ERROR);
    }

    it('stores the swap fee data correctly', async () => {
      for (let i = 0; i < TEST_RUNS; i++) {
        const word = hexlify(randomBytes(32));
        const startTime = bn(random(MAX_UINT32.toNumber()));
        const endTime = bn(random(startTime.toNumber(), MAX_UINT32.toNumber()));
        const startSwapFeePercentage = bn(random(10 ** 18));
        const endSwapFeePercentage = bn(random(10 ** 18));

        await assertSetSwapFee(
          lib.getSwapFeePercentage,
          lib.setSwapFeeData,
          word,
          startTime,
          endTime,
          startSwapFeePercentage,
          endSwapFeePercentage
        );
      }
    });
  });
});
