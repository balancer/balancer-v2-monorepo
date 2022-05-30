import { expect } from 'chai';

import { Contract, BigNumber } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';

describe('WordCodec', () => {
  let lib: Contract;

  sharedBeforeEach('deploy lib', async () => {
    lib = await deploy('MockWordCodec');
  });

  function getMaxValue(bits: number): BigNumber {
    return getOverMax(bits).sub(1);
  }

  function getOverMax(bits: number): BigNumber {
    return BigNumber.from(1).shl(bits);
  }

  const bitLengths = [5, 7, 10, 16, 31, 32, 64];
  for (const bitLength of bitLengths) {
    it(`validates ${bitLength} bit inserts`, async () => {
      const MAX_VALID = getMaxValue(bitLength);
      const insertFunction = `insertUint${bitLength}`;

      expect(await lib[insertFunction](ZERO_BYTES32, MAX_VALID, 0)).to.equal(TypesConverter.toBytes32(MAX_VALID));
      await expect(lib[insertFunction](ZERO_BYTES32, getOverMax(bitLength), 0)).to.be.revertedWith('CODEC_OVERFLOW');
    });
  }

  it('validates general insertUint', async () => {
    for (let bits = 2; bits < 256; bits++) {
      const MAX_VALID = getMaxValue(bits);

      expect(await lib.insertUint(ZERO_BYTES32, MAX_VALID, 0, bits)).to.equal(TypesConverter.toBytes32(MAX_VALID));
      await expect(lib.insertUint(ZERO_BYTES32, getOverMax(bits), 0, bits)).to.be.revertedWith('CODEC_OVERFLOW');
    }
  });

  it('validates general encodeUint', async () => {
    for (let bits = 2; bits < 256; bits++) {
      const MAX_VALID = getMaxValue(bits);

      expect(await lib.encodeUint(MAX_VALID, 0, bits)).to.equal(TypesConverter.toBytes32(MAX_VALID));
      await expect(lib.encodeUint(getOverMax(bits), 0, bits)).to.be.revertedWith('CODEC_OVERFLOW');
    }
  });

  it('validates general decodeUint', async () => {
    for (let bits = 2; bits < 256; bits++) {
      const MAX_VALID = getMaxValue(bits);
      const encoded = await lib.encodeUint(MAX_VALID, 0, bits);
      const decoded = await lib.decodeUint(encoded, 0, bits);

      expect(decoded).to.equal(encoded);
    }
  });
});
