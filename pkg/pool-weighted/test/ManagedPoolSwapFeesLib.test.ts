import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import {
  WEEK,
  DAY,
  MINUTE,
  advanceToTimestamp,
  currentTimestamp,
  receiptTimestamp,
} from '@balancer-labs/v2-helpers/src/time';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { Interface } from '@ethersproject/abi';

describe('ManagedPoolSwapFeesLib', function () {
  let pool: Contract;
  let libInterface: Interface;

  const MIN_SWAP_FEE = fp(0.000001);
  const MAX_SWAP_FEE = fp(0.8);

  const INITIAL_SWAP_FEE = MIN_SWAP_FEE.add(1);
  const VALID_SWAP_FEE = MIN_SWAP_FEE.add(MAX_SWAP_FEE).div(2);
  const TOO_LOW_SWAP_FEE = MIN_SWAP_FEE.sub(1);
  const TOO_HIGH_SWAP_FEE = MAX_SWAP_FEE.add(1);

  sharedBeforeEach('deploy MockManagedPoolSwapFeesLib and initialize', async () => {
    pool = await deploy('MockManagedPoolSwapFeesLib');
    libInterface = new Interface((await getArtifact('ManagedPoolSwapFeesLib')).abi);

    await pool.setSwapFeePercentage(INITIAL_SWAP_FEE);
  });

  describe('swap fee validation', () => {
    it('rejects swap fees above maximum', async () => {
      await expect(pool.validateSwapFeePercentage(TOO_HIGH_SWAP_FEE)).to.be.revertedWith('MAX_SWAP_FEE_PERCENTAGE');
    });

    it('rejects swap fee below minimum', async () => {
      await expect(pool.validateSwapFeePercentage(TOO_LOW_SWAP_FEE)).to.be.revertedWith('MIN_SWAP_FEE_PERCENTAGE');
    });

    it('accepts valid swap fees', async () => {
      await expect(pool.validateSwapFeePercentage(VALID_SWAP_FEE)).to.be.not.be.reverted;
    });
  });

  describe('setSwapFeePercentage', () => {
    it('cannot set swap fee above maximum', async () => {
      await expect(pool.setSwapFeePercentage(TOO_HIGH_SWAP_FEE)).to.be.revertedWith('MAX_SWAP_FEE_PERCENTAGE');
    });

    it('cannot set swap fee below minimum', async () => {
      await expect(pool.setSwapFeePercentage(TOO_LOW_SWAP_FEE)).to.be.revertedWith('MIN_SWAP_FEE_PERCENTAGE');
    });

    it('emits a SwapFeePercentageChanged event', async () => {
      const tx = await pool.setSwapFeePercentage(VALID_SWAP_FEE);
      expectEvent.inIndirectReceipt(await tx.wait(), libInterface, 'SwapFeePercentageChanged', {
        swapFeePercentage: VALID_SWAP_FEE,
      });
    });

    it('updates the swap fee', async () => {
      expect(await pool.getSwapFeePercentage()).to.be.eq(INITIAL_SWAP_FEE);
      await pool.setSwapFeePercentage(VALID_SWAP_FEE);
      expect(await pool.getSwapFeePercentage()).to.be.eq(VALID_SWAP_FEE);
    });
  });

  describe('startGradualSwapFeeChange', () => {
    const UPDATE_DURATION = DAY * 2;

    context('with invalid parameters', () => {
      let start: BigNumber;
      let end: BigNumber;

      sharedBeforeEach(async () => {
        const now = await currentTimestamp();
        start = now.add(100);
        end = start.add(WEEK);
      });

      it('cannot set starting swap fee below minimum', async () => {
        await expect(pool.startGradualSwapFeeChange(start, end, TOO_LOW_SWAP_FEE, VALID_SWAP_FEE)).to.be.revertedWith(
          'MIN_SWAP_FEE_PERCENTAGE'
        );
      });

      it('cannot set starting swap fee above maximum', async () => {
        await expect(pool.startGradualSwapFeeChange(start, end, TOO_HIGH_SWAP_FEE, VALID_SWAP_FEE)).to.be.revertedWith(
          'MAX_SWAP_FEE_PERCENTAGE'
        );
      });

      it('cannot set ending swap fee below minimum', async () => {
        await expect(pool.startGradualSwapFeeChange(start, end, VALID_SWAP_FEE, TOO_LOW_SWAP_FEE)).to.be.revertedWith(
          'MIN_SWAP_FEE_PERCENTAGE'
        );
      });

      it('cannot set ending swap fee above maximum', async () => {
        await expect(pool.startGradualSwapFeeChange(start, end, VALID_SWAP_FEE, TOO_HIGH_SWAP_FEE)).to.be.revertedWith(
          'MAX_SWAP_FEE_PERCENTAGE'
        );
      });

      it('cannot have swap fee change finish before it starts', async () => {
        await expect(pool.startGradualSwapFeeChange(end, start, VALID_SWAP_FEE, VALID_SWAP_FEE)).to.be.revertedWith(
          'GRADUAL_UPDATE_TIME_TRAVEL'
        );
      });
    });

    function itStartsAGradualWeightChangeCorrectly(startTimeOffset: BigNumberish, ongoingSwapFeeChange: boolean) {
      let now, startTime: BigNumber, endTime: BigNumber;
      const START_SWAP_FEE = INITIAL_SWAP_FEE;
      const END_SWAP_FEE = VALID_SWAP_FEE;

      sharedBeforeEach('calculate gradual update parameters', async () => {
        now = await currentTimestamp();
        startTime = now.add(startTimeOffset);
        endTime = startTime.add(UPDATE_DURATION);

        // Make sure start <> end (in case it got changed above)
        expect(START_SWAP_FEE).to.not.equal(END_SWAP_FEE);
      });

      it('updates the swap fee parameters', async () => {
        const tx = await pool.startGradualSwapFeeChange(startTime, endTime, START_SWAP_FEE, END_SWAP_FEE);

        const updateParams = await pool.getGradualSwapFeeUpdateParams();

        // If the start time has already passed (due to multisig signer wrangling / a tx being slow to confirm),
        // then we bring it forwards to block.timestamp to avoid reverting or causing a discontinuity in swap fees.
        const txTimestamp = bn(await receiptTimestamp(tx.wait()));
        const expectedStartTime = startTime.gt(txTimestamp) ? startTime : txTimestamp;

        expect(updateParams.startTime).to.eq(expectedStartTime);
        expect(updateParams.endTime).to.eq(endTime);
        expect(updateParams.startSwapFeePercentage).to.equal(START_SWAP_FEE);
        expect(updateParams.endSwapFeePercentage).to.equal(END_SWAP_FEE);
      });

      it('emits a GradualSwapFeeUpdateScheduled event', async () => {
        const receipt = await pool.startGradualSwapFeeChange(startTime, endTime, START_SWAP_FEE, END_SWAP_FEE);

        const txTimestamp = bn(await receiptTimestamp(receipt));
        const expectedStartTime = startTime.gt(txTimestamp) ? startTime : txTimestamp;

        expectEvent.inIndirectReceipt(await receipt.wait(), libInterface, 'GradualSwapFeeUpdateScheduled', {
          startTime: expectedStartTime,
          endTime: endTime,
          startSwapFeePercentage: START_SWAP_FEE,
          endSwapFeePercentage: END_SWAP_FEE,
        });
      });

      // We don't run this test when an ongoing swap fee change is in progress as we can't guarantee the prior condition
      if (!ongoingSwapFeeChange) {
        context('when the starting swap fee is equal to the current swap fee', () => {
          sharedBeforeEach(async () => {
            expect(await pool.getSwapFeePercentage()).to.equal(START_SWAP_FEE);
          });

          it('does not emit a SwapFeePercentageChanged event', async () => {
            const tx = await pool.startGradualSwapFeeChange(startTime, endTime, START_SWAP_FEE, END_SWAP_FEE);
            expectEvent.notEmitted(await tx.wait(), 'SwapFeePercentageChanged');
          });
        });
      }

      context('when the starting swap fee is different from the current swap fee', () => {
        sharedBeforeEach(async () => {
          await pool.setSwapFeePercentage(MAX_SWAP_FEE);
          expect(await pool.getSwapFeePercentage()).to.not.equal(START_SWAP_FEE);
        });

        it('emits a SwapFeePercentageChanged event', async () => {
          const tx = await pool.startGradualSwapFeeChange(startTime, endTime, START_SWAP_FEE, END_SWAP_FEE);
          expectEvent.inIndirectReceipt(await tx.wait(), libInterface, 'SwapFeePercentageChanged', {
            swapFeePercentage: START_SWAP_FEE,
          });
        });
      });
    }

    context('when gradual update start time is the future', () => {
      const START_TIME_OFFSET = MINUTE * 10;

      context('with no ongoing swap fee change', () => {
        itStartsAGradualWeightChangeCorrectly(START_TIME_OFFSET, false);
      });

      context('with an ongoing swap fee change', () => {
        sharedBeforeEach(async () => {
          // Before we schedule the "real" swap fee update we perform another one which ensures that the start and
          // end swap fee percentages held in storage are not equal. This ensures that we're calculating the
          // current swap fee correctly.
          const now = await currentTimestamp();

          await pool.startGradualSwapFeeChange(now.add(100), now.add(1000), MIN_SWAP_FEE, MAX_SWAP_FEE);
          await advanceToTimestamp(now.add(10));
        });

        itStartsAGradualWeightChangeCorrectly(START_TIME_OFFSET, true);
      });
    });

    context('when gradual update start time is in the past', () => {
      const START_TIME_OFFSET = -1 * MINUTE * 10;

      context('with no ongoing swap fee change', () => {
        itStartsAGradualWeightChangeCorrectly(START_TIME_OFFSET, false);
      });

      context('with an ongoing swap fee change', () => {
        sharedBeforeEach(async () => {
          // Before we schedule the "real" swap fee update we perform another one which ensures that the start and
          // end swap fee percentages held in storage are not equal. This ensures that we're calculating the
          // current swap fee correctly.
          const now = await currentTimestamp();

          await pool.startGradualSwapFeeChange(now.add(100), now.add(1000), MIN_SWAP_FEE, MAX_SWAP_FEE);
          await advanceToTimestamp(now.add(10));
        });

        itStartsAGradualWeightChangeCorrectly(START_TIME_OFFSET, true);
      });
    });
  });
});
