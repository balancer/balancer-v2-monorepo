import { expect } from 'chai';

import { Contract, BigNumber, BigNumberish } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { bn, negate } from '@balancer-labs/v2-helpers/src/numbers';
import { random } from 'lodash';

describe('WordCodec', () => {
  let lib: Contract;

  before('deploy lib', async () => {
    lib = await deploy('MockWordCodec');
  });

  function getMaxUnsigned(bits: number): BigNumber {
    return bn(1).shl(bits).sub(1);
  }

  function getMaxSigned(bits: number): BigNumber {
    return bn(1)
      .shl(bits - 1)
      .sub(1);
  }

  function getMinSigned(bits: number): BigNumber {
    return bn(1)
      .shl(bits - 1)
      .mul(-1);
  }

  describe('encode', () => {
    describe('unsigned', () => {
      it('reverts with zero bit length', async () => {
        await expect(lib.encodeUint(0, 0, 0)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      it('reverts with 256 bit length', async () => {
        await expect(lib.encodeUint(0, 0, 256)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      it('reverts with large offset', async () => {
        await expect(lib.encodeUint(0, 256, 0)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      async function assertUnsignedEncoding(value: BigNumberish, offset: number, bits: number) {
        const result = await lib.encodeUint(value, offset, bits);

        // We must be able to restore the original value
        expect(await lib.decodeUint(result, offset, bits)).to.equal(value);
        // All other bits should be clear
        expect(negate(bn(1).shl(bits).sub(1).shl(offset)).and(bn(result))).to.equal(0);
      }

      // We want to be able to use 2 bit values, so we can only go up to offset 254. We only cover part of the offset
      // range to keep test duration reasonable.
      for (const offset of [0, 50, 150, 254]) {
        const MAX_BITS = Math.min(256 - offset, 255);

        context(`with offset ${offset}`, () => {
          it('encodes small values of all bit sizes', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await assertUnsignedEncoding(1, offset, bits);
            }
          });

          it('encodes max values of all bit sizes', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await assertUnsignedEncoding(getMaxUnsigned(bits), offset, bits);
            }
          });

          it('reverts with large values', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await expect(assertUnsignedEncoding(getMaxUnsigned(bits).add(1), offset, bits)).to.be.revertedWith(
                'CODEC_OVERFLOW'
              );
            }
          });

          it('reverts with large bitsize', async () => {
            await expect(assertUnsignedEncoding(0, offset, MAX_BITS + 1)).to.be.revertedWith('OUT_OF_BOUNDS');
          });
        });
      }
    });

    describe('signed', () => {
      it('reverts with zero bit length', async () => {
        await expect(lib.encodeInt(0, 0, 0)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      it('reverts with 256 bit length', async () => {
        await expect(lib.encodeInt(0, 0, 256)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      it('reverts with large offset', async () => {
        await expect(lib.encodeInt(0, 256, 0)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      async function assertSignedEncoding(value: BigNumberish, offset: number, bits: number) {
        const result = await lib.encodeInt(value, offset, bits);

        // We must be able to restore the original value
        expect(await lib.decodeInt(result, offset, bits)).to.equal(value);
        // All other bits should be clear
        expect(negate(bn(1).shl(bits).sub(1).shl(offset)).and(bn(result))).to.equal(0);
      }

      // We want to be able to use 2 bit values, so we can only go up to offset 254. We only cover part of the offset
      // range to keep test duration reasonable.
      for (const offset of [0, 50, 150, 254]) {
        const MAX_BITS = Math.min(256 - offset, 255);

        context(`with offset ${offset}`, () => {
          it('encodes small positive values of all bit sizes', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await assertSignedEncoding(1, offset, bits);
            }
          });

          it('encodes small negative values of all bit sizes', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await assertSignedEncoding(-1, offset, bits);
            }
          });

          it('encodes max values of all bit sizes', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await assertSignedEncoding(getMaxSigned(bits), offset, bits);
            }
          });

          it('encodes min values of all bit sizes', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await assertSignedEncoding(getMinSigned(bits), offset, bits);
            }
          });

          it('reverts with large positive values', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await expect(assertSignedEncoding(getMaxSigned(bits).add(1), offset, bits)).to.be.revertedWith(
                'CODEC_OVERFLOW'
              );
            }
          });

          it('reverts with large negative values', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await expect(assertSignedEncoding(getMinSigned(bits).sub(1), offset, bits)).to.be.revertedWith(
                'CODEC_OVERFLOW'
              );
            }
          });

          it('reverts with large bitsize', async () => {
            await expect(assertSignedEncoding(0, offset, MAX_BITS + 1)).to.be.revertedWith('OUT_OF_BOUNDS');
          });
        });
      }
    });
  });

  describe('insert', () => {
    const word = bn(random(2 ** 255));

    describe('unsigned', () => {
      it('reverts with zero bit length', async () => {
        await expect(lib.insertUint(word, 0, 0, 0)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      it('reverts with 256 bit length', async () => {
        await expect(lib.insertUint(word, 0, 0, 256)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      it('reverts with large offset', async () => {
        await expect(lib.insertUint(word, 256, 0, 256)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      async function assertUnsignedInsertion(value: BigNumberish, offset: number, bits: number) {
        const result = await lib.insertUint(word, value, offset, bits);

        // We must be able to restore the original value
        expect(await lib.decodeUint(result, offset, bits)).to.equal(value);
        // All other bits should match the original word
        const mask = negate(bn(1).shl(bits).sub(1).shl(offset));
        const clearedResult = mask.and(result);
        const clearedWord = mask.and(word);
        expect(clearedResult).to.equal(clearedWord);
      }

      // We want to be able to use 2 bit values, so we can only go up to offset 254. We only cover part of the offset
      // range to keep test duration reasonable.
      for (const offset of [0, 50, 150, 254]) {
        const MAX_BITS = Math.min(256 - offset, 255);

        context(`with offset ${offset}`, () => {
          it('inserts small values of all bit sizes', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await assertUnsignedInsertion(1, offset, bits);
            }
          });

          it('inserts max values of all bit sizes', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await assertUnsignedInsertion(getMaxUnsigned(bits), offset, bits);
            }
          });

          it('reverts with large values', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await expect(assertUnsignedInsertion(getMaxUnsigned(bits).add(1), offset, bits)).to.be.revertedWith(
                'CODEC_OVERFLOW'
              );
            }
          });

          it('reverts with large bitsize', async () => {
            await expect(assertUnsignedInsertion(0, offset, MAX_BITS + 1)).to.be.revertedWith('OUT_OF_BOUNDS');
          });
        });
      }
    });

    describe('signed', () => {
      it('reverts with zero bit length', async () => {
        await expect(lib.insertInt(word, 0, 0, 0)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      it('reverts with 256 bit length', async () => {
        await expect(lib.insertInt(word, 0, 0, 256)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      it('reverts with large offset', async () => {
        await expect(lib.insertInt(word, 256, 0, 256)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      async function assertSignedInsertion(value: BigNumberish, offset: number, bits: number) {
        const result = await lib.insertInt(word, value, offset, bits);

        // We must be able to restore the original value
        expect(await lib.decodeInt(result, offset, bits)).to.equal(value);
        // All other bits should match the original word
        const mask = negate(bn(1).shl(bits).sub(1).shl(offset));
        const clearedResult = mask.and(result);
        const clearedWord = mask.and(word);
        expect(clearedResult).to.equal(clearedWord);
      }

      // We want to be able to use 2 bit values, so we can only go up to offset 254. We only cover part of the offset
      // range to keep test duration reasonable.
      for (const offset of [0, 50, 150, 254]) {
        const MAX_BITS = Math.min(256 - offset, 255);

        context(`with offset ${offset}`, () => {
          it('inserts small positive values of all bit sizes', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await assertSignedInsertion(1, offset, bits);
            }
          });

          it('inserts small negative values of all bit sizes', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await assertSignedInsertion(-1, offset, bits);
            }
          });

          it('inserts max values of all bit sizes', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await assertSignedInsertion(getMaxSigned(bits), offset, bits);
            }
          });

          it('inserts min values of all bit sizes', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await assertSignedInsertion(getMinSigned(bits), offset, bits);
            }
          });

          it('reverts with large positive values', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await expect(assertSignedInsertion(getMaxSigned(bits).add(1), offset, bits)).to.be.revertedWith(
                'CODEC_OVERFLOW'
              );
            }
          });

          it('reverts with large negative values', async () => {
            for (let bits = 2; bits <= MAX_BITS; bits++) {
              await expect(assertSignedInsertion(getMinSigned(bits).sub(1), offset, bits)).to.be.revertedWith(
                'CODEC_OVERFLOW'
              );
            }
          });

          it('reverts with large bitsize', async () => {
            await expect(assertSignedInsertion(0, offset, MAX_BITS + 1)).to.be.revertedWith('OUT_OF_BOUNDS');
          });
        });
      }
    });
  });
});
