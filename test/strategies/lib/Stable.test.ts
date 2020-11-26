import { deploy } from '../../../scripts/helpers/deploy';
import { calcInGivenOut, calcOutGivenIn } from '../../helpers/strategies/stable';
import { expectRelativeError } from '../../helpers/relativeError';
import { Contract } from 'ethers';
import { Decimal } from 'decimal.js';

const MAX_RELATIVE_ERROR = 0.0001; //Max relative error

async function compareOutGivenIn(
  mockStableLib: Contract,
  amp: string,
  balances: string[],
  tokenIndexIn: number,
  tokenIndexOut: number,
  tokenAmountIn: string
) {
  const outAmountMath = calcOutGivenIn(
    new Decimal(amp).div((1e18).toString()),
    balances.map((v) => new Decimal(v).div((1e18).toString())),
    tokenIndexIn,
    tokenIndexOut,
    new Decimal(tokenAmountIn).div((1e18).toString())
  );
  const outAmountStrategy = await mockStableLib.outGivenIn(amp, balances, tokenIndexIn, tokenIndexOut, tokenAmountIn);

  //TODO: work math for this to always happen?
  //Amount out calcuated by strategy  must be never greater than exact math
  // expect(
  //   outAmountMath.greaterThanOrEqualTo(outAmountStrategy.toString()),
  //   'Calculated amount out must be less or equal than exact'
  // ).to.be.true;

  //Relative error must be less that the max accepted
  expectRelativeError(
    outAmountMath.times((1e18).toString()),
    new Decimal(outAmountStrategy.toString()),
    new Decimal(MAX_RELATIVE_ERROR)
  );
}

async function compareInGivenOut(
  mockStableLib: Contract,
  amp: string,
  balances: string[],
  tokenIndexIn: number,
  tokenIndexOut: number,
  tokenAmountOut: string
) {
  const inAmountMath = calcInGivenOut(
    new Decimal(amp).div((1e18).toString()),
    balances.map((v) => new Decimal(v).div((1e18).toString())),
    tokenIndexIn,
    tokenIndexOut,
    new Decimal(tokenAmountOut).div((1e18).toString())
  );
  const inAmountStrategy = await mockStableLib.inGivenOut(amp, balances, tokenIndexIn, tokenIndexOut, tokenAmountOut);

  //TODO: work math for this to always happen?
  //Amount in calcuated by strategy must be never lower than exact math
  // expect(
  //   inAmountMath.lessThanOrEqualTo(inAmountStrategy.toString()),
  //  'Calculated amount in must be greater or equal than exact'
  // ).to.be.true;

  //Relative error must be less that the max accepted
  expectRelativeError(
    inAmountMath.times((1e18).toString()),
    new Decimal(inAmountStrategy.toString()),
    new Decimal(MAX_RELATIVE_ERROR)
  );
}

describe('Stable Lib', function () {
  let mockStableLib: Contract;

  beforeEach(async function () {
    mockStableLib = await deploy('MockStableLib', { args: [] });
  });

  describe('Simple swap', () => {
    it('outGivenIn', async () => {
      await compareOutGivenIn(
        mockStableLib,
        (7.6e18).toString(), //amp
        [(108.6e18).toString(), (42.482e18).toString()], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        (4.14e18).toString() //tokenAmountIn
      );
    });
    it('inGivenOut', async () => {
      await compareInGivenOut(
        mockStableLib,
        (7.6e18).toString(), //amp
        [(108.6e18).toString(), (42.482e18).toString()], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        (3.7928e18).toString() //tokenAmountOut
      );
    });
  });

  describe('Extreme amounts', () => {
    it('outGivenIn - min amount in', async () => {
      await compareOutGivenIn(
        mockStableLib,
        (7.6e18).toString(), //amp
        [(108.6e18).toString(), (42.482e18).toString()], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        (10e9).toString() //tokenAmountIn (MIN AMOUNT = 0.00000001)
      );
    });
    it('inGivenOut - min amount out', async () => {
      await compareInGivenOut(
        mockStableLib,
        (7.6e18).toString(), //amp
        [(108.6e18).toString(), (42.482e18).toString()], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        (10e9).toString() //tokenAmountIn (MIN AMOUNT = 0.00000001)
      );
    });
    it('outGivenIn - max amount in', async () => {
      await compareOutGivenIn(
        mockStableLib,
        '1000000000000000000000000000', //amp
        ['340282366920938463463374607431768211455', '340282366920938463463374607431768211455'], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        '170141183460469231731687303715884105727' //tokenAmountIn (50% of Balance)
      );
    });
    it('inGivenOut - max amount out', async () => {
      await compareInGivenOut(
        mockStableLib,
        '1000000000000000000000000000', //amp
        ['340282366920938463463374607431768211455', '340282366920938463463374607431768211455'], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        '170141183460469231731687303715884105727' //tokenAmountOut (50% of Balance)
      );
    });
  });

  describe('Many tokens', () => {
    //NOTE: the more tokens, the more the invariant error
    it('outGivenIn', async () => {
      await compareOutGivenIn(
        mockStableLib,
        (7.6e18).toString(), //amp
        [
          (108.6e18).toString(),
          (42.482e18).toString(),
          (50e18).toString(),
          (60e18).toString(),
          (70e18).toString(),
          (80e18).toString(),
        ], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        (4.14e18).toString() //tokenAmountIn
      );
    });
    //NOTE: the more tokens, the more the invariant error
    it('inGivenOut', async () => {
      await compareInGivenOut(
        mockStableLib,
        (7.6e18).toString(), //amp
        [
          (108.6e18).toString(),
          (42.482e18).toString(),
          (50e18).toString(),
          (60e18).toString(),
          (70e18).toString(),
          (80e18).toString(),
        ], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        (6.108e18).toString() //tokenAmountOut
      );
    });
  });
});
