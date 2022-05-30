import { expect } from 'chai';

import { Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_BYTES32, MAX_UINT64 } from '@balancer-labs/v2-helpers/src/constants';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';

describe('WordCodec', () => {
  let lib: Contract;

  sharedBeforeEach('deploy lib', async () => {
    lib = await deploy('MockWordCodec');
  });

  function getMaxValue(bits: number): number {
    return 2 ** bits - 1;
  }

  function getOverMax(bits: number): number {
    return 2 ** bits;
  }

  // Can this be made a loop somehow?

  it('validates 5 bit inserts', async () => {
    const MAX_VALID = getMaxValue(5);

    expect(await lib.insertUint5(ZERO_BYTES32, MAX_VALID, 0)).to.equal(TypesConverter.toBytes32(MAX_VALID));
    await expect(lib.insertUint5(ZERO_BYTES32, getOverMax(5), 0)).to.be.revertedWith('CODEC_OVERFLOW');
  });

  it('validates 7 bit inserts', async () => {
    const MAX_VALID = getMaxValue(7);

    expect(await lib.insertUint7(ZERO_BYTES32, MAX_VALID, 0)).to.equal(TypesConverter.toBytes32(MAX_VALID));
    await expect(lib.insertUint7(ZERO_BYTES32, getOverMax(7), 0)).to.be.revertedWith('CODEC_OVERFLOW');
  });

  it('validates 10 bit inserts', async () => {
    const MAX_VALID = getMaxValue(10);

    expect(await lib.insertUint10(ZERO_BYTES32, MAX_VALID, 0)).to.equal(TypesConverter.toBytes32(MAX_VALID));
    await expect(lib.insertUint10(ZERO_BYTES32, getOverMax(10), 0)).to.be.revertedWith('CODEC_OVERFLOW');
  });

  it('validates 16 bit inserts', async () => {
    const MAX_VALID = getMaxValue(16);

    expect(await lib.insertUint16(ZERO_BYTES32, MAX_VALID, 0)).to.equal(TypesConverter.toBytes32(MAX_VALID));
    await expect(lib.insertUint16(ZERO_BYTES32, getOverMax(16), 0)).to.be.revertedWith('CODEC_OVERFLOW');
  });

  it('validates 31 bit inserts', async () => {
    const MAX_VALID = getMaxValue(31);

    expect(await lib.insertUint31(ZERO_BYTES32, MAX_VALID, 0)).to.equal(TypesConverter.toBytes32(MAX_VALID));
    await expect(lib.insertUint31(ZERO_BYTES32, getOverMax(31), 0)).to.be.revertedWith('CODEC_OVERFLOW');
  });

  it('validates 32 bit inserts', async () => {
    const MAX_VALID = getMaxValue(32);

    expect(await lib.insertUint32(ZERO_BYTES32, MAX_VALID, 0)).to.equal(TypesConverter.toBytes32(MAX_VALID));
    await expect(lib.insertUint32(ZERO_BYTES32, getOverMax(32), 0)).to.be.revertedWith('CODEC_OVERFLOW');
  });

  it('validates 64 bit inserts', async () => {
    // Starting to get number overflows here
    const MAX_VALID_64 = '0x000000000000000000000000000000000000000000000000ffffffffffffffff';

    expect(await lib.insertUint64(ZERO_BYTES32, MAX_UINT64, 0)).to.equal(MAX_VALID_64);
    await expect(lib.insertUint64(ZERO_BYTES32, MAX_UINT64.add(1), 0)).to.be.revertedWith('CODEC_OVERFLOW');
  });

  it('validates general encodeUint', async () => {
    for (let bits = 2; bits < 31; bits++) {
      const MAX_VALID = getMaxValue(bits);

      expect(await lib.encodeUint(MAX_VALID, 0, bits)).to.equal(TypesConverter.toBytes32(MAX_VALID));
      await expect(lib.encodeUint(getOverMax(bits), 0, bits)).to.be.revertedWith('CODEC_OVERFLOW');
    }
  });
});
