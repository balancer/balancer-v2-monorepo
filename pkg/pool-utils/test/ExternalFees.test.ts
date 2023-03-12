import { Contract } from 'ethers';
import { expect } from 'chai';

import { fp, FP_100_PCT } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

describe('ExternalFees', function () {
  let mock: Contract;

  sharedBeforeEach(async function () {
    mock = await deploy('MockExternalFees');
  });

  describe('bptForPoolOwnershipPercentage', () => {
    context('when poolPercentage >= 100%', () => {
      it('reverts', async () => {
        await expect(mock.bptForPoolOwnershipPercentage(0, FP_100_PCT)).to.be.revertedWith('ZERO_DIVISION');
        await expect(mock.bptForPoolOwnershipPercentage(fp(1), FP_100_PCT)).to.be.revertedWith('ZERO_DIVISION');
        await expect(mock.bptForPoolOwnershipPercentage(fp(1), FP_100_PCT.add(1))).to.be.revertedWith('ZERO_DIVISION');
        await expect(mock.bptForPoolOwnershipPercentage(fp(1), fp(100))).to.be.revertedWith('ZERO_DIVISION');
      });
    });

    context('when poolPercentage == 0%', () => {
      it('returns zero', async () => {
        expect(await mock.bptForPoolOwnershipPercentage(0, 0)).to.be.eq(0);
        expect(await mock.bptForPoolOwnershipPercentage(fp(100), 0)).to.be.eq(0);
      });
    });

    context('when poolPercentage < 100%', () => {
      it('returns the expected value', async () => {
        expect(await mock.bptForPoolOwnershipPercentage(0, FP_100_PCT.sub(1))).to.be.eq(0);
        expect(await mock.bptForPoolOwnershipPercentage(1, FP_100_PCT.sub(1))).to.be.eq(fp(1).sub(1));

        expect(await mock.bptForPoolOwnershipPercentage(fp(1), fp(0.5))).to.be.eq(fp(1));
        expect(await mock.bptForPoolOwnershipPercentage(fp(1), fp(0.25))).to.be.almostEqual(fp(0.3333333333333333));
      });
    });
  });
});
