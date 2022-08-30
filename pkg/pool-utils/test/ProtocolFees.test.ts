import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';

describe('ProtocolFees', function () {
  let mock: Contract;

  sharedBeforeEach(async function () {
    mock = await deploy('MockProtocolFees');
  });

  describe('bptForPoolOwnershipPercentage', () => {
    context('when poolPercentage >= 100%', () => {
      it('reverts', async () => {
        await expect(mock.bptForPoolOwnershipPercentage(0, fp(1))).to.be.revertedWith('ZERO_DIVISION');
        await expect(mock.bptForPoolOwnershipPercentage(fp(1), fp(1))).to.be.revertedWith('ZERO_DIVISION');
        await expect(mock.bptForPoolOwnershipPercentage(fp(1), fp(1).add(1))).to.be.revertedWith('ZERO_DIVISION');
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
        expect(await mock.bptForPoolOwnershipPercentage(0, fp(1).sub(1))).to.be.eq(0);
        expect(await mock.bptForPoolOwnershipPercentage(1, fp(1).sub(1))).to.be.eq(fp(1).sub(1));

        expect(await mock.bptForPoolOwnershipPercentage(fp(1), fp(0.5))).to.be.eq(fp(1));
        expect(await mock.bptForPoolOwnershipPercentage(fp(1), fp(0.25))).to.be.almostEqual(fp(0.333333333333333333));
      });
    });
  });
});
