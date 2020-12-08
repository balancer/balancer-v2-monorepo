import { ethers } from 'hardhat';
import { calcInGivenOut, calcOutGivenIn } from '../../helpers/strategies/weightedProd';
import { expectRelativeError } from '../../helpers/relativeError';
import { Contract } from 'ethers';
import { Decimal } from 'decimal.js';

const MAX_RELATIVE_ERROR = 0.0001; //Max relative error

async function compareOutGivenIn(
  mockWeightedProdLib: Contract,
  tokenBalanceIn: string | number,
  tokenWeightIn: string | number,
  tokenBalanceOut: string | number,
  tokenWeightOut: string | number,
  tokenAmountIn: string | number
) {
  const outAmountMath = calcOutGivenIn(tokenBalanceIn, tokenWeightIn, tokenBalanceOut, tokenWeightOut, tokenAmountIn);
  const outAmountStrategy = await mockWeightedProdLib.outGivenIn(
    tokenBalanceIn,
    tokenWeightIn,
    tokenBalanceOut,
    tokenWeightOut,
    tokenAmountIn
  );
  //TODO: work math for this to always happen?
  //Amount out calcuated by strategy  must be never greater than exact math
  // expect(
  //   outAmountMath.greaterThanOrEqualTo(outAmountStrategy.toString()),
  //   'Calculated amount out must be less or equal than exact'
  // ).to.be.true;

  //Relative error must be less that the max accepted
  expectRelativeError(outAmountMath, new Decimal(outAmountStrategy.toString()), new Decimal(MAX_RELATIVE_ERROR));
}

async function compareInGivenOut(
  mockWeightedProdLib: Contract,
  tokenBalanceIn: string | number,
  tokenWeightIn: string | number,
  tokenBalanceOut: string | number,
  tokenWeightOut: string | number,
  tokenAmountOut: string | number
) {
  const inAmountMath = calcInGivenOut(tokenBalanceIn, tokenWeightIn, tokenBalanceOut, tokenWeightOut, tokenAmountOut);
  const inAmountStrategy = await mockWeightedProdLib.inGivenOut(
    tokenBalanceIn,
    tokenWeightIn,
    tokenBalanceOut,
    tokenWeightOut,
    tokenAmountOut
  );

  //TODO: work math for this to always happen?
  //Amount in calcuated by strategy must be never lower than exact math
  // expect(
  //   inAmountMath.lessThanOrEqualTo(inAmountStrategy.toString()),
  //  'Calculated amount in must be greater or equal than exact'
  // ).to.be.true;

  //Relative error must be less that the max accepted
  expectRelativeError(inAmountMath, new Decimal(inAmountStrategy.toString()), new Decimal(MAX_RELATIVE_ERROR));
}

describe('WeightedProd Lib', function () {
  let mockWeightedProdLib: Contract;

  beforeEach(async function () {
    const mockWeightedProdLibFactory = await ethers.getContractFactory('MockWeightedProdLib');
    mockWeightedProdLib = await mockWeightedProdLibFactory.deploy();
  });

  describe('Simple swap', () => {
    it('outGivenIn', async () => {
      await compareOutGivenIn(
        mockWeightedProdLib,
        (100e18).toString(), //tokenBalanceIn
        (50e18).toString(), //tokenWeightIn
        (100e18).toString(), //tokenBalanceOut
        (40e18).toString(), //tokenWeightOut
        (15e18).toString() //tokenAmountIn
      );
    });
    it('inGivenOut', async () => {
      await compareInGivenOut(
        mockWeightedProdLib,
        (100e18).toString(), //tokenBalanceIn
        (50e18).toString(), //tokenWeightIn
        (100e18).toString(), //tokenBalanceOut
        (40e18).toString(), //tokenWeightOut
        (15e18).toString() //tokenAmountOut
      );
    });
  });

  describe('Extreme amounts', () => {
    it('outGivenIn - min amount in', async () => {
      await compareOutGivenIn(
        mockWeightedProdLib,
        (100e18).toString(), //tokenBalanceIn
        (50e18).toString(), //tokenWeightIn
        (100e18).toString(), //tokenBalanceOut
        (40e18).toString(), //tokenWeightOut
        (10e6).toString() //tokenAmountIn (MIN AMOUNT = 0.00000000001)
      );
    });
    it('inGivenOut - min amount out', async () => {
      await compareInGivenOut(
        mockWeightedProdLib,
        (100e18).toString(), //tokenBalanceIn
        (50e18).toString(), //tokenWeightIn
        (100e18).toString(), //tokenBalanceOut
        (40e18).toString(), //tokenWeightOut
        (10e6).toString() //tokenAmountOut (MIN AMOUNT = 0.00000000001)
      );
    });
    it('outGivenIn - max amount in', async () => {
      await compareOutGivenIn(
        mockWeightedProdLib,
        '340282366920938463463374607431768211455', //tokenBalanceIn (max uint128)
        (50e18).toString(), //tokenWeightIn
        '340282366920938463463374607431768211455', //tokenBalanceOut (max uint128)
        (40e18).toString(), //tokenWeightOut
        '170141183460469231731687303715884105727' //tokenAmountIn (50% of Balance)
      );
    });
    it('inGivenOut - max amount out', async () => {
      await compareInGivenOut(
        mockWeightedProdLib,
        '340282366920938463463374607431768211455', //tokenBalanceIn (max uint128)
        (50e18).toString(), //tokenWeightIn
        '340282366920938463463374607431768211455', //tokenBalanceOut (max uint128)
        (40e18).toString(), //tokenWeightOut
        '170141183460469231731687303715884105727' //tokenAmountOut (50% of Balance)
      );
    });
  });

  describe('Extreme weights', () => {
    it('outGivenIn - min weights relation', async () => {
      //Weight relation = 130.07
      await compareOutGivenIn(
        mockWeightedProdLib,
        (100e18).toString(), //tokenBalanceIn
        (130.7e18).toString(), //tokenWeightIn
        (100e18).toString(), //tokenBalanceOut
        (1e18).toString(), //tokenWeightOut
        (15e18).toString() //tokenAmountIn
      );
    });
    it('outGivenIn - max weights relation', async () => {
      //Weight relation = 0.00769
      await compareOutGivenIn(
        mockWeightedProdLib,
        (100e18).toString(), //tokenBalanceIn
        (0.00769e18).toString(), //tokenWeightIn
        (100e18).toString(), //tokenBalanceOut
        (1e18).toString(), //tokenWeightOut
        (50e18).toString() //tokenAmountIn
      );
    });
  });
});
