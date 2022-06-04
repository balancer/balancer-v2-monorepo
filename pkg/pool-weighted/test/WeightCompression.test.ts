import { expect } from 'chai';
import { Contract, BigNumber } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp, bn } from '@balancer-labs/v2-helpers/src/numbers';

describe('WeightCompression', () => {
  const maxUncompressedValue = fp(10_000);
  let lib: Contract;

  before('deploy lib', async () => {
    lib = await deploy('MockWeightCompression');
  });

  function getMaxValue(bits: number): BigNumber {
    return bn(1).shl(bits).sub(1);
  }

  function getOverMax(bits: number): BigNumber {
    return getMaxValue(bits).add(1);
  }

  describe('general compression', () => {
    context('with invalid input', () => {
      it('reverts with bitLength too low', async () => {
        for (const bitLength of [0, 1]) {
          await expect(lib.fullCompress(50, bitLength, 100)).to.be.revertedWith('OUT_OF_BOUNDS');
        }
      });

      it('reverts with bitLength too high', async () => {
        await expect(lib.fullCompress(50, 256, 100)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      it('reverts with input value out of range', async () => {
        await expect(lib.fullCompress(101, 16, 100)).to.be.revertedWith('OUT_OF_BOUNDS');
      });
    });

    context('with valid input', () => {
      it('returns zero output given zero input', async () => {
        // Limit the range to keep the test runtime reasonable
        for (const bitLength of [2, 8, 16, 32, 64, 128, 255]) {
          expect(await lib.fullCompress(0, bitLength, fp(100))).to.equal(0);
        }
      });

      it('returns max output given max input', async () => {
        // Limit the range to keep the test runtime reasonable
        for (const bitLength of [2, 8, 16, 32, 64, 128, 160]) {
          const maxCompressedValue = getMaxValue(bitLength);

          expect(await lib.fullCompress(maxUncompressedValue, bitLength, maxUncompressedValue)).to.equal(
            maxCompressedValue
          );
        }
      });

      describe('compression combinatorics', () => {
        for (const bitLength of [2, 8, 16, 32, 64, 128, 160]) {
          const maxCompressedValue = getMaxValue(bitLength);

          context(`with bitLength ${bitLength}`, () => {
            for (let p = 10; p < 100; p += 10) {
              const uncompressedValue = maxUncompressedValue.mul(p).div(100);
              const compressedValue = maxCompressedValue.mul(p).div(100);

              it(`compresses ${Math.round(p)}%`, async () => {
                expect(await lib.fullCompress(uncompressedValue, bitLength, maxUncompressedValue)).to.equal(
                  compressedValue
                );
              });

              // Two bits is not enough resolution to recover 10%, 20%, 30%, etc. Test that separately.
              if (bitLength >= 8) {
                it('decompress recovers original value', async () => {
                  // Compression is slightly lossy (most at 8 bits)
                  const error = bitLength == 8 ? 0.1 : 0.0001;
                  expect(await lib.fullDecompress(compressedValue, bitLength, maxUncompressedValue)).to.equalWithError(
                    uncompressedValue,
                    error
                  );
                });
              }
            }
          });
        }

        it('overflows with large bitLengths', async () => {
          await expect(lib.fullCompress(maxUncompressedValue, 250, getMaxValue(250))).to.be.revertedWith(
            'MUL_OVERFLOW'
          );
        });
      });
    });
  });

  describe('general decompression', () => {
    context('with invalid input', () => {
      it('reverts with bitLength too low', async () => {
        for (const bitLength of [0, 1]) {
          await expect(lib.fullDecompress(0, bitLength, 100)).to.be.revertedWith('OUT_OF_BOUNDS');
        }
      });

      it('reverts with bitLength too high', async () => {
        await expect(lib.fullDecompress(0, 256, 100)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      it('reverts with input value out of range', async () => {
        await expect(lib.fullDecompress(getOverMax(16), 16, 100)).to.be.revertedWith('OUT_OF_BOUNDS');
      });
    });

    context('with valid input', () => {
      it('returns zero output given zero input', async () => {
        // Limit the range to keep the test runtime reasonable
        for (const bitLength of [2, 8, 16, 32, 64, 128, 255]) {
          expect(await lib.fullDecompress(0, bitLength, fp(100))).to.equal(0);
        }
      });

      it('returns max output given max input', async () => {
        // Limit the range to keep the test runtime reasonable
        for (const bitLength of [2, 8, 16, 32, 64, 128, 160]) {
          const maxCompressedValue = getMaxValue(bitLength);

          expect(await lib.fullDecompress(maxCompressedValue, bitLength, maxUncompressedValue)).to.equal(
            maxUncompressedValue
          );
        }
      });
    });
  });

  describe('special case compression (input range 0-1)', () => {
    context('with invalid input', () => {
      it('reverts with bitLength too low', async () => {
        for (const bitLength of [0, 1]) {
          await expect(lib.compress(50, bitLength)).to.be.revertedWith('OUT_OF_BOUNDS');
        }
      });

      it('reverts with bitLength too high', async () => {
        await expect(lib.compress(50, 256)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      it('reverts with input value out of range', async () => {
        await expect(lib.compress(fp(1).add(1), 16)).to.be.revertedWith('OUT_OF_BOUNDS');
      });
    });

    context('with valid input', () => {
      it('returns zero output given zero input', async () => {
        // Limit the range to keep the test runtime reasonable
        for (const bitLength of [2, 8, 16, 32, 64, 128, 255]) {
          expect(await lib.compress(0, bitLength)).to.equal(0);
        }
      });

      it('returns max output given max input', async () => {
        // Limit the range to keep the test runtime reasonable
        for (const bitLength of [2, 8, 16, 32, 64, 128, 160]) {
          const maxCompressedValue = getMaxValue(bitLength);

          expect(await lib.compress(fp(1), bitLength)).to.equal(maxCompressedValue);
        }
      });

      describe('compression combinatorics', () => {
        for (const bitLength of [2, 8, 16, 32, 64, 128, 160]) {
          const maxCompressedValue = getMaxValue(bitLength);

          context(`with bitLength ${bitLength}`, () => {
            for (let p = 10; p < 100; p += 10) {
              const compressedValue = maxCompressedValue.mul(p).div(100);
              const uncompressedValue = fp(p).div(100);

              it(`compresses ${Math.round(p)}%`, async () => {
                expect(await lib.compress(uncompressedValue, bitLength)).to.equal(compressedValue);
              });

              // Two bits is not enough resolution to recover 10%, 20%, 30%, etc. Test that separately.
              if (bitLength >= 8) {
                it('decompress recovers original value', async () => {
                  // Compression is slightly lossy (most at 8 bits)
                  const error = bitLength == 8 ? 0.1 : 0.0001;
                  expect(await lib.decompress(compressedValue, bitLength)).to.equalWithError(uncompressedValue, error);
                });
              }
            }
          });
        }

        it('overflows with large bitLengths', async () => {
          await expect(lib.compress(fp(1), 250)).to.be.revertedWith('MUL_OVERFLOW');
        });
      });
    });
  });

  describe('special case decompression (output range 0-1)', () => {
    context('with invalid input', () => {
      it('reverts with bitLength too low', async () => {
        for (const bitLength of [0, 1]) {
          await expect(lib.decompress(0, bitLength)).to.be.revertedWith('OUT_OF_BOUNDS');
        }
      });

      it('reverts with bitLength too high', async () => {
        await expect(lib.decompress(0, 256)).to.be.revertedWith('OUT_OF_BOUNDS');
      });

      it('reverts with input value out of range', async () => {
        await expect(lib.decompress(getOverMax(16), 16)).to.be.revertedWith('OUT_OF_BOUNDS');
      });
    });

    context('with valid input', () => {
      it('returns zero output given zero input', async () => {
        // Limit the range to keep the test runtime reasonable
        for (const bitLength of [2, 8, 16, 32, 64, 128, 255]) {
          expect(await lib.decompress(0, bitLength)).to.equal(0);
        }
      });

      it('returns max output given max input', async () => {
        // Limit the range to keep the test runtime reasonable
        for (const bitLength of [2, 8, 16, 32, 64, 128, 160]) {
          const maxCompressedValue = getMaxValue(bitLength);

          expect(await lib.decompress(maxCompressedValue, bitLength)).to.equal(fp(1));
        }
      });
    });
  });
});
