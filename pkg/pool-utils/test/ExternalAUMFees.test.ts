import { BigNumber, Contract } from 'ethers';
import { expect } from 'chai';
import { random } from 'lodash';

import { BigNumberish, bn, fp, FP_100_PCT, FP_ONE, FP_ZERO } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { DAY } from '@balancer-labs/v2-helpers/src/time';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('ExternalAUMFees', function () {
  let lib: Contract;

  sharedBeforeEach(async function () {
    lib = await deploy('MockExternalAUMFees');
  });

  function expectedAUMFees(
    totalSupply: BigNumberish,
    aumFeePercentage: BigNumberish,
    timeElapsed: BigNumberish
  ): BigNumber {
    return bn(totalSupply)
      .mul(timeElapsed)
      .div(365 * DAY)
      .mul(aumFeePercentage)
      .div(FP_100_PCT.sub(aumFeePercentage));
  }

  it('matches the example in the documentation', async () => {
    const totalSupply = fp(1000);
    const expectedBptAmount = fp(1.009372746935833);
    const lastCollectionTime = random(1000, 10000);
    const currentTime = lastCollectionTime + 7 * DAY;
    const aumFeePercentage = fp(0.05);

    expect(
      await lib.getAumFeesBptAmount(totalSupply, currentTime, lastCollectionTime, aumFeePercentage)
    ).to.be.almostEqual(expectedBptAmount, 0.00000001);
  });

  context('when no time has passed since last collection', () => {
    const lastCollectionTime = random(1000, 10000);
    const currentTime = lastCollectionTime - 1;

    it('returns zero', async () => {
      const totalSupply = fp(random(1, 100));
      const aumFeePercentage = fp(random(0, 0.9));

      expect(await lib.getAumFeesBptAmount(totalSupply, currentTime, lastCollectionTime, aumFeePercentage)).to.be.eq(
        fp(0)
      );
    });
  });

  context('when time has passed since last collection', () => {
    const lastCollectionTime = random(1000, 10000);
    const currentTime = lastCollectionTime + random(1, 5 * 365) * DAY;

    context('when AUM fee percentage is zero', () => {
      const aumFeePercentage = FP_ZERO;

      it('returns zero', async () => {
        const totalSupply = FP_ONE;

        expect(await lib.getAumFeesBptAmount(totalSupply, currentTime, lastCollectionTime, aumFeePercentage)).to.be.eq(
          fp(0)
        );
      });
    });

    context('when AUM fee percentage is non-zero', () => {
      const aumFeePercentage = fp(random(0, 0.9));

      context('when total supply is zero', () => {
        const totalSupply = fp(0);

        it('returns zero', async () => {
          expect(
            await lib.getAumFeesBptAmount(totalSupply, currentTime, lastCollectionTime, aumFeePercentage)
          ).to.be.eq(fp(0));
        });
      });

      context('when total supply is nonzero', () => {
        const totalSupply = fp(random(1, 100));

        it('returns the expected amount', async () => {
          const expectedBptAmount = expectedAUMFees(totalSupply, aumFeePercentage, currentTime - lastCollectionTime);
          expect(
            await lib.getAumFeesBptAmount(totalSupply, currentTime, lastCollectionTime, aumFeePercentage)
          ).to.be.almostEqual(expectedBptAmount, 0.00000001);
        });
      });
    });
  });
});
