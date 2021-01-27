import { BigNumber, Contract } from 'ethers';

import { deploy } from '../../../lib/helpers/deploy';
import { bn, decimal } from '../../../lib/helpers/numbers';
import { MAX_UINT128 } from '../../../lib/helpers/constants';
import { expectRelativeError } from '../../helpers/relativeError';
import { calcInGivenOut, calcOutGivenIn } from '../../helpers/math/weighted';

const MAX_RELATIVE_ERROR = 0.0001; //Max relative error

async function compareOutGivenIn(
  mock: Contract,
  tokenBalanceIn: BigNumber,
  tokenWeightIn: BigNumber,
  tokenBalanceOut: BigNumber,
  tokenWeightOut: BigNumber,
  tokenAmountIn: BigNumber
) {
  const outAmountMath = calcOutGivenIn(tokenBalanceIn, tokenWeightIn, tokenBalanceOut, tokenWeightOut, tokenAmountIn);
  const outAmountPool = await mock.outGivenIn(
    tokenBalanceIn,
    tokenWeightIn,
    tokenBalanceOut,
    tokenWeightOut,
    tokenAmountIn
  );
  //TODO: work math for this to always happen?
  //Amount out calcuated by pool must be never greater than exact math
  // expect(
  //   outAmountMath.greaterThanOrEqualTo(outAmountPool.toString()),
  //   'Calculated amount out must be less or equal than exact'
  // ).to.be.true;

  //Relative error must be less that the max accepted
  expectRelativeError(outAmountMath, decimal(outAmountPool), decimal(MAX_RELATIVE_ERROR));
}

async function compareInGivenOut(
  mock: Contract,
  tokenBalanceIn: BigNumber,
  tokenWeightIn: BigNumber,
  tokenBalanceOut: BigNumber,
  tokenWeightOut: BigNumber,
  tokenAmountOut: BigNumber
) {
  const inAmountMath = calcInGivenOut(tokenBalanceIn, tokenWeightIn, tokenBalanceOut, tokenWeightOut, tokenAmountOut);
  const inAmountPool = await mock.inGivenOut(
    tokenBalanceIn,
    tokenWeightIn,
    tokenBalanceOut,
    tokenWeightOut,
    tokenAmountOut
  );

  //TODO: work math for this to always happen?
  //Amount in calcuated by pool must be never lower than exact math
  // expect(
  //   inAmountMath.lessThanOrEqualTo(inAmountPool.toString()),
  //  'Calculated amount in must be greater or equal than exact'
  // ).to.be.true;

  //Relative error must be less that the max accepted
  expectRelativeError(inAmountMath, decimal(inAmountPool), decimal(MAX_RELATIVE_ERROR));
}

describe('WeightedMath', function () {
  let mock: Contract;

  beforeEach(async function () {
    mock = await deploy('MockWeightedMath', { args: [] });
  });

  describe('Simple swap', () => {
    it('outGivenIn', async () => {
      await compareOutGivenIn(
        mock,
        bn(100e18), //tokenBalanceIn
        bn(50e18), //tokenWeightIn
        bn(100e18), //tokenBalanceOut
        bn(40e18), //tokenWeightOut
        bn(15e18) //tokenAmountIn
      );
    });

    it('inGivenOut', async () => {
      await compareInGivenOut(
        mock,
        bn(100e18), //tokenBalanceIn
        bn(50e18), //tokenWeightIn
        bn(100e18), //tokenBalanceOut
        bn(40e18), //tokenWeightOut
        bn(15e18) //tokenAmountOut
      );
    });
  });

  describe('Extreme amounts', () => {
    it('outGivenIn - min amount in', async () => {
      await compareOutGivenIn(
        mock,
        bn(100e18), //tokenBalanceIn
        bn(50e18), //tokenWeightIn
        bn(100e18), //tokenBalanceOut
        bn(40e18), //tokenWeightOut
        bn(10e6) //tokenAmountIn (MIN AMOUNT = 0.00000000001)
      );
    });

    it('inGivenOut - min amount out', async () => {
      await compareInGivenOut(
        mock,
        bn(100e18), //tokenBalanceIn
        bn(50e18), //tokenWeightIn
        bn(100e18), //tokenBalanceOut
        bn(40e18), //tokenWeightOut
        bn(10e6) //tokenAmountOut (MIN AMOUNT = 0.00000000001)
      );
    });

    it('outGivenIn - max amount in', async () => {
      await compareOutGivenIn(
        mock,
        MAX_UINT128, //tokenBalanceIn
        bn(50e18), //tokenWeightIn
        MAX_UINT128, //tokenBalanceOut
        bn(40e18), //tokenWeightOut
        MAX_UINT128.div(2) //tokenAmountIn (50% of Balance)
      );
    });

    it('inGivenOut - max amount out', async () => {
      await compareInGivenOut(
        mock,
        MAX_UINT128, //tokenBalanceIn
        bn(50e18), //tokenWeightIn
        MAX_UINT128, //tokenBalanceOut
        bn(40e18), //tokenWeightOut
        MAX_UINT128.div(2) //tokenAmountOut (50% of Balance)
      );
    });
  });

  describe('Extreme weights', () => {
    it('outGivenIn - min weights relation', async () => {
      //Weight relation = 130.07
      await compareOutGivenIn(
        mock,
        bn(100e18), //tokenBalanceIn
        bn(130.7e18), //tokenWeightIn
        bn(100e18), //tokenBalanceOut
        bn(1e18), //tokenWeightOut
        bn(15e18) //tokenAmountIn
      );
    });

    it('outGivenIn - max weights relation', async () => {
      //Weight relation = 0.00769
      await compareOutGivenIn(
        mock,
        bn(100e18), //tokenBalanceIn
        bn(0.00769e18), //tokenWeightIn
        bn(100e18), //tokenBalanceOut
        bn(1e18), //tokenWeightOut
        bn(50e18) //tokenAmountIn
      );
    });
  });
});
