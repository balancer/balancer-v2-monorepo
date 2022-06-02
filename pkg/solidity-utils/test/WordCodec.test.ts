import { expect } from 'chai';

import { Contract, BigNumber } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';

describe('WordCodec', () => {
  let lib: Contract;

  before('deploy lib', async () => {
    lib = await deploy('MockWordCodec');
  });

  function getMaxValue(bits: number): BigNumber {
    return getOverMax(bits).sub(1);
  }

  function getOverMax(bits: number): BigNumber {
    return BigNumber.from(1).shl(bits);
  }

  function getMaxPositive(bits: number): BigNumber {
    return BigNumber.from(1)
      .shl(bits - 1)
      .sub(1);
  }

  function getMaxNegative(bits: number): BigNumber {
    return BigNumber.from(1).shl(bits).mul(-1).add(1);
  }

  it('validates insertUint', async () => {
    for (let bits = 2; bits < 256; bits++) {
      const MAX_VALID = getMaxValue(bits);

      expect(await lib.insertUint(ZERO_BYTES32, MAX_VALID, 0, bits)).to.equal(TypesConverter.toBytes32(MAX_VALID));
      await expect(lib.insertUint(ZERO_BYTES32, getOverMax(bits), 0, bits)).to.be.revertedWith('CODEC_OVERFLOW');
    }
  });

  it('validates insertInt', async () => {
    for (let bits = 2; bits < 256; bits++) {
      const MAX_VALID = getMaxValue(bits - 1);

      expect(await lib.insertInt(ZERO_BYTES32, MAX_VALID, 0, bits)).to.equal(TypesConverter.toBytes32(MAX_VALID));
      await expect(lib.insertInt(ZERO_BYTES32, getMaxValue(bits), 0, bits)).to.be.revertedWith('CODEC_OVERFLOW');
    }
  });

  it('validates encodeUint', async () => {
    for (let bits = 2; bits < 256; bits++) {
      const MAX_VALID = getMaxValue(bits);

      expect(await lib.encodeUint(MAX_VALID, 0, bits)).to.equal(TypesConverter.toBytes32(MAX_VALID));
      await expect(lib.encodeUint(getOverMax(bits), 0, bits)).to.be.revertedWith('CODEC_OVERFLOW');
    }
  });

  it('validates encodeInt', async () => {
    for (let bits = 2; bits < 256; bits++) {
      const MAX_VALID = getMaxValue(bits - 1);
      expect(await lib.encodeInt(MAX_VALID, 0, bits)).to.equal(TypesConverter.toBytes32(MAX_VALID));
      await expect(lib.encodeInt(getMaxValue(bits), 0, bits)).to.be.revertedWith('CODEC_OVERFLOW');
    }
  });

  it('validates decodeUint', async () => {
    for (let bits = 2; bits < 256; bits++) {
      const MAX_VALID = getMaxValue(bits);
      const encoded = await lib.encodeUint(MAX_VALID, 0, bits);
      const decoded = await lib.decodeUint(encoded, 0, bits);

      expect(decoded).to.equal(encoded);
    }
  });

  it('validates decodeInt', async () => {
    for (let bits = 2; bits < 256; bits++) {
      const MAX_POSITIVE = getMaxValue(bits - 1);

      let encoded = await lib.encodeInt(MAX_POSITIVE, 0, bits);
      let decoded = await lib.decodeInt(encoded, 0, bits);
      expect(decoded).to.equal(encoded);

      // Test negative values
      encoded = await lib.encodeInt(-1, 0, bits);
      decoded = await lib.decodeInt(encoded, 0, bits);
      expect(decoded).to.equal(-1);
    }
  });

  it('rejects bitLength 0', async () => {
    await expect(lib.insertUint(ZERO_BYTES32, getMaxValue(255), 0, 0)).to.be.revertedWith('OUT_OF_BOUNDS');
    await expect(lib.insertInt(ZERO_BYTES32, getMaxValue(255), 0, 0)).to.be.revertedWith('OUT_OF_BOUNDS');
    await expect(lib.encodeUint(getMaxValue(255), 0, 0)).to.be.revertedWith('OUT_OF_BOUNDS');
    await expect(lib.encodeInt(getMaxValue(255), 0, 0)).to.be.revertedWith('OUT_OF_BOUNDS');
  });

  it('rejects bitLength > 255', async () => {
    await expect(lib.insertUint(ZERO_BYTES32, getMaxValue(255), 0, 256)).to.be.revertedWith('OUT_OF_BOUNDS');
    await expect(lib.insertInt(ZERO_BYTES32, getMaxValue(255), 0, 256)).to.be.revertedWith('OUT_OF_BOUNDS');
    await expect(lib.encodeUint(getMaxValue(255), 0, 256)).to.be.revertedWith('OUT_OF_BOUNDS');
    await expect(lib.encodeInt(getMaxValue(255), 0, 256)).to.be.revertedWith('OUT_OF_BOUNDS');
  });

  it('validates max/min positive/negative (insertInt)', async () => {
    for (let bits = 2; bits < 256; bits++) {
      const maxPositive = getMaxPositive(bits);
      const maxNegative = getMaxNegative(bits);

      expect(await lib.insertInt(ZERO_BYTES32, maxPositive, 0, bits)).to.equal(TypesConverter.toBytes32(maxPositive));
      expect(await lib.insertInt(ZERO_BYTES32, maxNegative, 0, bits)).to.equal(TypesConverter.toBytes32(1));

      await expect(lib.insertInt(ZERO_BYTES32, maxPositive.add(1), 0, bits)).to.be.revertedWith('CODEC_OVERFLOW');
      await expect(lib.insertInt(ZERO_BYTES32, maxNegative.sub(1), 0, bits)).to.be.revertedWith('CODEC_OVERFLOW');
    }
  });

  it('validates max/min positive/negative (encodeInt)', async () => {
    for (let bits = 2; bits < 256; bits++) {
      const maxPositive = getMaxPositive(bits);
      const maxNegative = getMaxNegative(bits);

      expect(await lib.encodeInt(maxPositive, 0, bits)).to.equal(TypesConverter.toBytes32(maxPositive));
      expect(await lib.encodeInt(maxNegative, 0, bits)).to.equal(TypesConverter.toBytes32(1));

      await expect(lib.encodeInt(maxPositive.add(1), 0, bits)).to.be.revertedWith('CODEC_OVERFLOW');
      await expect(lib.encodeInt(maxNegative.sub(1), 0, bits)).to.be.revertedWith('CODEC_OVERFLOW');
    }
  });
});
